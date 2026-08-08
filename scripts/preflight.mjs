#!/usr/bin/env node
/**
 * Release gate. Runs before `release:win` publishes anything.
 *
 * Exists because every local signal can say "ship" while the release is still
 * broken: v0.3.73 was committed, typechecked and building cleanly with a
 * headline feature whose relay endpoint returned 404 in production. Nothing
 * in the build could have caught that — the endpoint list lives in the client
 * and the deployment lives in another repo.
 *
 * Each check below corresponds to a way a release has actually gone wrong or
 * can silently go wrong. Failing loudly here costs a minute; failing in
 * production reaches every installed app within 6 hours (updater.ts polls on
 * launch and every 6h).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_BRANCH = 'main'

// Preview mode (PREFLIGHT_PREVIEW=1, set by ship-preview.mjs) publishes a
// prerelease off whatever branch an agent is working on, so the two gates that
// exist to protect *production* — "must be on main", "must match origin/main"
// — are re-pointed at the current branch rather than dropped. Everything else
// (clean tree, typecheck, live relay, version actually ahead) still applies:
// a preview build that's broken in those ways wastes a review cycle.
const PREVIEW = process.env.PREFLIGHT_PREVIEW === '1'

let failed = false
const pass = (m) => console.log(`  ok    ${m}`)
const fail = (m) => {
  console.log(`  FAIL  ${m}`)
  failed = true
}
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim()

console.log(PREVIEW ? '\nPreview preflight\n' : '\nRelease preflight\n')

// 1. Releasing from a work branch would ship whatever that agent was mid-way
//    through, under a version number that claims to be the integration branch.
//    Previews are the deliberate exception — reviewing an agent's branch before
//    it reaches main is the entire point — but a detached HEAD is still wrong,
//    since there'd be no branch to push the version bump to.
let targetBranch = RELEASE_BRANCH
try {
  const branch = git('rev-parse --abbrev-ref HEAD')
  if (PREVIEW) {
    targetBranch = branch
    branch === 'HEAD' ? fail('detached HEAD — check out a branch first') : pass(`preview from '${branch}'`)
  } else {
    branch === RELEASE_BRANCH
      ? pass(`on ${RELEASE_BRANCH}`)
      : fail(`on '${branch}', not ${RELEASE_BRANCH} — releases are cut from ${RELEASE_BRANCH} only`)
  }
} catch {
  fail('not a git repository')
}

// 2. electron-builder packages the working tree, not HEAD, so uncommitted
//    edits ship silently and are unreproducible from the tag afterwards.
const dirty = git('status --porcelain')
dirty ? fail(`working tree dirty:\n${dirty.split('\n').map((l) => `          ${l}`).join('\n')}`) : pass('working tree clean')

// 3. Publishing a commit that isn't on the remote means the tag points at
//    something nobody else can fetch.
try {
  git('fetch --quiet origin ' + targetBranch)
  const behind = git(`rev-list --count HEAD..origin/${targetBranch}`)
  const ahead = git(`rev-list --count origin/${targetBranch}..HEAD`)
  if (behind !== '0') fail(`${behind} commit(s) behind origin/${targetBranch} — pull first`)
  else if (ahead !== '0') fail(`${ahead} commit(s) not pushed — push before releasing`)
  else pass(`in sync with origin/${targetBranch}`)
} catch {
  fail('could not compare against origin (offline?)')
}

// 4. The only automated correctness check this project has.
try {
  execSync('npm run typecheck', { cwd: ROOT, stdio: 'pipe' })
  pass('typecheck')
} catch (e) {
  fail(`typecheck failed:\n${(e.stdout?.toString() || e.message).trim()}`)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// 5. The check that would have caught the Tracer 404. The endpoint list is
//    read from callRelay's own parameter type — a union of string literals —
//    rather than hardcoded here or scraped from call sites. That union is
//    what the compiler already enforces every call against, so it cannot
//    drift from reality: adding an endpoint means widening it, and this check
//    picks the new one up with nobody remembering to update this file.
const clientSrc = readFileSync(join(ROOT, 'src/main/services/ai/client.ts'), 'utf8')
const union = clientSrc.match(/callRelay<[^>]*>\(\s*endpoint:\s*([^,)]+)/)?.[1] ?? ''
const endpoints = new Set([...union.matchAll(/'([a-z0-9][a-z0-9-]*)'/g)].map((m) => m[1]))

// Guarded: a worktree with no .env at all is the normal state for a freshly
// created agent worktree (.env is gitignored), and an unhandled ENOENT here
// would crash preflight instead of reporting the actual problem.
let env = ''
try {
  env = readFileSync(join(ROOT, '.env'), 'utf8')
} catch {
  env = ''
}
const envValue = (name) => (env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1] || '').trim()
const relayUrl = envValue('RELAY_URL')

// The relay refuses any call it cannot attribute to a signed-in account, and
// the app proves who it is with a Supabase access token. Those two values are
// inlined at build time (electron.vite.config.ts) and default to '' when
// absent — so a .env missing them produces a build that compiles, launches,
// signs nobody in, and 401s every AI call. Silent and total, which is exactly
// the kind of failure that reaches users.
for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
  envValue(name)
    ? pass(`${name} present`)
    : fail(`no ${name} in .env — the build could not sign anyone in, so every AI call would 401`)
}

if (!relayUrl) {
  fail('no RELAY_URL in .env — the build would ship with AI features dead')
} else if (endpoints.size === 0) {
  fail('found no callRelay() endpoints to verify — the scraper regex is probably stale')
} else {
  for (const ep of [...endpoints].sort()) {
    // No token deliberately: 401 proves the route exists and is enforcing auth,
    // which is all we need. 404 is the failure we are hunting.
    try {
      const res = await fetch(`${relayUrl}/api/${ep}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(20_000)
      })
      res.status === 404
        ? fail(`relay /api/${ep} -> 404 — not deployed; ship the relay first`)
        : pass(`relay /api/${ep} -> ${res.status}`)
    } catch {
      fail(`relay /api/${ep} unreachable`)
    }
  }
}

// 6. Publishing without bumping produces a release the updater never offers,
//    because electron-updater only acts on a strictly higher version.
// Splits on the prerelease tag first. Naively mapping Number over
// '0.3.76-beta.1'.split('.') yields NaN for '76-beta', which `|| 0` then
// quietly turns into 0 — making every preview version compare as older than
// the release it follows, and failing a build that is genuinely newer.
const parseVersion = (v) => {
  const [core, pre = ''] = v.replace(/^v/, '').split('-')
  return { nums: core.split('.').map((n) => Number(n) || 0), pre }
}

const cmp = (a, b) => {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  for (let i = 0; i < 3; i++) if ((va.nums[i] || 0) !== (vb.nums[i] || 0)) return (va.nums[i] || 0) - (vb.nums[i] || 0)
  // Semver: a released version outranks a prerelease of the same core, so
  // 0.3.76 > 0.3.76-beta.1 and the eventual stable build supersedes its betas.
  if (!va.pre && vb.pre) return 1
  if (va.pre && !vb.pre) return -1
  // 'beta.2' vs 'beta.10' — numeric collation, or 10 would sort before 2.
  return va.pre.localeCompare(vb.pre, undefined, { numeric: true })
}

// ship.mjs runs preflight once before bumping, to fail cheaply without
// burning a version number, then release:win runs it again in full. On that
// first pass the version legitimately isn't ahead yet, so skip only this check.
if (process.env.PREFLIGHT_SKIP_VERSION === '1') {
  console.log(`  --    version check deferred until after the bump`)
} else try {
  const { owner, repo } = pkg.build?.publish ?? {}
  const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  const o = owner ?? yml.match(/owner:\s*(\S+)/)?.[1]
  const r = repo ?? yml.match(/repo:\s*(\S+)/)?.[1]
  // /releases/latest deliberately excludes prereleases. That's exactly right
  // for a production release — betas must never raise the bar main has to
  // clear — but wrong for a preview, which has to outrank the previous beta
  // or electron-updater will never offer it to reviewers. So preview mode
  // reads the full list and takes the highest version of any kind.
  let latest
  if (PREVIEW) {
    const res = await fetch(`https://api.github.com/repos/${o}/${r}/releases?per_page=100`, {
      signal: AbortSignal.timeout(20_000)
    })
    const tags = (await res.json()).map((rel) => rel.tag_name?.replace(/^v/, '')).filter(Boolean)
    latest = tags.sort(cmp).pop()
  } else {
    const res = await fetch(`https://api.github.com/repos/${o}/${r}/releases/latest`, {
      signal: AbortSignal.timeout(20_000)
    })
    latest = (await res.json()).tag_name?.replace(/^v/, '')
  }
  if (!latest) pass(`version ${pkg.version} (no previous release found)`)
  else if (cmp(pkg.version, latest) > 0) pass(`version ${pkg.version} > published ${latest}`)
  else fail(`version ${pkg.version} is not above published ${latest} — bump it, or the updater will never offer this build`)
} catch {
  fail('could not read the latest published release from GitHub')
}

console.log(failed ? '\nPreflight FAILED — nothing was published.\n' : '\nPreflight passed.\n')
process.exit(failed ? 1 : 0)
