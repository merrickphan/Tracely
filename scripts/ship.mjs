#!/usr/bin/env node
/**
 * One-command release: merge every agent's work, bump, publish.
 *
 * The steps are ordered so the irreversible one is last and gated. preflight
 * runs inside release:win and refuses to publish unless main is clean, in
 * sync, typechecked, every relay endpoint is live, and the version is above
 * the published one — so a bad state stops here rather than reaching users.
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Every child of a production ship gets TRACELY_ENV=production, pinned here and
// never inherited from the shell.
//
// This is the most dangerous thing in the environment split. If TRACELY_ENV
// were left over as 'staging' from an earlier `ship:preview`, this script would
// build a *production* release against the staging relay and staging Supabase,
// publish it to latest.yml, and every installed copy would take it inside six
// hours. The relay URL is inlined at build time with no runtime path back to
// it, so nobody could see what happened until users started failing to sign in.
const SHIP_ENV = { ...process.env, TRACELY_ENV: 'production' }
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: SHIP_ENV, ...opts })
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()

const die = (msg) => {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

if (out('git status --porcelain')) die('Uncommitted work in agent1. Commit or stash it first.')

console.log('\n1/5  Collecting agent work onto main')
run('git checkout main')
// Local refs, not origin/*: the three worktrees share one .git, so these are
// always exactly what each agent last committed, and origin/agent2-work still
// carries a stale superseded commit that conflicts.
for (const b of ['agent1-work', 'agent2-work', 'agent3-work']) {
  try {
    run(`git merge --no-edit ${b}`)
  } catch {
    try { run('git merge --abort') } catch { /* nothing to abort */ }
    die(`Merge conflict on ${b}. Resolve it, then run npm run ship again.`)
  }
}

// Before bumping, not after: a blocked ship should cost nothing, and bumping
// first burns a version number on every failed attempt.
console.log('\n2/5  Checking everything is releasable')
try {
  run('npm run preflight', { env: { ...SHIP_ENV, PREFLIGHT_SKIP_VERSION: '1' } })
} catch {
  die('Not releasable — nothing was changed. Fix the above and run npm run ship again.')
}

console.log('\n3/5  Bumping version')
run('npm version patch --no-git-tag-version')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
run(`git commit -am "Release v${version}"`)
run('git push origin main')
console.log(`     v${version}`)

console.log('\n4/5  Loading GH_TOKEN')
// electron-builder does not read .env.release itself; --publish silently
// no-ops without a token, producing a "successful" release nobody receives.
const envFile = join(ROOT, '.env.release')
if (!existsSync(envFile)) die('.env.release not found — GH_TOKEN is required to publish.')
const token = readFileSync(envFile, 'utf8').match(/^GH_TOKEN=(.+)$/m)?.[1]?.trim()
if (!token) die('No GH_TOKEN in .env.release.')

console.log('\n5/5  Build + publish')
run('npm run release:win', { env: { ...SHIP_ENV, GH_TOKEN: token } })

console.log(`\nPublished v${version}. Users are offered it within 6 hours.\n`)
