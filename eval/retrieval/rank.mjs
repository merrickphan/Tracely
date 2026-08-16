// Where does the relevant source actually RANK?
//
// eval/baseline.md and the 08-09 re-run both report precision — what fraction
// of an evidence list is relevant — and both conclude retrieval is the
// bottleneck. That number is right and the conclusion drawn from it is not
// quite, because precision answers a question the product never asks.
//
// The product asks two things:
//
//   1. Did this claim get ANY genuinely relevant source? That is what decides
//      between 'no-sources' and every other problem kind.
//   2. Is it near the TOP? That is what the reader sees first, what
//      selectCritiqueEvidence sends to the reasoning model, and what a
//      citation offer is built from.
//
// Nothing measured either. Offline and free — labels plus reports already on
// disk, no relay, no provider, no model.
//
//   node eval/retrieval/rank.mjs

import { loadLabelled, pct, REPO } from './load.mjs'

const { rows, sets } = loadLabelled()

const { computeStrengthScore } = await import(
  new URL(`file:///${REPO}/src/main/services/search/scoring.ts`).href
)

// The reports do not carry relevanceRank (the provider's own position), so the
// display index stands in for it. It feeds one quarter of one factor and is
// applied identically either side of the comparison, so it cannot flatter the
// change — but the absolute numbers are approximations, and only the separation
// between bands should be read.
const rescore = (claim) =>
  computeStrengthScore(
    claim.sources.map((s, i) => ({
      venueType: s.venueType,
      year: s.year,
      relevanceRank: i,
      textRelevance: s.textRelevance,
      stance: null
    })),
    'dense'
  ).score

const total = rows.length
const found = rows.filter((r) => r.rel > 0)
const sources = rows.reduce((n, r) => n + r.verdicts.length, 0)
const relSources = rows.reduce((n, r) => n + r.rel, 0)
const margSources = rows.reduce((n, r) => n + r.marg, 0)

const atRank = (k) => found.filter((r) => r.firstRelRank <= k).length
// Averaged over claims that HAVE a relevant source. Averaging over all claims
// folds "found nothing" into "ranked it badly", which are different failures
// with different fixes — and a claim that is unfalsifiable as phrased can never
// be moved by any ranking change.
const mrr = found.reduce((sum, r) => sum + 1 / r.firstRelRank, 0) / found.length

for (const s of sets) {
  console.log(`  ${s.file}  ->  ${s.report}  (${s.labelledBy}${s.spotCheckedBy ? '' : ', NOT spot-checked'})`)
}

// Claims no literature can settle as phrased — unfalsifiable predictions, a
// local council's vote, a close reading of a novel, and a citation to a study
// that does not exist. Retrieval returning nothing for these is the CORRECT
// answer, not a miss, and folding them into the denominator measures the essays
// rather than the search. `answerable !== false` so an unmarked claim counts,
// which keeps the flag opt-in and the default honest.
const answerable = rows.filter((r) => r.labelled.answerable !== false)
const unanswerable = rows.filter((r) => r.labelled.answerable === false)
const foundAnswerable = answerable.filter((r) => r.rel > 0)

console.log(`
  strict precision           ${relSources}/${sources}   ${pct(relSources, sources)}
  counting marginal          ${relSources + margSources}/${sources}   ${pct(relSources + margSources, sources)}

  claims with >=1 relevant   ${found.length}/${total}   ${pct(found.length, total)}
  ...of the ANSWERABLE ones  ${foundAnswerable.length}/${answerable.length}   ${pct(foundAnswerable.length, answerable.length)}
  ...with it ranked 1st      ${atRank(1)}/${found.length}   ${pct(atRank(1), found.length)}
  ...within the top 3        ${atRank(3)}/${found.length}   ${pct(atRank(3), found.length)}
  MRR (of those found)       ${mrr.toFixed(2)}

  ${unanswerable.length} claims marked unanswerable — 0 relevant is the right answer for these,
  and ${unanswerable.filter((r) => r.rel === 0).length} of them did return 0.
`)

console.log('rank of first relevant source, per claim:')
let lastEssay = null
for (const r of rows) {
  if (r.essay !== lastEssay) {
    console.log(`  -- ${r.essay}`)
    lastEssay = r.essay
  }
  const bar = r.verdicts.map((v) => (v === 'rel' ? '#' : v === 'marg' ? '-' : '.')).join('')
  console.log(
    `  ${(r.firstRelRank ?? '—').toString().padStart(2)}  ${bar.padEnd(8)}  ${r.rel}/${r.verdicts.length} rel  ` +
      `score ${String(r.claim.strengthScore).padStart(3)}  ${r.claim.text.slice(0, 46)}`
  )
}
console.log('\n  # relevant · - marginal · . irrelevant, in rank order\n')

// The dilution check, and the reason this script exists.
//
// A score is only worth anything if it moves with how well the claim was
// actually evidenced. `strengthScore` in the report is what the formula
// produced AT THE TIME OF THAT RUN; `computeStrengthScore` is what the current
// one does. Reports recorded after 2026-08-16 already contain the fixed
// formula, so before/after is only meaningful for the older ones — the columns
// agreeing on a newer set is the expected result, not a null one.
const byRel = (min, max) => rows.filter((r) => r.rel >= min && r.rel <= max)
const mean = (list, of) => (list.length ? list.reduce((s, r) => s + of(r), 0) / list.length : NaN)
const asRun = (r) => r.claim.strengthScore
const now = (r) => rescore(r.claim)
const fmt = (n) => (Number.isNaN(n) ? '   — ' : n.toFixed(1).padStart(5))

console.log('mean strength score, by relevant sources actually retrieved:')
console.log('                       as run   current formula')
for (const [label, lo, hi] of [
  ['0 relevant sources', 0, 0],
  ['1-2 relevant', 1, 2],
  ['3+ relevant', 3, 8]
]) {
  const band = byRel(lo, hi)
  console.log(`  ${label.padEnd(20)} ${fmt(mean(band, asRun))}   ${fmt(mean(band, now))}   (${band.length} claims)`)
}

// One number for "does the score track the evidence at all". Rank correlation
// rather than Pearson: the bands are ordinal and the sample is far too small
// for the shape of the relationship to mean anything.
const spearman = (of) => {
  const rank = (values) => {
    const sorted = [...values].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const out = new Array(values.length)
    for (let i = 0; i < sorted.length; ) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++
      const shared = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) out[sorted[k].i] = shared
      i = j + 1
    }
    return out
  }
  const a = rank(rows.map(of))
  const b = rank(rows.map((r) => r.rel))
  const n = rows.length
  const mA = a.reduce((s, v) => s + v, 0) / n
  const mB = b.reduce((s, v) => s + v, 0) / n
  let num = 0
  let dA = 0
  let dB = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - mA) * (b[i] - mB)
    dA += (a[i] - mA) ** 2
    dB += (b[i] - mB) ** 2
  }
  return num / Math.sqrt(dA * dB)
}

console.log(`
  rank correlation with relevant-source count
    as run   ${spearman(asRun).toFixed(2)}
    current  ${spearman(now).toFixed(2)}

  ${total} claims, labelled by one labeller. Read the sign and the size, not the decimal.
`)
