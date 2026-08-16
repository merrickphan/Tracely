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
// Nothing measured either. Offline and free — labels plus a report already on
// disk, no relay, no provider, no model.
//
//   node eval/retrieval/rank.mjs

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

const labels = JSON.parse(readFileSync(`${HERE}/labels-2026-08-10.json`, 'utf8'))
const report = JSON.parse(readFileSync(`${REPO}/eval/reports/${labels.report}`, 'utf8'))

const reported = report.flatMap((essay) => essay.claims.map((claim) => ({ essay: essay.file, claim })))

// Joined by claim-text prefix, never by index. A positional join is what
// eval/scripts/paths.mjs documents as silently attaching every label after an
// inserted claim to the wrong sources.
const rows = labels.claims.map((labelled) => {
  const hit = reported.filter((r) => r.claim.text.startsWith(labelled.claim))
  if (hit.length !== 1) {
    throw new Error(
      `${JSON.stringify(labelled.claim)} matches ${hit.length} claims in ${labels.report} — the join is ambiguous.`
    )
  }
  const { essay, claim } = hit[0]
  if (claim.sources.length !== labelled.verdicts.length) {
    throw new Error(
      `${labelled.claim}: ${claim.sources.length} sources in the report, ${labelled.verdicts.length} verdicts labelled.`
    )
  }
  const firstRel = labelled.verdicts.indexOf('rel')
  return {
    essay,
    claim,
    verdicts: labelled.verdicts,
    rel: labelled.verdicts.filter((v) => v === 'rel').length,
    marg: labelled.verdicts.filter((v) => v === 'marg').length,
    // 1-based rank of the first relevant source, or null if there is none.
    firstRelRank: firstRel === -1 ? null : firstRel + 1
  }
})

const total = rows.length
const found = rows.filter((r) => r.rel > 0)
const sources = rows.reduce((n, r) => n + r.verdicts.length, 0)
const relSources = rows.reduce((n, r) => n + r.rel, 0)
const margSources = rows.reduce((n, r) => n + r.marg, 0)

const atRank = (k) => found.filter((r) => r.firstRelRank <= k).length
// Averaged over claims that HAVE a relevant source. Averaging over all claims
// folds "found nothing" into "ranked it badly", which are different failures
// with different fixes — and the two claims with nothing are unfalsifiable as
// phrased, so no ranking change can ever move them.
const mrr = found.reduce((sum, r) => sum + 1 / r.firstRelRank, 0) / found.length

const pct = (a, b) => `${Math.round((100 * a) / b)}%`

console.log(`report: ${labels.report}   labelled by ${labels.labelledBy}${labels.spotCheckedBy ? '' : ' (NOT spot-checked)'}

  strict precision           ${relSources}/${sources}   ${pct(relSources, sources)}
  counting marginal          ${relSources + margSources}/${sources}   ${pct(relSources + margSources, sources)}

  claims with >=1 relevant   ${found.length}/${total}   ${pct(found.length, total)}
  ...with it ranked 1st      ${atRank(1)}/${found.length}   ${pct(atRank(1), found.length)}
  ...within the top 3        ${atRank(3)}/${found.length}   ${pct(atRank(3), found.length)}
  MRR (of those found)       ${mrr.toFixed(2)}
`)

console.log('rank of first relevant source, per claim:')
for (const r of rows) {
  const bar = r.verdicts.map((v) => (v === 'rel' ? '#' : v === 'marg' ? '-' : '.')).join('')
  console.log(
    `  ${(r.firstRelRank ?? '—').toString().padStart(2)}  ${bar}  ${r.rel}/8 rel  ` +
      `score ${String(r.claim.strengthScore).padStart(3)}  ${r.claim.text.slice(0, 52)}`
  )
}
console.log('\n  # relevant · - marginal · . irrelevant, in rank order\n')

// The dilution check, and the reason this script exists.
//
// A score is only worth anything if it moves with how well the claim was
// actually evidenced. `strengthScore` in the report is what the OLD formula
// produced; `computeStrengthScore` below is what the current one does. Both are
// shown against the same hand labels, so the comparison is of formulas rather
// than of runs.
const { computeStrengthScore } = await import(
  new URL(`file:///${REPO}/src/main/services/search/scoring.ts`).href
)

// The report does not carry relevanceRank (the provider's own position), so the
// display index stands in for it. It feeds one quarter of one factor and is
// applied identically either side of the comparison, so it cannot flatter the
// change — but it does mean the absolute numbers here are approximations, and
// only the separation between the bands should be read.
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

const byRel = (min, max) => rows.filter((r) => r.rel >= min && r.rel <= max)
const mean = (list, of) => (list.length ? list.reduce((s, r) => s + of(r), 0) / list.length : NaN)
const old = (r) => r.claim.strengthScore
const now = (r) => rescore(r.claim)

console.log('mean strength score, by relevant sources actually retrieved:')
console.log('                       before   after')
for (const [label, lo, hi] of [
  ['0 relevant sources', 0, 0],
  ['1-2 relevant', 1, 2],
  ['3+ relevant', 3, 8]
]) {
  const band = byRel(lo, hi)
  console.log(
    `  ${label.padEnd(20)} ${mean(band, old).toFixed(1).padStart(5)}   ${mean(band, now).toFixed(1).padStart(5)}` +
      `   (${band.length} claims)`
  )
}

// One number for "does the score track the evidence at all". Rank correlation
// rather than Pearson: the bands are ordinal and 13 points is far too few for
// the shape of the relationship to mean anything.
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
    before  ${spearman(old).toFixed(2)}
    after   ${spearman(now).toFixed(2)}

  13 claims is a small set and this is one labelling pass by one labeller.
  Read the sign and the size, not the decimal.
`)
