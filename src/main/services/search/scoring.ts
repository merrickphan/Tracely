import type { ScoreBreakdown, VenueType } from '@shared/types'

const VENUE_TIER_WEIGHT: Record<VenueType, number> = {
  journal: 1.0,
  conference: 0.8,
  book: 0.6,
  preprint: 0.5,
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
  // Word-overlap relevance against the claim (see computeTextRelevance) —
  // computed by the caller once per item since it needs the claim text,
  // which this module otherwise has no reason to depend on.
  textRelevance: number
}

export function computeStrengthScore(
  items: ScorableItem[],
  // Which metric produced item.textRelevance. Passed rather than inferred
  // because the two scales need different floors, and silently applying the
  // lexical floor to cosine values would let weak matches count as sources.
  metric: RelevanceMetric = 'lexical'
): { score: number; breakdown: ScoreBreakdown } {
  if (items.length === 0) {
    const breakdown: ScoreBreakdown = { sourceCount: 0, quality: 0, recency: 0, relevance: 0 }
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

  const breakdown: ScoreBreakdown = { sourceCount, quality, recency, relevance }
  const weighted = 0.25 * sourceCount + 0.3 * quality + 0.15 * recency + 0.3 * relevance
  const score = Math.round(100 * clamp01(weighted))

  return { score, breakdown }
}
