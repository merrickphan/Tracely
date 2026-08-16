// Does the critique reach the right verdict?
//
// The critique is the most expensive call in the product and the only thing in
// it that can catch a fabricated citation — and until 2026-08-16 no eval had
// ever scored one. eval/RUBRIC.md is the SOURCE-labelling rubric (rel/marg/irr);
// there was no grading standard for the critique at all.
//
// expected.json holds one per claim, written before the run this scores.
//
//   node eval/critique/score.mjs [report.json]

import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

const expected = JSON.parse(readFileSync(`${HERE}/expected.json`, 'utf8'))

// Newest report carrying critiques, unless one is named. Unlike the retrieval
// labels this join needs no fixed report: the expectations are about the CLAIM,
// not about a particular run's sources, so any run over the same essays can be
// scored — which is the point of having them.
const named = process.argv[2]
const reportPath =
  named ??
  `${REPO}/eval/reports/${readdirSync(`${REPO}/eval/reports`)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .find((f) => {
      const r = JSON.parse(readFileSync(`${REPO}/eval/reports/${f}`, 'utf8'))
      return r.flatMap((e) => e.claims).some((c) => c.critique)
    })}`

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const claims = report.flatMap((essay) => essay.claims.map((claim) => ({ essay: essay.file, claim })))

console.log(`report: ${reportPath.split('/').pop()}\n`)

let pass = 0
let scored = 0
const misses = []
const seen = new Set()

for (const spec of expected.claims) {
  const hits = claims.filter((c) => c.claim.text.startsWith(spec.claim))
  if (hits.length === 0) continue
  if (hits.length > 1) throw new Error(`${spec.claim} matches ${hits.length} claims — ambiguous join`)
  const { claim } = hits[0]
  if (!claim.critique) continue

  scored++
  seen.add(claim.verdict)
  const ok = spec.acceptable.includes(claim.verdict)
  if (ok) pass++
  else misses.push({ spec, claim })

  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  expected ${spec.expected.padEnd(20)} got ${String(claim.verdict).padEnd(20)} ` +
      `${claim.text.slice(0, 46)}`
  )
}

console.log(`\n  ${pass}/${scored} within the acceptable set\n`)

// The three verdicts that assert something is FALSE rather than unsupported.
// problemKind ranks fabricated-citation and contradicted-claim as its two most
// severe kinds, above weak reasoning and above every evidence finding, so a
// verdict that never fires is a severity tier that never appears.
const TRUTH_VERDICTS = ['fabricated', 'contradicted', 'overstated']
console.log('  the three verdicts that assert falsehood, not absence:')
for (const v of TRUTH_VERDICTS) {
  const want = expected.claims.filter((s) => s.acceptable.includes(v)).length
  const got = claims.filter((c) => c.claim.verdict === v).length
  console.log(`    ${v.padEnd(14)} fired ${got}x   (acceptable on ${want} claim(s) in this set)`)
}

if (misses.length) {
  console.log('\n  MISSES\n')
  for (const { spec, claim } of misses) {
    console.log(`  expected ${spec.expected}, got ${claim.verdict}`)
    console.log(`    claim:  ${claim.text.slice(0, 110)}`)
    console.log(`    why:    ${spec.why.slice(0, 210)}`)
    if (spec.failureIfWrong) console.log(`    COST:   ${spec.failureIfWrong.slice(0, 210)}`)
    console.log(`    said:   ${(claim.critique || '').replace(/\s+/g, ' ').slice(0, 210)}\n`)
  }
}

process.exit(misses.length > 0 ? 1 : 0)
