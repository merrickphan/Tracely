#!/usr/bin/env node
/**
 * Publish a preview build for review, without touching production.
 *
 * The counterpart to ship.mjs. That script cuts a real release for real users;
 * this one publishes a prerelease that can be installed and used without one.
 *
 * **From `main` only.** What would ship right now, if the merged work were
 * released. Everyone installs it once and leaves it installed, because it is
 * the only build that shows the integrated whole.
 *
 * Branch previews used to be allowed and are now refused — see the gate below.
 * Everything published here lands on the same beta channel, so an install
 * follows whichever build was published last, and a branch preview would take
 * that channel away from everyone until the next merge.
 *
 * You will rarely run this by hand. `.github/workflows/preview.yml` runs it on
 * a Windows runner on every push to main, which is how a merge reaches Tracely
 * Preview without anyone's laptop being involved. Running it locally is for
 * when CI is broken and you need a build anyway.
 *
 * Two mechanisms keep it away from production users:
 *
 *  - The version carries a `-beta` tag, so electron-builder writes `beta.yml`
 *    instead of `latest.yml`. Installed production builds poll `latest.yml`
 *    and never learn this exists. (A preview build's own app-update.yml says
 *    channel: beta, so reviewers keep getting previews.)
 *  - It ships under a different appId and productName, so it installs
 *    ALONGSIDE Tracely rather than upgrading over it, and keeps its own
 *    database under %APPDATA%\Tracely Preview. A broken preview cannot damage
 *    real work.
 *
 * Because it's a separate app, a preview never auto-updates into production —
 * that's the trade for being able to run both at once. Install real releases
 * the normal way.
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()

const die = (msg) => {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

// electron-builder packages the working tree, not HEAD — uncommitted edits
// would ship inside a build that no commit can reproduce.
if (out('git status --porcelain')) die('Uncommitted work. Commit it first — a preview must be reproducible from a commit.')

const branch = out('git rev-parse --abbrev-ref HEAD')
if (branch === 'HEAD') die('Detached HEAD — check out a branch first.')

// main only. Branch previews are gone on purpose.
//
// This gate has now been all three ways, and each move was right at the time.
// It originally refused main, because a preview was for reviewing work *before*
// it landed. That left no way to publish "what would ship right now", so main
// was allowed alongside branches. Both then published to the same beta channel,
// and an install follows whichever was published last.
//
// That collision is why branches are refused now. With CI publishing from main
// on every merge, a branch preview does not add a review path — it silently
// replaces the shared build for everyone who has Preview installed, with one
// person's unmerged work, until the next merge takes the channel back. Two
// people comparing notes on "the preview" would be looking at different
// software and have no way to tell.
//
// The review path that replaced it is faster anyway: merge it, and CI has the
// change in Preview within minutes. If something genuinely needs eyes before it
// lands, that is what `npm run dev` and the PR diff are for.
if (branch !== 'main') {
  die(
    `On '${branch}'. Previews are published from main only.\n\n` +
      'Both branch and main previews go to the same beta channel, so publishing\n' +
      "from here would replace everyone's Tracely Preview with your unmerged\n" +
      'branch until the next merge to main overwrote it.\n\n' +
      'Merge it instead — .github/workflows/preview.yml builds and publishes\n' +
      'every push to main, so it reaches Preview within minutes.'
  )
}

// Reproducible from origin/main specifically, or "what would ship" is whatever
// happened to be sitting on one laptop.
run('git fetch origin main --quiet')
if (out('git rev-parse HEAD') !== out('git rev-parse origin/main')) {
  die(
    'Local main is not in sync with origin/main.\n' +
      'An integration build has to be exactly what is on the remote, or it is not\n' +
      'what would ship. Pull or push first, then run this again.'
  )
}

console.log(`\n1/5  Integration preview from 'main' — this is what would ship right now`)

// Before the bump, so a blocked preview costs nothing rather than burning a
// version number on every failed attempt — same ordering as ship.mjs.
console.log('\n2/5  Checking everything is releasable')
// TRACELY_ENV is set here rather than expected from the shell, for the same
// reason ship.mjs pins it to production: on Windows `TRACELY_ENV=x npm run ...`
// does not work through cmd.exe, and an environment that depends on the caller
// remembering a prefix is not an environment. Passing it in the spawned env
// inherits all the way down through preview:win -> electron-vite build.
const previewEnv = { ...process.env, PREFLIGHT_PREVIEW: '1', TRACELY_ENV: 'staging' }
try {
  run('npm run preflight', { env: { ...previewEnv, PREFLIGHT_SKIP_VERSION: '1' } })
} catch {
  die('Not releasable — nothing was changed. Fix the above and run npm run ship:preview again.')
}

console.log('\n3/5  Bumping to a prerelease version')
// Two ways to pick the number, because CI cannot write to main.
//
// `check` is a required status check on main. A required check blocks *every*
// push, not just merges — and a freshly pushed commit has by definition not run
// it yet. So CI pushing its own version-bump commit is a deadlock: the push is
// rejected pending a check that cannot start until the push succeeds. That is
// not a misconfiguration to work around; a branch that requires review-by-CI
// should not have a bot committing straight to it.
//
// So in CI the version comes from the run number instead of from the last one.
// GITHUB_RUN_NUMBER increases by one per run of this workflow and never repeats,
// which is all electron-updater needs — it compares versions and only ever moves
// forward. Nothing is committed and nothing is pushed; package.json on main stays
// at whatever the last real release left there, and the bump exists only inside
// the build. A later `npm version patch` in ship.mjs produces a clean 0.3.x that
// outranks every beta of it, exactly as before.
const CI = !!process.env.GITHUB_ACTIONS
let version
if (CI) {
  const base = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version.split('-')[0]
  version = `${base}-beta.${process.env.GITHUB_RUN_NUMBER}`
  run(`npm version ${version} --no-git-tag-version --allow-same-version`)
  console.log(`     v${version}  (from run number; not committed)`)
} else {
  run('npm version prerelease --preid=beta --no-git-tag-version')
  version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  run(`git commit -am "Preview v${version}"`)
  run(`git push origin ${branch}`)
  console.log(`     v${version}`)
}

console.log('\n4/5  Loading GH_TOKEN')
// The environment first, then the file.
//
// `.github/workflows/preview.yml` runs this script on a Windows runner so that
// merging to main publishes a preview without anyone's laptop being involved.
// CI has no `.env.release` and must not have one — it is the file holding the
// release token, and it is gitignored precisely so it never reaches this public
// repository. There, GITHUB_TOKEN arrives in the environment instead.
//
// Environment wins over the file so a one-off local run can use a different
// token without editing `.env.release` and forgetting to put it back.
let token = process.env.GH_TOKEN?.trim()
if (token) {
  console.log('     from the environment')
} else {
  const envFile = join(ROOT, '.env.release')
  if (!existsSync(envFile))
    die('No GH_TOKEN in the environment, and no .env.release — one of the two is required to publish.')
  token = readFileSync(envFile, 'utf8').match(/^GH_TOKEN=(.+)$/m)?.[1]?.trim()
  if (!token) die('No GH_TOKEN in .env.release.')
  console.log('     from .env.release')
}

console.log('\n5/5  Build + publish preview')
// The second preflight re-checks everything now that the version is settled.
// Locally that is worth doing. In CI it cannot pass and should not: the bump is
// deliberately uncommitted there, so "working tree clean" is false by design and
// "in sync with origin" would be too. Everything else it checks was already
// verified at 2/5 against the identical tree, and the CI version is monotonic by
// construction rather than by comparison, so there is nothing left for it to
// catch that the first run did not.
if (!CI) run('npm run preflight', { env: previewEnv })
run('npm run preview:win', { env: { ...previewEnv, GH_TOKEN: token } })

// Point the tag at the commit that was actually built.
//
// electron-builder creates the GitHub release through the API without a
// target_commitish, so GitHub creates the tag at the DEFAULT BRANCH's head —
// not at the preview branch we are standing on. Every preview tag therefore
// pointed at some commit on main whose package.json still read the previous
// release's version, and the published installer could not be reproduced from
// its own tag. Moving it here is deterministic and does not depend on what
// electron-builder chooses to send.
//
// Forced because the tag already exists by this point: electron-builder made
// it a moment ago, in the wrong place.
// Only locally, and only still necessary there.
//
// electron-builder creates the GitHub release through the API without a
// target_commitish, so GitHub puts the tag at the DEFAULT BRANCH's head rather
// than at whatever was built. That used to matter a great deal, when previews
// could be cut from a feature branch: the tag landed on some unrelated commit on
// main and the installer could not be reproduced from it.
//
// Previews now only ever come from main, so the default branch head IS the built
// commit and the tag is already right. The correction below is kept for the local
// path, where the bump commit advances HEAD past what electron-builder saw. In CI
// nothing is committed and nothing can be pushed to a protected branch anyway.
if (!CI) {
  const built = out('git rev-parse HEAD')
  run(`git tag -f v${version} ${built}`)
  run(`git push -f origin v${version}`)
  console.log(`     tag v${version} -> ${built.slice(0, 7)} (${branch})`)
}

console.log(`
Published preview v${version} as a GitHub prerelease.

  Install:    the .exe on the prerelease, from ${'https://github.com/merrickphan/Tracely/releases'}
  It appears: as "Tracely Preview", a separate app beside your real Tracely
  Its data:   %APPDATA%\\Tracely Preview  (your real database is untouched)

Production users on the stable channel are not offered this build.
`)
