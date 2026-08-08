#!/usr/bin/env node
/**
 * Publish ONE preview containing every agent's work.
 *
 * ship-preview.mjs previews a single branch, which answers "does agent2's UI
 * look right". It cannot answer "do all three agents' changes work TOGETHER",
 * and that is the question worth asking before a release — the parts are
 * written in isolation and only meet at merge time.
 *
 * This is ship.mjs's collection step pointed at a preview instead of at
 * production: same merge, same order, none of the consequences.
 *
 * It runs in its own worktree (C:/Users/merri/Tracely-preview, branch
 * preview-integration) because git refuses to check out a branch that another
 * worktree already holds. agent1 holds main and each agent holds its own
 * branch, so an integration branch has nowhere else to live. Create it with:
 *
 *   git worktree add ../Tracely-preview -b preview-integration main
 *
 * The integration branch is disposable. It is reset to main on every run
 * rather than accumulating merge history, so a merge resolved badly once does
 * not haunt every future preview.
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKTREE = process.env.TRACELY_PREVIEW_WORKTREE ?? join(ROOT, '..', 'Tracely-preview')
const BRANCH = 'preview-integration'
const AGENTS = ['agent1-work', 'agent2-work', 'agent3-work']

const run = (cmd, opts = {}) => execSync(cmd, { cwd: WORKTREE, stdio: 'inherit', ...opts })
const out = (cmd, cwd = WORKTREE) => execSync(cmd, { cwd, encoding: 'utf8' }).trim()

const die = (msg) => {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

if (!existsSync(WORKTREE)) {
  die(
    `No integration worktree at ${WORKTREE}.\n\n` +
      `  git worktree add "${WORKTREE}" -b ${BRANCH} main`
  )
}

console.log(`\n1/4  Checking each agent has committed`)

// The failure this prevents has already happened twice. Work sitting
// uncommitted in a worktree is invisible to every branch operation, so a
// preview would quietly ship without it and look like the agent's change did
// nothing. Named explicitly rather than merged silently.
const dirty = []
for (const branch of AGENTS) {
  const worktree = join(ROOT, '..', `Tracely-${branch.replace('-work', '')}`)
  if (!existsSync(worktree)) continue
  const status = out('git status --porcelain', worktree)
  if (status) dirty.push({ branch, worktree, files: status.split('\n').length })
}

if (dirty.length > 0) {
  console.error('\nUncommitted work — it would NOT appear in the preview:\n')
  for (const d of dirty) console.error(`  ${d.branch.padEnd(14)} ${d.files} file(s)  ${d.worktree}`)
  die('Commit it on each agent branch, then run this again.')
}
for (const branch of AGENTS) console.log(`  ok    ${branch}`)

console.log(`\n2/4  Collecting every agent onto ${BRANCH}`)

// Reset rather than merge-on-top: the integration branch is a scratch space,
// and starting from main every time means the preview reflects exactly
// "main + the three branches as they are now", with no residue from previous
// runs.
run('git fetch --quiet origin || true', { stdio: 'ignore' })
run(`git checkout ${BRANCH}`)
run('git reset --hard main')

for (const branch of AGENTS) {
  try {
    run(`git merge --no-edit ${branch}`)
  } catch {
    try { run('git merge --abort') } catch { /* nothing to abort */ }
    die(
      `Merge conflict on ${branch}.\n\n` +
        `  Two agents changed the same file. See OWNERSHIP.md — file ownership\n` +
        `  exists to prevent exactly this. Resolve it on the agent branches,\n` +
        `  not here: this branch is reset on every run and any fix made in it\n` +
        `  is thrown away.`
    )
  }
}

console.log(`\n3/4  Installing dependencies`)
// Each worktree has its own node_modules, and an agent may have added a
// dependency. Cheap when nothing changed.
run('npm install --silent')

console.log(`\n4/4  Building and publishing the combined preview`)
run('npm run ship:preview')
