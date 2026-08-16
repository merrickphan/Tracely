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

// -- unsupported: about the claim, or about the search? ----------------------
//
// The verdict above is the relay's word, and `unsupported` is two findings
// wearing one label: "the evidence I read does not carry this" and "I was
// handed nothing on topic". Only the first says anything about the sentence.
//
// The discriminator is local and already recorded: breakdown.sourceCount is the
// share of the six-source cap that cleared the relevance floor, so 0 means
// nothing retrieved was about this claim. Re-derived here in two lines rather
// than imported, because this is a .mjs scoring script and shared/problemKind.ts
// is TypeScript — keep `isRetrievalMiss` there and this in step with it.
const isRetrievalMiss = (claim) => claim.verdict === 'unsupported' && claim.breakdown.sourceCount === 0

const unsupported = claims.filter((c) => c.claim.verdict === 'unsupported')
const retrievalMisses = unsupported.filter((c) => isRetrievalMiss(c.claim))

console.log(`\n  unsupported verdicts: ${unsupported.length}`)
console.log(`    about the evidence read:  ${unsupported.length - retrievalMisses.length}`)
console.log(`    about the search itself:  ${retrievalMisses.length}  (0 relevant sources retrieved)`)
for (const { claim } of retrievalMisses) {
  console.log(`      · ${claim.text.slice(0, 62)}`)
}

// The sharper question, and the one that decides whether the product is worth
// trusting: how many sentences that are FINE did it accuse?
//
// Derived from expected.json rather than newly judged — a claim pre-registered
// as well-supported or partially-supported is one the run should not have had a
// problem with. Before the 2026-08-16 split, an `unsupported` verdict on a claim
// with no relevant sources became `weak-reasoning`, so both of these were
// printed over correct sentences as "Weak reasoning".
const CLEAN = ['well-supported', 'partially-supported']
const controls = expected.claims.filter((s) => CLEAN.includes(s.expected))
const accused = controls.filter((spec) => {
  const hit = claims.find((c) => c.claim.text.startsWith(spec.claim))
  return hit?.claim.critique && !isRetrievalMiss(hit.claim) && !CLEAN.includes(hit.claim.verdict)
})

console.log(`\n  correct sentences accused of a problem: ${accused.length}/${controls.length}`)
for (const spec of accused) console.log(`    · ${spec.claim.slice(0, 62)}`)

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
