import type { ScoreBreakdown, VenueType } from '@shared/types'
import type { Stance } from '../ml/protocol'

const VENUE_TIER_WEIGHT: Record<VenueType, number> = {
  journal: 1.0,
  // The World Bank result currently identifies a relevant official series but
  // not the observation, geography or year that would settle the claim. It is
  // stronger than a general reference page, but not journal-equivalent until
  // the evidence card carries the actual value being asserted.
  dataset: 0.65,
  conference: 0.8,
  book: 0.6,
  // Level with a book. A chapter in an edited academic collection is refereed
  // by its editors rather than by peer review, which is the same standing the
  // book it sits in has — the split from 'book' is about how it is CITED, not
  // about how good it is.
  'book-chapter': 0.6,
  preprint: 0.5,
  // Deliberately barely above 'other'. An encyclopedia article is a genuine
  // help for orienting on a claim and is not something a student should cite,
  // and the score should say the second part. Its real value is the primary
  // sources it points to.
  reference: 0.35,
  other: 0.3
}

const RECENCY_WINDOW_YEARS = 20
const SOURCE_COUNT_CAP = 6
const PER_PROVIDER_LIMIT = 6

// A source has to cover at least this much of the claim (see
// computeTextRelevance) before it counts toward the sourceCount factor.
// Without a floor that factor measured how many results the four providers
// happened to return, not how many were any good — and since the aggregator
// merges 4 providers x 6 results down to 8, it was at or above the
// 6-source cap essentially always, pinning 25% of the score at a constant
// 1.0 for every claim in the app. A claim nothing relevant was found for
// now actually scores like one.
export type RelevanceMetric = 'lexical' | 'dense'

// Two metrics, two floors, because they are not on the same scale. Claim
// coverage is a fraction of the claim's own words and runs high for a good
// match; cosine similarity between MiniLM embeddings runs lower and compresses
// — measured on the eval's own failure case, genuinely relevant papers sat at
// 0.43-0.54 and irrelevant ones at 0.03-0.23.
//
// The dense figure was a starting point from four labelled pairs, explicitly
// flagged here as "not a calibration ... meant to be moved by what the eval
// reports". 2026-08-16 is that calibration, over 104 hand-labelled sources
// (eval/retrieval/labels-2026-08-10.json, `node eval/retrieval/rank.mjs`).
//
// The signal is good and the threshold was simply in the wrong place. Dense
// similarity separates a relevant source from an irrelevant one at AUC 0.905;
// at 0.35 it admitted 29 of 44 irrelevant sources while every relevant one sat
// at 0.43 or above. Sweeping the floor against the labels:
//
//     floor   rel kept   irrelevant admitted
//     0.350     24/24         29/44
//     0.400     24/24         25/44
//     0.425     24/24         17/44     <- every relevant source still kept
//     0.500     18/24         10/44
//     0.600     13/24          0/44
//
// 0.42 is the last point that costs nothing: past it, precision is bought with
// genuine evidence, and a dropped relevant source tells a well-supported claim
// it has no support — the failure this product can least afford.
//
// Fitted to the minimum of 24 observations by one labeller, so it is a
// calibration and not a constant: 0.42 rather than 0.425 leaves a little room
// under the lowest relevant source seen, and the true minimum is probably lower
// than anything in this sample. Re-run the sweep whenever labels are added.
export const MIN_COUNTABLE_RELEVANCE: Record<RelevanceMetric, number> = {
  lexical: 0.2,
  dense: 0.42
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * The score a stored breakdown would get under TODAY'S weights.
 *
 * `strength_score` is persisted beside the breakdown it was computed from, so
 * every claim searched before a weight change keeps a number from the old
 * formula. After the 2026-08-18 refit that is not a cosmetic staleness: those
 * claims still band as "partially supported" in the editor and the overlay
 * while freshly-searched ones do not, so the same draft reports two different
 * verdicts depending on when each sentence happened to be checked.
 *
 * Re-deriving is exact rather than approximate, and needs no network at all:
 * the score IS the weighted sum of the five stored factors. The only thing
 * `computeStrengthScore` adds on top is the contradiction cap, which requires
 * stance verdicts that a breakdown does not carry — and cannot apply anyway
 * while STANCE_ENABLED is false, since the cap only fires when the balance of
 * stance runs against the claim.
 *
 * Returns null for a claim that was never searched, which must stay null: 0
 * means "we looked and found nothing" and null means "nobody has looked", and
 * problemKind.ts tells the writer different things about them.
 */
export function rescoreFromBreakdown(breakdown: ScoreBreakdown | null): number | null {
  if (!breakdown) return null
  const w = breakdown.support !== 0 ? WEIGHTS_WITH_STANCE : WEIGHTS_WITHOUT_STANCE
  const weighted =
    w.sourceCount * breakdown.sourceCount +
    w.quality * breakdown.quality +
    w.recency * breakdown.recency +
    w.relevance * breakdown.relevance +
    w.support * breakdown.support
  return Math.round(100 * clamp01(weighted))
}

// Words too common to mean anything about topical overlap — filtering these
// out is what stops two completely unrelated results that both happen to
// contain "the study found that people" from looking related.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'by', 'from', 'at', 'into',
  'about', 'than', 'then', 'so', 'such', 'not', 'no', 'can', 'may', 'might', 'will', 'would', 'could',
  'should', 'has', 'have', 'had', 'we', 'they', 'their', 'our', 'more', 'most', 'also', 'which', 'who',
  'study', 'studies', 'research', 'paper', 'article', 'findings', 'found'
])

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )
}

// What fraction of the claim's own content words show up in a candidate
// source's title+abstract — a crude but real signal that the source is
// actually ABOUT what the claim says, independent of whatever rank a search
// provider gave it. Deliberately word overlap rather than an
// embedding/semantic call: it's free (no relay round-trip, no added
// latency) and catches a provider's confidently-top-ranked-but-unrelated
// result, which is the failure mode this exists for.
//
// Denominator is the CLAIM's word count, not the union of both texts. It
// was Jaccard (intersection/union) and that was quietly broken: a claim has
// ~15 content words against an abstract's ~150, so the union is dominated
// by the abstract and the ratio can't structurally exceed ~0.1 no matter
// how well the source matches (6 of 15 claim words matched scores 6/159 =
// 0.04, not 6/15 = 0.40). Two consequences, both bad: every source scored
// as barely-relevant, so the 30%-weighted relevance factor collapsed to
// near-zero for everything and stopped discriminating at all; and sources
// with longer, more informative abstracts were penalized for it, since more
// abstract words meant a bigger union. Claim coverage has neither problem
// and answers the question actually being asked — how much of this claim
// does this source speak to?
export function computeTextRelevance(claimText: string, sourceText: string): number {
  const claimWords = extractKeywords(claimText)
  const sourceWords = extractKeywords(sourceText)
  if (claimWords.size === 0 || sourceWords.size === 0) return 0

  let intersection = 0
  for (const word of claimWords) {
    if (sourceWords.has(word)) intersection++
  }
  return intersection / claimWords.size
}

export interface ScorableItem {
  venueType: VenueType | null
  year: number | null
  relevanceRank: number
  // Relevance against the claim — dense or lexical, see the `metric` argument
  // to computeStrengthScore. Computed by the caller once per item since it
  // needs the claim text, which this module otherwise has no reason to
  // depend on.
  textRelevance: number
  // Whether this source agrees with the claim. `null` means the question was
  // never answered — the model was unavailable, or the source did not clear
  // the relevance bar — which is different from 'unclear', where it was asked
  // and the answer was "this is not evidence either way".
  stance: Stance | null
}

// How many confidently-supporting sources count as a fully supported claim.
// Three rather than the six used for sourceCount: a claim with three papers
// that actually say what it says is well evidenced, and the old count factor
// was measuring how many results four providers happened to return.
const SUPPORT_CAP = 3

// Each contradicting source cancels two supporting ones. Not symmetry —
// finding a paper that says the opposite is a stronger signal about a claim
// than finding another that agrees, because agreement is also what a vague or
// unfalsifiable claim attracts.
const CONTRADICTION_WEIGHT = 2

// A claim with published evidence against it cannot present as well-supported
// no matter how good the journals are or how recent. Without this the venue
// and recency factors alone floor a contradicted claim near 45.
const CONTRADICTED_SCORE_CAP = 30

// Stance-aware weights. Support carries the most because it is the only factor
// that asks the question a reader cares about; venue tier and publication year
// are proxies that a claim can score well on while being wrong.
const WEIGHTS_WITH_STANCE = { support: 0.4, relevance: 0.25, sourceCount: 0.15, quality: 0.15, recency: 0.05 }

/**
 * The weights every shipped build actually uses, because STANCE_ENABLED is
 * false (see services/ml/index.ts) — so this is not a fallback, it is the
 * formula.
 *
 * FITTED, 2026-08-18, against 51 hand-labelled claims via `npm run eval:fit`.
 * These were `{ relevance: .3, sourceCount: .25, quality: .3, recency: .15 }`,
 * chosen by intuition and never measured, and the measurement is damning:
 *
 *     Spearman rho against relevant-source count
 *       old weights                       0.242
 *       fitted, leave-one-out             0.654
 *       these weights                     0.616
 *       noise floor at n=51              ±0.141
 *
 * Quality and recency described the CORPUS, not the sentence. Between them
 * they carried 45% of a score meant to say how well evidenced a claim is, and
 * they are near-constant across claims — every academic search returns recent
 * papers in real journals whether or not any of them is about the claim. That
 * is why nothing ever scored between 1 and 39, why half of everything landed
 * in the 40–69 "partially supported" band, and why `weak-evidence` and
 * `cited-unverified` in problemKind.ts were unreachable.
 *
 * Two deliberate departures from what the fit wanted:
 *
 *   - The fit drove quality to ZERO. It is kept at 0.20, which costs 0.026 rho
 *     — a fifth of the noise floor. The fit's target is COUNT OF RELEVANT
 *     SOURCES, so a factor that does not measure relevance scores zero against
 *     it almost by construction; that is not evidence that venue quality is
 *     worthless to a reader. Zeroing it also collapsed the ≥70 band to nothing,
 *     which is its own broken product.
 *   - The fit wanted MIN_COUNTABLE_RELEVANCE raised to 0.50. It is left where
 *     it is. That floor has its own purpose-built calibration above, over 24
 *     labelled sources, and 0.50 drops SIX of them — telling a well-supported
 *     claim it has no support, the failure this product can least afford. The
 *     rank objective cannot see that harm. Keeping 0.42 costs 0.052 rho, again
 *     inside the noise floor.
 *
 * Recency IS zero. Adding it back at 0.05 measured WORSE (0.652 against
 * 0.672), which makes sense: publication year says nothing about whether a
 * paper is about this sentence.
 *
 * Re-run `npm run eval:fit <report>` whenever labels are added. 38 of the 51
 * labels are model-generated and marked `supportBy` in eval/annotations — only
 * 13 are human, so the DIRECTION here is much better evidenced than the third
 * decimal place.
 */
const WEIGHTS_WITHOUT_STANCE = { support: 0, relevance: 0.5, sourceCount: 0.3, quality: 0.2, recency: 0 }

export function computeStrengthScore(
  items: ScorableItem[],
  // Which metric produced item.textRelevance. Passed rather than inferred
  // because the two scales need different floors, and silently applying the
  // lexical floor to cosine values would let weak matches count as sources.
  metric: RelevanceMetric = 'lexical'
): { score: number; breakdown: ScoreBreakdown } {
  if (items.length === 0) {
    const breakdown: ScoreBreakdown = { sourceCount: 0, quality: 0, recency: 0, relevance: 0, support: 0 }
    return { score: 0, breakdown }
  }

  const currentYear = new Date().getFullYear()

  /**
   * The sources this claim is actually evidenced by — everything else in the
   * list is a retrieval miss that happened to be returned.
   *
   * Every factor below is computed over THIS set, not over `items`. Until
   * 2026-08-16 only `sourceCount` applied the floor and `quality`, `recency`
   * and `relevance` were plain averages over all eight scored sources, which
   * inverted the whole measure. Retrieval returns ~2 relevant sources in 8
   * (eval/retrieval/labels-2026-08-10.json), and the six behind them are
   * usually recent journal articles about something else — so they scored 1.0
   * on venue tier and near 1.0 on recency, and a claim's score was mostly a
   * report on papers that had nothing to do with it.
   *
   * The measurement, over 13 labelled claims:
   *
   *     mean strength score, by relevant sources actually retrieved
   *       0 relevant   60.3
   *       1-2          71.0
   *       3+           58.7
   *
   * A claim with three or more genuinely supporting papers scored LOWER than a
   * claim with none. The highest score in the run (81) went to a claim with one
   * relevant source; a claim with five scored 68, exactly level with an
   * unfalsifiable prediction that retrieved nothing. That is not a weak signal,
   * it is an absent one — and `problemKind.ts` reads this number to decide what
   * to tell the writer, so "well supported" and "nothing found" were arriving
   * at the same verdict.
   *
   * When nothing clears the floor these are 0 rather than "the average of the
   * noise". A claim with no relevant sources should score near zero: that is
   * what `no-sources` means, and the old behaviour floored it around 60 by
   * averaging venue tier and publication year over papers about other subjects.
   */
  const relevant = items.filter((item) => item.textRelevance >= MIN_COUNTABLE_RELEVANCE[metric])
  const sourceCount = Math.min(relevant.length, SOURCE_COUNT_CAP) / SOURCE_COUNT_CAP

  const meanOver = (score: (item: ScorableItem) => number): number =>
    relevant.length === 0 ? 0 : relevant.reduce((sum, item) => sum + score(item), 0) / relevant.length

  const quality = meanOver((item) => VENUE_TIER_WEIGHT[item.venueType ?? 'other'])

  const recency = meanOver((item) =>
    item.year === null ? 0.3 : clamp01(1 - (currentYear - item.year) / RECENCY_WINDOW_YEARS)
  )

  // Mostly grounded in actual word overlap with the claim, with the
  // provider's own rank kept as a minor tiebreaker — previously this factor
  // was ONLY the provider's rank, so a search provider's confidently-wrong
  // top result scored as "highly relevant" with no independent check against
  // what the claim actually says.
  const relevance = meanOver(
    (item) => 0.75 * item.textRelevance + 0.25 * clamp01(1 - item.relevanceRank / PER_PROVIDER_LIMIT)
  )

  const supporting = items.filter((item) => item.stance === 'supports').length
  const contradicting = items.filter((item) => item.stance === 'contradicts').length

  // Deliberately "produced a decisive verdict", not "was asked". An entailment
  // model that answers `unclear` for everything carries no information, and
  // treating that as a real zero would be actively wrong: support is weighted
  // 0.4, so a permanently-zero support factor silently caps every claim in the
  // app near 60 however well evidenced it is.
  //
  // That is not hypothetical. Measured against the labelled baseline with real
  // abstracts, the zero-shot NLI model returned `unclear` for all 21 sources it
  // was asked about — at whole-abstract and sentence granularity alike. Until a
  // model fine-tuned on SciFact replaces it, this branch is the common case,
  // and it must degrade to the old scoring rather than deflate it.
  const stanceDecided = supporting > 0 || contradicting > 0
  const support = stanceDecided
    ? clamp01((supporting - CONTRADICTION_WEIGHT * contradicting) / SUPPORT_CAP)
    : 0

  const w = stanceDecided ? WEIGHTS_WITH_STANCE : WEIGHTS_WITHOUT_STANCE

  const breakdown: ScoreBreakdown = { sourceCount, quality, recency, relevance, support }
  const weighted =
    w.sourceCount * sourceCount +
    w.quality * quality +
    w.recency * recency +
    w.relevance * relevance +
    w.support * support

  let score = Math.round(100 * clamp01(weighted))

  // The case this whole rewrite exists for. eval/baseline.md recorded the
  // claim with ZERO relevant sources scoring 78/100 — the highest in the run —
  // because venue tier, year and count know nothing about whether anyone
  // actually agrees. A claim the literature argues against must not read as
  // strong, and the weighted average alone will not do that: good journals and
  // recent dates floor it around 45.
  // Only when the balance actually runs against the claim, not on any dissent
  // at all. Real literature contains contrarian papers, and capping on the
  // first one scored "three papers agree, one disagrees" identically to "one
  // paper disagrees and nothing supports it" — both landed on exactly 30. The
  // CONTRADICTION_WEIGHT above is what handles ordinary disagreement; this cap
  // is for the case where the evidence found is net against.
  if (contradicting > 0 && contradicting >= supporting) {
    score = Math.min(score, CONTRADICTED_SCORE_CAP)
  }

  return { score, breakdown }
}

/**
 * Which sources a student is actually OFFERED, out of everything retrieved.
 *
 * Separate from scoring on purpose, and the separation is the point. The score
 * reads the calibrated top N whatever their relevance — `computeStrengthScore`
 * applies the floor itself, to the sourceCount factor, and eval/baseline.md was
 * fitted against exactly that set. This decides a different question: what goes
 * in a list someone picks a citation from.
 *
 * A source below the floor is one this module has already decided does not
 * speak to the claim. Offering it as something to CITE is worse than offering
 * nothing, because a student who takes the offer attaches a real reference to a
 * paper about a different subject. Owner, 2026-08-19: *"a lot of them don't
 * even match whatsoever."*
 *
 * Measured over 36 hand-labelled claims / 288 labelled sources
 * (`node eval/retrieval/floor.mjs`), floor 0.42 and cap 5:
 *
 *     precision of the shown list   54% -> 77% relevant-or-marginal
 *     irrelevant sources shown      133 -> 31
 *     relevant sources kept         40/51 (78%)
 *     claims shown nothing at all   2/36
 *
 * The two knobs do different jobs, which the sweep makes plain — the floor
 * removes irrelevant sources and the CAP is what costs relevant ones:
 *
 *     floor  0.30  0.34  0.38  0.42  0.46      cap    3    5    8
 *     rel     80%   80%   78%   78%   78%      rel   61%  78%  94%
 *     irr     39%   35%   30%   23%   20%      irr   14%  23%  38%
 *
 * So 0.42 is the right floor by measurement rather than by inheritance: it
 * keeps every relevant source a floor of 0.30 would, and shows 40% fewer
 * irrelevant ones. The cap of 5 is the owner's call, and its cost is visible
 * above — cap 8 would keep 94% of relevant sources and show 60% more junk.
 *
 * Input must already be sorted by whatever the caller ranks on.
 */
export function selectShownEvidence<T extends { textRelevance: number }>(
  sortedCandidates: readonly T[],
  metric: RelevanceMetric,
  cap: number
): T[] {
  const floor = MIN_COUNTABLE_RELEVANCE[metric]
  return sortedCandidates.filter((item) => item.textRelevance >= floor).slice(0, cap)
}
