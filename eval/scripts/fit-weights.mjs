// Fit the no-stance scoring weights against hand labels, instead of choosing
// them by intuition.
//
//   npm run eval:fit
//
// WHAT IS BEING FITTED, and why only these:
//
// src/main/services/search/scoring.ts weights five factors. `support` is
// weighted 0 on the no-stance path — which src/main/services/ml/index.ts:25
// establishes is the ONLY path a packaged build takes, since the stance model
// is not bundled and remote loading is off. So four factors carry the entire
// score in shipped builds, and those four are what this fits:
//
//   WEIGHTS_WITHOUT_STANCE = { relevance: .3, sourceCount: .25, quality: .3, recency: .15 }
//
// plus MIN_COUNTABLE_RELEVANCE, the textRelevance floor above which a source
// counts toward `sourceCount`. That floor is documented in scoring.ts as "a
// starting point from four labelled pairs, not a calibration", with the note
// that it is meant to be moved by what the eval reports. This is that.
//
// THE TARGET: how many of a claim's retrieved sources a human called `rel`.
// The score's job is to tell a student how well evidenced their sentence is,
// so a score that does not track relevant-source count is not measuring what
// it claims to. eval/baseline.md records the failure directly — the claim with
// ZERO relevant sources scored 78, the highest in the run.
//
// THE METRIC: Spearman rank correlation, not squared error. Nothing depends on
// the score's absolute calibration; what matters is that a better-evidenced
// claim outranks a worse-evidenced one. Spearman is also the metric that
// survives n=13 — a mean or an R² over 13 points moves with any single claim.
//
// HONESTY ABOUT POWER: four free weights on 13 claims is underdetermined, and
// the in-sample fit will always look better than the shipped weights because it
// is allowed to see the answer. Read the LEAVE-ONE-OUT column. It refits from
// scratch with each claim held out and scores only the held-out prediction, so
// it cannot memorise. If leave-one-out does not beat current, the fit found
// noise and the honest conclusion is "collect more labels", not "ship this".

import { readFileSync } from 'fs'
import { loadAnnotations, joinToReport } from './annotations.mjs'
import { reportPath } from './paths.mjs'

const FACTORS = ['relevance', 'sourceCount', 'quality', 'recency']

/** What scoring.ts ships today, for the no-stance path. */
const CURRENT = { relevance: 0.3, sourceCount: 0.25, quality: 0.3, recency: 0.15 }
/** MIN_COUNTABLE_RELEVANCE.lexical — the reports were produced on the lexical metric. */
const CURRENT_FLOOR = 0.2

const SOURCE_COUNT_CAP = 6
const PER_PROVIDER_LIMIT = 6

const { annotations, problems } = loadAnnotations()
if (problems.length > 0) {
  console.error(`\nAnnotations do not validate — refusing to fit.\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\nRun \`npm run eval:validate\`.\n`)
  process.exit(1)
}

const report = JSON.parse(readFileSync(reportPath(), 'utf8'))
const { joined, unmatched } = joinToReport(annotations, report)

if (unmatched.length > 0) {
  console.log(`  ${unmatched.length} annotated claim(s) not in this report — excluded from the fit.`)
}

// Only claims with a recorded relevant-source count can contribute a target.
const rows = joined
  .filter((row) => typeof row.annotation.support?.rel === 'number')
  .map((row) => ({
    essay: row.essay,
    text: row.reported.text,
    shipped: row.reported.strengthScore,
    rel: row.annotation.support.rel,
    total: row.annotation.support.total ?? row.reported.sources.length,
    sources: row.reported.sources
  }))

if (rows.length < 5) {
  console.error(`\nOnly ${rows.length} claims carry a relevant-source count — not enough to fit anything.\n`)
  process.exit(1)
}

/**
 * Recompute the three factors that depend on the source list, at a given
 * relevance floor. `quality` and `recency` do not depend on the floor, but are
 * recomputed here anyway so the whole vector comes from one place and cannot
 * drift from the report's own breakdown.
 *
 * Mirrors computeStrength in src/main/services/search/scoring.ts. Kept in sync
 * by hand — these are .mjs scripts and cannot import the TypeScript source.
 */
const VENUE_TIER_WEIGHT = {
  journal: 1.0,
  dataset: 0.65,
  conference: 0.8,
  book: 0.6,
  preprint: 0.5,
  reference: 0.35,
  other: 0.3
}
const RECENCY_WINDOW_YEARS = 20
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function factorsFor(sources, floor, currentYear) {
  if (sources.length === 0) {
    return { relevance: 0, sourceCount: 0, quality: 0, recency: 0 }
  }
  const relevantCount = sources.filter((s) => (s.textRelevance ?? 0) >= floor).length
  const sourceCount = Math.min(relevantCount, SOURCE_COUNT_CAP) / SOURCE_COUNT_CAP

  const quality =
    sources.reduce((sum, s) => sum + (VENUE_TIER_WEIGHT[s.venueType ?? 'other'] ?? 0.3), 0) / sources.length

  const recency =
    sources.reduce((sum, s) => {
      if (s.year == null) return sum + 0.3
      return sum + clamp01(1 - (currentYear - s.year) / RECENCY_WINDOW_YEARS)
    }, 0) / sources.length

  // The report does not persist per-source relevanceRank, so the rank
  // tiebreaker is taken from the source's position in the stored list — which
  // is the order the aggregator emitted, i.e. the same ordering rank encodes.
  const relevance =
    sources.reduce((sum, s, i) => {
      const rankRelevance = clamp01(1 - Math.min(i, PER_PROVIDER_LIMIT) / PER_PROVIDER_LIMIT)
      return sum + (0.75 * (s.textRelevance ?? 0) + 0.25 * rankRelevance)
    }, 0) / sources.length

  return { relevance, sourceCount, quality, recency }
}

const YEAR = new Date(report.generatedAt ?? Date.now()).getFullYear() || new Date().getFullYear()

// The factors depend on the floor but NOT on the weights, and the grid search
// evaluates ~16k weight vectors per floor per leave-one-out fold. Recomputing
// them inside the loop turned a 117-computation problem into a 20-million one.
const factorCache = new Map()
function factorsCached(row, floor) {
  const key = `${row.text}::${floor}`
  let cached = factorCache.get(key)
  if (!cached) {
    cached = factorsFor(row.sources, floor, YEAR)
    factorCache.set(key, cached)
  }
  return cached
}

function scoreWith(row, weights, floor) {
  const f = factorsCached(row, floor)
  return 100 * clamp01(FACTORS.reduce((sum, k) => sum + weights[k] * f[k], 0))
}

/** Average ranks, so ties (common — several claims share a rel count) don't
 *  fabricate an ordering the labels never asserted. */
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const out = new Array(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const mean = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k][1]] = mean
    i = j + 1
  }
  return out
}

function spearman(xs, ys) {
  const rx = ranks(xs)
  const ry = ranks(ys)
  const n = xs.length
  const mx = rx.reduce((a, b) => a + b, 0) / n
  const my = ry.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy)
}

/** Weight vectors on a 0.05 simplex — 1771 of them, exhaustive and instant.
 *  A grid rather than gradient descent because the objective is a rank
 *  correlation: piecewise-constant, so it has no useful gradient. */
function* weightGrid(step = 0.05) {
  const n = Math.round(1 / step)
  for (let a = 0; a <= n; a++) {
    for (let b = 0; a + b <= n; b++) {
      for (let c = 0; a + b + c <= n; c++) {
        const d = n - a - b - c
        yield {
          relevance: a * step,
          sourceCount: b * step,
          quality: c * step,
          recency: d * step
        }
      }
    }
  }
}

const FLOORS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]

function bestFit(trainRows) {
  let best = null
  for (const floor of FLOORS) {
    for (const weights of weightGrid()) {
      const predicted = trainRows.map((r) => scoreWith(r, weights, floor))
      const rho = spearman(predicted, trainRows.map((r) => r.rel))
      if (!best || rho > best.rho) best = { rho, weights, floor }
    }
  }
  return best
}

const targets = rows.map((r) => r.rel)

// Three things to compare, and the third is the only one that means anything.
const shippedRho = spearman(rows.map((r) => r.shipped), targets)
const recomputedRho = spearman(rows.map((r) => scoreWith(r, CURRENT, CURRENT_FLOOR)), targets)
const fit = bestFit(rows)

// Leave-one-out: refit from scratch without claim i, predict claim i, correlate
// the held-out predictions. This is the number that cannot memorise the labels.
const heldOut = rows.map((_, i) => {
  const train = rows.filter((_, j) => j !== i)
  const f = bestFit(train)
  return scoreWith(rows[i], f.weights, f.floor)
})
const looRho = spearman(heldOut, targets)

const pct = (v) => (v >= 0 ? ' ' : '') + v.toFixed(3)

console.log(`\nFitting no-stance weights against ${rows.length} annotated claims\n`)
console.log(`  Spearman rho vs. relevant-source count (1.0 = perfect ordering, 0 = none)\n`)
console.log(`    shipped scores, as recorded in the report   ${pct(shippedRho)}`)
console.log(`    current weights, recomputed here            ${pct(recomputedRho)}`)
console.log(`    best fit, IN SAMPLE (sees the answer)       ${pct(fit.rho)}`)
console.log(`    best fit, LEAVE-ONE-OUT  <- the real one    ${pct(looRho)}\n`)

console.log(`  Best in-sample weights (floor ${fit.floor}):`)
for (const factor of FACTORS) {
  const now = CURRENT[factor]
  const next = fit.weights[factor]
  const arrow = next > now ? 'up' : next < now ? 'down' : '  '
  console.log(`    ${factor.padEnd(12)} ${now.toFixed(2)} -> ${next.toFixed(2)}  ${arrow}`)
}
console.log(`    ${'floor'.padEnd(12)} ${CURRENT_FLOOR.toFixed(2)} -> ${fit.floor.toFixed(2)}\n`)

// The specific failure baseline.md calls out, checked directly rather than
// left to be inferred from a correlation.
const worst = rows.reduce((a, b) => (a.rel <= b.rel ? a : b))
const shippedRank = [...rows].sort((a, b) => b.shipped - a.shipped).indexOf(worst) + 1
const fitted = rows.map((r) => ({ ...r, s: scoreWith(r, fit.weights, fit.floor) }))
const fittedWorst = fitted.find((r) => r.text === worst.text)
const fittedRank = [...fitted].sort((a, b) => b.s - a.s).indexOf(fittedWorst) + 1

console.log(`  The worst-evidenced claim (${worst.rel} relevant of ${worst.total}):`)
console.log(`    "${worst.text.slice(0, 66)}…"`)
console.log(`    shipped   score ${Math.round(worst.shipped)}  — rank ${shippedRank} of ${rows.length}`)
console.log(`    fitted    score ${Math.round(fittedWorst.s)}  — rank ${fittedRank} of ${rows.length}\n`)

// "Leave-one-out is higher" is NOT enough to act on, and treating it that way
// was this script's own first bug: it declared a 0.056 gain at n=13 a win.
// The standard error of Spearman's rho is about 1/sqrt(n-1) — 0.29 at n=13 —
// so a gain has to clear roughly that before it means anything at all. A tool
// built to stop weights being chosen by vibes must not then choose them by
// noise.
const SE = 1 / Math.sqrt(rows.length - 1)
const gain = looRho - recomputedRho

console.log(`  Noise floor at n=${rows.length}: +-${SE.toFixed(3)} (1 SE of Spearman's rho)`)
console.log(`  Leave-one-out gain over current: ${gain >= 0 ? '+' : ''}${gain.toFixed(3)}\n`)

// A weight vector parked on a corner of the simplex is a second overfitting
// tell, independent of the correlation: it means one factor explained the
// training folds and the grid had no reason to keep the others.
const degenerate = FACTORS.filter((f) => fit.weights[f] >= 0.8)

if (gain <= SE) {
  console.log(
    `  VERDICT  Not distinguishable from noise. The in-sample fit (${fit.rho.toFixed(3)}) is\n` +
      `           much higher than leave-one-out (${looRho.toFixed(3)}), which is what fitting\n` +
      `           ${FACTORS.length} weights on ${rows.length} claims looks like. Do NOT change scoring.ts on\n` +
      `           this. Label more sources — see eval/annotations/README.md.\n`
  )
} else {
  console.log(
    `  VERDICT  Leave-one-out clears the noise floor. The direction is real; the\n` +
      `           exact numbers are still fitted on ${rows.length} claims. Re-run \`npm run evaluate\`\n` +
      `           after changing scoring.ts — this measures ranking only, not retrieval.\n`
  )
}

if (degenerate.length > 0) {
  console.log(
    `  WARNING  The fit put ${degenerate.map((f) => `${f}=${fit.weights[f].toFixed(2)}`).join(', ')} — a corner of the\n` +
      `           weight simplex. That is a one-factor model, not a rebalance, and it is\n` +
      `           what overfitting looks like even when the correlation improves.\n`
  )
}

// Absolute scores from the fit are meaningless — Spearman is invariant to any
// monotone rescaling, so nothing in this optimisation constrains the level.
// Worth saying, because "the fitted weights score it 96" reads like a result.
console.log(
  `  Absolute fitted scores are uncalibrated: rank correlation is invariant to\n` +
    `  rescaling, so only the ORDER above is fitted, never the number.\n`
)
