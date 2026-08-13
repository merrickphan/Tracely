// One-time bootstrap: eval/baseline.md -> eval/annotations/*.json
//
//   npm run eval:import-baseline
//
// The 13 claims already labelled in baseline.md are the only ground truth this
// repo has, and re-typing them by hand would introduce transcription errors
// into the one file everything else is measured against.
//
// THE POSITIONAL JOIN HAPPENS HERE, EXACTLY ONCE, AND IS GUARDED.
// baseline.md's per-claim headings are summaries ("AAP 2014 recommendation /
// majority still start before 8:30"), not the claim text, so the only way to
// recover the verbatim sentence is to join to the report baseline.md names —
// which paths.mjs establishes is the one report that join is valid for. Every
// annotation this writes is keyed by that verbatim text, so nothing downstream
// ever joins by position again. That is the point of running it.
//
// WHAT IT CANNOT RECOVER, and does not guess:
//   - per-source labels. baseline.md names sources in prose ("MMWR School
//     Start Times US 2011-12" for a paper titled "School Start Times for
//     Middle School and High School Students - United States, 2011-12 School
//     Year"), and matching those to report entries needs fuzzy matching that
//     would mislabel silently. Left empty for a human to fill in.
//   - marginal/irrelevant counts. Several are written as prose rather than
//     lists ("two AEA RCT-registry stubs", "five further witch-hunting
//     papers"), so they cannot be counted mechanically.
//   - the claim verdict. "0 rel / 8" is a fact about retrieval, not about
//     whether the sentence is true. Inferring one from the other is exactly
//     the conflation the scoring bug is made of.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { BASELINE, REPO, reportPath, assertAligned } from './paths.mjs'
import { ANNOTATIONS_DIR, splitParagraphs, ESSAYS_DIR } from './annotations.mjs'

const force = process.argv.includes('--force')

const baseline = readFileSync(BASELINE, 'utf8')
// Once — reportPath() announces which report it resolved, and calling it per
// essay printed that line four times.
const REPORT_PATH = reportPath()
const REPORT_NAME = REPORT_PATH.split('/').pop()
const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))

// Only `## ` headings naming an essay file — the others ("## Headline",
// "## Numbers to beat") are commentary and must not be read as essays.
const essayBlocks = []
const lines = baseline.split(/\r?\n/)
let current = null
for (const line of lines) {
  const essay = /^## (\S+\.txt)\s*$/.exec(line)
  if (essay) {
    current = { file: essay[1], claims: [] }
    essayBlocks.push(current)
    continue
  }
  if (/^## /.test(line)) {
    current = null
    continue
  }
  if (!current) continue

  const heading = /^### (.+?)\s*—\s*score\s+(\d+)\s*$/.exec(line)
  if (heading) {
    current.claims.push({ summary: heading[1].trim(), score: Number(heading[2]), rel: null, total: null })
    continue
  }

  const claim = current.claims[current.claims.length - 1]
  if (!claim) continue

  if (claim.citationWorthy === undefined) {
    const worthy = /^citation-worthy:\s*\*\*(\w+)\*\*/.exec(line)
    if (worthy) claim.citationWorthy = worthy[1]
  }

  // "- **1 rel / 8.**", "- **0 rel / 8, and it scored 78 …**"
  const counts = /\*\*(\d+) rel \/ (\d+)/.exec(line)
  if (counts && claim.rel === null) {
    claim.rel = Number(counts[1])
    claim.total = Number(counts[2])
  }
}

if (essayBlocks.length === 0) {
  console.error(`\n${BASELINE} has no "## <name>.txt" sections — nothing to import.\n`)
  process.exit(1)
}

// The guard. paths.mjs makes the same check for its own scripts; without it a
// report with one extra detected claim shifts every summary onto the wrong
// sentence and this writes 13 confidently-wrong annotation files.
const labelled = essayBlocks.flatMap((e) => e.claims)
const reported = report.flatMap((e) => e.claims)
assertAligned(reported, labelled)

if (!existsSync(ANNOTATIONS_DIR)) mkdirSync(ANNOTATIONS_DIR, { recursive: true })

let written = 0
let skipped = 0

for (const block of essayBlocks) {
  const essay = report.find((e) => e.file === block.file)
  if (!essay) {
    console.error(`  skip ${block.file} — the report has no entry for it`)
    skipped++
    continue
  }
  if (essay.claims.length !== block.claims.length) {
    console.error(
      `  skip ${block.file} — report has ${essay.claims.length} claims, baseline labels ${block.claims.length}`
    )
    skipped++
    continue
  }

  const out = `${ANNOTATIONS_DIR}/${block.file.replace(/\.txt$/, '')}.json`
  if (existsSync(out) && !force) {
    console.error(`  skip ${out.split('/').pop()} — already exists (pass --force to overwrite hand edits)`)
    skipped++
    continue
  }

  const text = readFileSync(`${ESSAYS_DIR}/${block.file}`, 'utf8')
  const paragraphs = splitParagraphs(text)

  const claims = block.claims.map((labelledClaim, i) => {
    const reportedClaim = essay.claims[i]
    const offset = text.indexOf(reportedClaim.text)
    const paragraph = paragraphs.find((p) => offset >= p.start && offset < p.end)

    return {
      text: reportedClaim.text,
      ...(paragraph ? { paragraph: paragraph.index } : {}),
      // Deliberately absent, not guessed — see the header. Fill these in by
      // hand; validate-annotations.mjs will tell you what still needs it.
      verdict: null,
      citationWorthy: labelledClaim.citationWorthy ?? null,
      support: { rel: labelledClaim.rel, total: labelledClaim.total },
      note: labelledClaim.summary,
      sources: []
    }
  })

  writeFileSync(
    out,
    JSON.stringify(
      {
        essay: block.file,
        labelledBy: 'imported from eval/baseline.md',
        report: REPORT_NAME,
        imported: true,
        draft: { roles: null },
        claims
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  written++
  console.log(`  wrote ${out.replace(REPO + '/', '')}  (${claims.length} claims)`)
}

console.log(`\n${written} written, ${skipped} skipped.`)
console.log(
  `\nWhat is still missing, and has to be done by hand:\n` +
    `  - per-source labels (rel/marg/irr) — "sources" is empty in every file\n` +
    `  - claim verdicts — "verdict" is null in every file\n` +
    `  - paragraph roles — "draft.roles" is null in every file\n` +
    `\nRun \`npm run eval:validate\` after editing.\n`
)
