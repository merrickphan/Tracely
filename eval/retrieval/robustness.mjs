// How much of the retrieval conclusion survives the labels being wrong?
//
// `labels-2026-08-10.json` is one pass by one labeller (me), and rank.mjs prints
// confident percentages computed from it. A second pass by the same labeller
// mostly reproduces the first, so re-reading them is not a check. This is:
// re-run every headline under a DIFFERENT defensible labelling and see which
// numbers move.
//
// The alternative is not random noise. It is the two systematic judgement calls
// the labelling actually turned on, each flipped against the original:
//
//   1. Wikipedia as evidence. Labelled `rel` for general historical claims — it
//      does evidence the date Gutenberg introduced movable type. But this
//      product tells students an encyclopedia is not a citable source, and
//      VENUE_TIER_WEIGHT scores `reference` at 0.35 for exactly that reason.
//      Demoting it to `marg` is at least as defensible as keeping it.
//   2. Primacy on 01-C4. "Sleep debt is the PRIMARY DRIVER of the adolescent
//      mental health crisis" — the sources evidence the association and none of
//      them establish primacy. The original labels followed eval/baseline.md's
//      convention of scoring the substance; the rubric read strictly says marg.
//
//   node eval/retrieval/robustness.mjs

import { loadLabelled } from './load.mjs'
import { REPO } from './load.mjs'

const { computeStrengthScore } = await import(new URL(`file:///${REPO}/src/main/services/search/scoring.ts`).href)

const loaded = loadLabelled()

const isWikipedia = (claim, i) => (claim.sources[i].venue ?? '') === 'Wikipedia'

const VARIANTS = {
  'as labelled': (verdict) => verdict,
  strict: (verdict, i, labelled, claim) => {
    if (verdict !== 'rel') return verdict
    if (isWikipedia(claim, i)) return 'marg'
    if (labelled.claim.startsWith('Studies show that this sleep debt')) return 'marg'
    return verdict
  }
}

const build = (mutate) =>
  loaded.rows.map((row) => {
    const verdicts = row.verdicts.map((v, i) => mutate(v, i, row.labelled, row.claim))
    const rescored = computeStrengthScore(
      row.sources.map((s, i) => ({
        venueType: s.venueType,
        year: s.year,
        relevanceRank: i,
        textRelevance: s.textRelevance,
        stance: null
      })),
      'dense'
    ).score
    return {
      verdicts,
      sources: row.sources,
      rel: verdicts.filter((v) => v === 'rel').length,
      before: row.claim.strengthScore,
      after: rescored
    }
  })

const pct = (a, b) => `${Math.round((100 * a) / b)}%`
const mean = (list, of) => (list.length ? list.reduce((s, r) => s + of(r), 0) / list.length : NaN)
const fmt = (n) => (Number.isNaN(n) ? '   — ' : n.toFixed(1).padStart(5))

for (const [name, mutate] of Object.entries(VARIANTS)) {
  const rows = build(mutate)
  const pairs = rows.flatMap((r) => r.verdicts.map((v, i) => ({ v, t: r.sources[i].textRelevance })))
  const rel = pairs.filter((p) => p.v === 'rel')
  const found = rows.filter((r) => r.rel > 0)
  const atRank1 = found.filter((r) => r.verdicts[0] === 'rel').length
  const lowestRel = Math.min(...rel.map((p) => p.t))
  const band = (lo, hi) => rows.filter((r) => r.rel >= lo && r.rel <= hi)

  console.log(`\n=== ${name}`)
  const nSources = rows.reduce((n, r) => n + r.verdicts.length, 0)
  console.log(`  strict precision        ${rel.length}/${nSources}  ${pct(rel.length, nSources)}`)
  console.log(`  claims with >=1 rel     ${found.length}/${rows.length}  ${pct(found.length, rows.length)}`)
  console.log(`  ...ranked 1st           ${atRank1}/${found.length}  ${pct(atRank1, found.length)}`)
  console.log(`  lowest rel similarity   ${lowestRel.toFixed(3)}  (the floor cannot go above this for free)`)
  console.log('  mean score        before / after')
  for (const [label, lo, hi] of [
    ['    0 relevant  ', 0, 0],
    ['    1-2 relevant', 1, 2],
    ['    3+ relevant ', 3, 8]
  ]) {
    const b = band(lo, hi)
    console.log(`  ${label}  ${fmt(mean(b, (r) => r.before))} / ${fmt(mean(b, (r) => r.after))}   (${b.length})`)
  }
}

console.log(`
Read this as: which conclusions are the labels load-bearing for?

  ROBUST   the 0.42 floor. Every relevant source clears it under both
           labellings, so "keeps all real evidence, drops a third of the
           noise" does not depend on the contested calls.
  ROBUST   retrieval finds evidence for most claims (77% / 69%).
  FRAGILE  "ranked 1st" — Wikipedia sits at rank 1 for two claims, so this
           figure swings with one judgement call about encyclopedias.
  FRAGILE  the score inversion. Under 'strict' the BEFORE bands are already
           monotonic: the inversion is carried by 01-C4 alone, which had 3
           relevant sources and the lowest score in the run.
`)
