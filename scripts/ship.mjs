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
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()

const die = (msg) => {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

if (out('git status --porcelain')) die('Uncommitted work in agent1. Commit or stash it first.')

console.log('\n1/4  Collecting agent work onto main')
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

console.log('\n2/4  Bumping version')
run('npm version patch --no-git-tag-version')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
run(`git commit -am "Release v${version}"`)
run('git push origin main')
console.log(`     v${version}`)

console.log('\n3/4  Loading GH_TOKEN')
// electron-builder does not read .env.release itself; --publish silently
// no-ops without a token, producing a "successful" release nobody receives.
const envFile = join(ROOT, '.env.release')
if (!existsSync(envFile)) die('.env.release not found — GH_TOKEN is required to publish.')
const token = readFileSync(envFile, 'utf8').match(/^GH_TOKEN=(.+)$/m)?.[1]?.trim()
if (!token) die('No GH_TOKEN in .env.release.')

console.log('\n4/4  Preflight + build + publish')
run('npm run release:win', { env: { ...process.env, GH_TOKEN: token } })

console.log(`\nPublished v${version}. Users are offered it within 6 hours.\n`)
