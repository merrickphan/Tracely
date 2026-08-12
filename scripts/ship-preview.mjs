#!/usr/bin/env node
/**
 * Publish a preview build for review, without touching production.
 *
 * The counterpart to ship.mjs. That script collects every agent onto main and
 * cuts a real release; this one publishes whatever branch you're standing on
 * as a prerelease, so a change can be installed and used before anyone decides
 * it belongs on main.
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
if (branch === 'main') {
  die('You are on main. Previews are for reviewing work before it reaches main;\nto publish from main, use npm run ship.')
}

console.log(`\n1/5  Preview from '${branch}'`)

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
