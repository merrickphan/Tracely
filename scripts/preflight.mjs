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

let failed = false
const pass = (m) => console.log(`  ok    ${m}`)
const fail = (m) => {
  console.log(`  FAIL  ${m}`)
  failed = true
}
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim()

console.log('\nRelease preflight\n')

// 1. Releasing from a work branch would ship whatever that agent was mid-way
//    through, under a version number that claims to be the integration branch.
try {
  const branch = git('rev-parse --abbrev-ref HEAD')
  branch === RELEASE_BRANCH
    ? pass(`on ${RELEASE_BRANCH}`)
    : fail(`on '${branch}', not ${RELEASE_BRANCH} — releases are cut from ${RELEASE_BRANCH} only`)
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
  git('fetch --quiet origin ' + RELEASE_BRANCH)
  const behind = git(`rev-list --count HEAD..origin/${RELEASE_BRANCH}`)
  const ahead = git(`rev-list --count origin/${RELEASE_BRANCH}..HEAD`)
  if (behind !== '0') fail(`${behind} commit(s) behind origin/${RELEASE_BRANCH} — pull first`)
  else if (ahead !== '0') fail(`${ahead} commit(s) not pushed — push before releasing`)
  else pass(`in sync with origin/${RELEASE_BRANCH}`)
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

const relayUrl = (readFileSync(join(ROOT, '.env'), 'utf8').match(/^RELAY_URL=(.+)$/m)?.[1] || '').trim()

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
const cmp = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
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
  const res = await fetch(`https://api.github.com/repos/${o}/${r}/releases/latest`, {
    signal: AbortSignal.timeout(20_000)
  })
  const latest = (await res.json()).tag_name?.replace(/^v/, '')
  if (!latest) pass(`version ${pkg.version} (no previous release found)`)
  else if (cmp(pkg.version, latest) > 0) pass(`version ${pkg.version} > published ${latest}`)
  else fail(`version ${pkg.version} is not above published ${latest} — bump it, or the updater will never offer this build`)
} catch {
  fail('could not read the latest published release from GitHub')
}

console.log(failed ? '\nPreflight FAILED — nothing was published.\n' : '\nPreflight passed.\n')
process.exit(failed ? 1 : 0)
