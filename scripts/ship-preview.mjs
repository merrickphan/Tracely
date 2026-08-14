#!/usr/bin/env node
/**
 * Publish a preview build for review, without touching production.
 *
 * The counterpart to ship.mjs. That script cuts a real release for real users;
 * this one publishes a prerelease that can be installed and used without one.
 *
 * Two modes, decided by the branch you are standing on:
 *
 *  - **From `main`: the integration build.** What would ship right now, if the
 *    merged work were released. This is the one everybody installs and leaves
 *    installed, because it is the only build that shows the integrated whole.
 *  - **From a `feat/*` branch: a branch preview.** One change, installable
 *    before anyone decides it belongs on main.
 *
 * Both produce the same artifact and publish to the same channel, so an install
 * follows whichever was published last. In practice that means integration
 * builds, with the occasional branch preview when someone wants eyes on a
 * change early — and the next integration build takes the channel back.
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

// Two kinds of preview, and main is the important one.
//
// This script used to refuse main outright, on the reasoning that previews are
// for reviewing work *before* it lands. That is true of a branch preview and it
// left a real gap: there was no way to publish "what would ship right now".
// `npm run ship` publishes to production users, so the only build anyone could
// install of integrated main was a real release.
//
// The consequence, with more than one person working: everyone ran `npm run
// dev` against their own tree and saw a different app. Nobody could see the
// integrated whole without cutting a release for real users.
//
// So main is now allowed, as the INTEGRATION build. It is the same artifact
// either way — "Tracely Preview", staging backend, beta.yml — which means
// anyone who installs it once keeps receiving whichever preview was published
// last. That is the point: install once, and the shared build follows main.
const isIntegration = branch === 'main'

if (isIntegration) {
  // A branch preview is reproducible from its branch. An integration build has
  // to be reproducible from origin/main specifically, or "what would ship" is
  // whatever happened to be on one laptop.
  run('git fetch origin main --quiet')
  if (out('git rev-parse HEAD') !== out('git rev-parse origin/main')) {
    die(
      'Local main is not in sync with origin/main.\n' +
        'An integration build has to be exactly what is on the remote, or it is not\n' +
        'what would ship. Pull or push first, then run this again.'
    )
  }
}

console.log(
  isIntegration
    ? `\n1/5  Integration preview from 'main' — this is what would ship right now`
    : `\n1/5  Branch preview from '${branch}'`
)

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
// From 0.3.75 this gives 0.3.76-beta.0, then -beta.1, and so on. A later
// `npm version patch` in ship.mjs collapses that to a clean 0.3.76, which
// outranks every beta of it — so previews never block the real release.
run('npm version prerelease --preid=beta --no-git-tag-version')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
run(`git commit -am "Preview v${version}"`)
run(`git push origin ${branch}`)
console.log(`     v${version}`)

console.log('\n4/5  Loading GH_TOKEN')
const envFile = join(ROOT, '.env.release')
if (!existsSync(envFile)) die('.env.release not found — GH_TOKEN is required to publish.')
const token = readFileSync(envFile, 'utf8').match(/^GH_TOKEN=(.+)$/m)?.[1]?.trim()
if (!token) die('No GH_TOKEN in .env.release.')

console.log('\n5/5  Build + publish preview')
run('npm run preflight', { env: previewEnv })
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
const built = out('git rev-parse HEAD')
run(`git tag -f v${version} ${built}`)
run(`git push -f origin v${version}`)
console.log(`     tag v${version} -> ${built.slice(0, 7)} (${branch})`)

console.log(`
Published preview v${version} as a GitHub prerelease.

  Install:    the .exe on the prerelease, from ${'https://github.com/merrickphan/Tracely/releases'}
  It appears: as "Tracely Preview", a separate app beside your real Tracely
  Its data:   %APPDATA%\\Tracely Preview  (your real database is untouched)

Production users on the stable channel are not offered this build.
`)
