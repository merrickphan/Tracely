// The gate on hand annotations. Run it after labelling anything.
//
//   npm run eval:validate
//
// It checks nothing about whether your judgements are GOOD — only that they
// are attached to text that exists, in a shape the fitting scripts can read.
// That is a low bar deliberately: every measurement downstream assumes it, and
// none of them can detect its violation on their own.

import { loadAnnotations, joinToReport, SOURCE_LABELS } from './annotations.mjs'
import { REPO, reportPath } from './paths.mjs'
import { existsSync, readdirSync, readFileSync } from 'fs'

/**
 * Per-source verdicts in eval/retrieval/labels — the OTHER label store.
 *
 * This script counts `sources[].label` in eval/annotations and prints "N
 * labelled sources", and that number was read for days as the total amount of
 * per-source labelling in the repo. It is not. eval/retrieval/labels holds
 * positional `verdicts` arrays over the same rel/marg/irr scale, read by
 * rank.mjs and floor.mjs; eval/scripts/fit-weights.mjs reads only annotations.
 * So "0 labelled sources" was true of the store the fitter reads and false of
 * the repo, and the ~200 floor below was reported as unmet while 288 verdicts
 * sat one directory over.
 *
 * Counted, never merged: the two stores are joined to different reports by
 * different keys, and adding them into one number would make the fitter look
 * fed when it still sees nothing.
 */
function retrievalVerdictCount() {
  const dir = `${REPO}/eval/retrieval/labels`
  if (!existsSync(dir)) return { files: 0, verdicts: 0 }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  let verdicts = 0
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
    for (const claim of parsed.claims ?? []) verdicts += (claim.verdicts ?? []).length
  }
  return { files: files.length, verdicts }
}

const { annotations, problems } = loadAnnotations()

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  process.exit(1)
}

if (annotations.length === 0) {
  console.error('\nNo annotation files in eval/annotations. See its README for the shape.\n')
  process.exit(1)
}

let claims = 0
let sources = 0
const verdicts = new Map()
const labels = new Map()
let withRoles = 0

for (const annotation of annotations) {
  claims += annotation.claims.length
  if (annotation.draft?.roles) withRoles++
  for (const claim of annotation.claims) {
    if (claim.verdict) verdicts.set(claim.verdict, (verdicts.get(claim.verdict) ?? 0) + 1)
    for (const source of claim.sources ?? []) {
      sources++
      labels.set(source.label, (labels.get(source.label) ?? 0) + 1)
    }
  }
}

console.log(`\nOK — ${annotations.length} file(s), ${claims} claims, ${sources} labelled sources\n`)

if (verdicts.size > 0) {
  console.log('  claim verdicts')
  for (const [verdict, n] of [...verdicts].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${verdict.padEnd(14)} ${n}`)
  }
  console.log('')
}

if (sources > 0) {
  console.log('  source labels')
  for (const label of SOURCE_LABELS) {
    const n = labels.get(label) ?? 0
    console.log(`    ${label.padEnd(14)} ${n}  ${sources ? `(${Math.round((100 * n) / sources)}%)` : ''}`)
  }
  console.log('')
}

console.log(`  drafts with paragraph roles: ${withRoles}/${annotations.length}\n`)

// Honest about statistical power rather than leaving it to be discovered after
// a fit has already been believed. These floors are rules of thumb, not
// thresholds anything enforces — but a fit at n=13 that nobody warned you
// about is how a hand-tuned number acquires the authority of a measurement.
if (sources < 200) {
  const other = retrievalVerdictCount()
  console.log(
    `  NOTE  ${sources} labelled sources in eval/annotations. Fitting the relevance\n` +
      `        floor wants ~200+; below that the threshold moves with two or three\n` +
      `        individual judgements.\n`
  )
  if (other.verdicts > 0) {
    console.log(
      `        eval/retrieval/labels holds ${other.verdicts} per-source verdicts across\n` +
        `        ${other.files} file(s) — the same rel/marg/irr scale, a different store.\n` +
        `        rank.mjs and floor.mjs read those; eval:fit reads only the count above.\n` +
        `        So the labelling exists and the fitter cannot see it. Reconciling the\n` +
        `        two stores is cheaper than labelling ~200 sources again.\n`
    )
  }
}
if (claims < 40) {
  console.log(
    `  NOTE  ${claims} annotated claims. Fitting four scoring weights on this is\n` +
      `        underdetermined — read the leave-one-out column, not the in-sample fit.\n`
  )
}

// Joining to a report is optional: annotation is useful before the pipeline has
// ever run over an essay, and requiring a report would make labelling depend on
// a paid harness run.
let report
try {
  const path = reportPath()
  if (existsSync(path)) report = JSON.parse(readFileSync(path, 'utf8'))
} catch {
  // reportPath() throws when eval/baseline.md names a gitignored report that
  // isn't on disk. Not a validation failure — say so and stop.
}

if (!report) {
  console.log('  No report on disk to cross-check against. Annotations are still valid.\n')
  process.exit(0)
}

const { joined, unmatched } = joinToReport(annotations, report)
console.log(`  joined to report: ${joined.length}/${claims} claims`)
if (unmatched.length > 0) {
  console.log(`  ${unmatched.length} not found in the report (fine if it predates the annotation):`)
  for (const miss of unmatched.slice(0, 8)) console.log(`    ${miss}`)
  if (unmatched.length > 8) console.log(`    … and ${unmatched.length - 8} more`)
}
console.log('')
