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
// The dense figure is a starting point from four labelled pairs, not a
// calibration. It is meant to be moved by what `npm run evaluate` reports, and
// should not be treated as settled until it has been.
export const MIN_COUNTABLE_RELEVANCE: Record<RelevanceMetric, number> = {
  lexical: 0.2,
  dense: 0.35
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
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

// Unchanged from before stance existed, so a machine that cannot run the model
// scores exactly as it did rather than drifting to a different scale.
const WEIGHTS_WITHOUT_STANCE = { support: 0, relevance: 0.3, sourceCount: 0.25, quality: 0.3, recency: 0.15 }

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

  const relevantCount = items.filter((item) => item.textRelevance >= MIN_COUNTABLE_RELEVANCE[metric]).length
  const sourceCount = Math.min(relevantCount, SOURCE_COUNT_CAP) / SOURCE_COUNT_CAP

  const quality =
    items.reduce((sum, item) => sum + VENUE_TIER_WEIGHT[item.venueType ?? 'other'], 0) / items.length

  const recency =
    items.reduce((sum, item) => {
      if (item.year === null) return sum + 0.3
      return sum + clamp01(1 - (currentYear - item.year) / RECENCY_WINDOW_YEARS)
    }, 0) / items.length

  // Mostly grounded in actual word overlap with the claim, with the
  // provider's own rank kept as a minor tiebreaker — previously this factor
  // was ONLY the provider's rank, so a search provider's confidently-wrong
  // top result scored as "highly relevant" with no independent check against
  // what the claim actually says.
  const relevance =
    items.reduce((sum, item) => {
      const rankRelevance = clamp01(1 - item.relevanceRank / PER_PROVIDER_LIMIT)
      return sum + (0.75 * item.textRelevance + 0.25 * rankRelevance)
    }, 0) / items.length

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
