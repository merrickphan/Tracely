// What the DISPLAY floor keeps and throws away, on the hand-labelled set.
//
// `rank.mjs` measures the scoring formula over a fixed candidate list. This
// measures a different thing: which of those candidates a student is actually
// offered once `aggregator.ts` filters the returned evidence by
// MIN_COUNTABLE_RELEVANCE and caps it at MAX_EVIDENCE_RESULTS.
//
// The question that matters is not "does precision improve" — it must, that is
// what a floor does. It is "how many genuinely relevant sources does the floor
// throw away", because a dropped relevant source tells a well-supported claim
// it has no support, and that is the failure this product can least afford.
//
// Run: node eval/retrieval/floor.mjs

import { Worker } from 'worker_threads'
import { join } from 'path'
import { loadLabelled, REPO, pct } from './load.mjs'

const FLOOR = Number(process.env.FLOOR ?? 0.42) // MIN_COUNTABLE_RELEVANCE.dense
const CAP = Number(process.env.CAP ?? 5) // MAX_EVIDENCE_RESULTS
const PER_PROVIDER_LIMIT = 6

const { rows } = loadLabelled()

// Same blend aggregator.ts sorts by: 75% relevance to the claim, 25% the
// provider's own rank. Replicated rather than imported because aggregator.ts
// value-imports the providers and the whole electron main graph with them.
const blended = (relevanceRank, textRelevance) =>
  0.75 * textRelevance + 0.25 * Math.max(0, Math.min(1, 1 - relevanceRank / PER_PROVIDER_LIMIT))

const worker = new Worker(join(REPO, 'out', 'main', 'mlWorker.js'), {
  workerData: {
    cacheDir: join(REPO, '.eval-model-cache'),
    localModelPath: join(REPO, 'resources', 'models'),
    allowRemote: false
  }
})

let nextId = 1
function embed(texts) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const onMessage = (m) => {
      if (m.id !== id) return
      worker.off('message', onMessage)
      if (!m.ok) return reject(new Error(m.error))
      const out = []
      for (let i = 0; i < texts.length; i++) out.push(m.data.subarray(i * m.dim, (i + 1) * m.dim))
      resolve(out)
    }
    worker.on('message', onMessage)
    worker.postMessage({ id, op: 'embed', texts })
  })
}

const dot = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

let keptRel = 0
let totalRel = 0
let keptMarg = 0
let totalMarg = 0
let keptIrr = 0
let totalIrr = 0
let shownTotal = 0
let claimsWithNothing = 0
let claimsThatHadRelevant = 0
let claimsLosingTheirOnlyRelevant = 0
const perClaim = []

for (const row of rows) {
  const texts = row.sources.map((s) => `${s.title} ${s.abstract ?? ''}`.trim())
  const [claimVec, ...srcVecs] = await embed([row.claim.text, ...texts])
  const scored = row.sources.map((s, i) => ({
    verdict: row.verdicts[i],
    relevance: dot(claimVec, srcVecs[i]),
    rank: s.relevanceRank ?? i
  }))

  const shown = scored
    .slice()
    .sort((a, b) => blended(b.rank, b.relevance) - blended(a.rank, a.relevance))
    .filter((s) => s.relevance >= FLOOR)
    .slice(0, CAP)

  const relHere = scored.filter((s) => s.verdict === 'rel').length
  const keptRelHere = shown.filter((s) => s.verdict === 'rel').length
  totalRel += relHere
  keptRel += keptRelHere
  totalMarg += scored.filter((s) => s.verdict === 'marg').length
  keptMarg += shown.filter((s) => s.verdict === 'marg').length
  totalIrr += scored.filter((s) => s.verdict === 'irr').length
  keptIrr += shown.filter((s) => s.verdict === 'irr').length
  shownTotal += shown.length

  if (shown.length === 0) claimsWithNothing++
  if (relHere > 0) {
    claimsThatHadRelevant++
    if (keptRelHere === 0) claimsLosingTheirOnlyRelevant++
  }
  perClaim.push({ claim: row.claim.text.slice(0, 52), relHere, keptRelHere, shown: shown.length })
}

console.log(`\nfloor ${FLOOR} (dense), cap ${CAP}, over ${rows.length} labelled claims\n`)
console.log('  kept by verdict')
console.log(`    relevant     ${keptRel}/${totalRel}   ${pct(keptRel, totalRel)}`)
console.log(`    marginal     ${keptMarg}/${totalMarg}   ${pct(keptMarg, totalMarg)}`)
console.log(`    irrelevant   ${keptIrr}/${totalIrr}   ${pct(keptIrr, totalIrr)}   <- the ones being complained about`)
console.log(`\n  sources shown, total   ${shownTotal}  (was ${rows.reduce((n, r) => n + r.sources.length, 0)} labelled)`)
console.log(`  precision of the shown list   ${pct(keptRel + keptMarg, shownTotal)} relevant-or-marginal`)
console.log(`\n  claims shown NOTHING          ${claimsWithNothing}/${rows.length}   ${pct(claimsWithNothing, rows.length)}`)
console.log(
  `  claims that HAD a relevant source and lost all of them   ${claimsLosingTheirOnlyRelevant}/${claimsThatHadRelevant}   <- the cost`
)

const losers = perClaim.filter((c) => c.relHere > 0 && c.keptRelHere === 0)
if (losers.length > 0) {
  console.log('\n  lost a relevant source entirely:')
  for (const c of losers) console.log(`    ${c.relHere} rel available, 0 shown  ${c.claim}`)
}

console.log('\n  labelled by one labeller. Read the sign and the size, not the decimal.\n')
worker.terminate()
