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

// Jaccard overlap between a claim's own words and a candidate source's
// title+abstract — a real, if crude, signal that the source is actually
// ABOUT what the claim says, independent of whatever rank a search provider
// gave it. Deliberately just word overlap rather than an embedding/semantic
// call: it's free (no relay round-trip, no added latency) and good enough to
// catch a search provider's confidently-top-ranked-but-unrelated result,
// which is the actual failure mode this exists to catch.
export function computeTextRelevance(claimText: string, sourceText: string): number {
  const claimWords = extractKeywords(claimText)
  const sourceWords = extractKeywords(sourceText)
  if (claimWords.size === 0 || sourceWords.size === 0) return 0

  let intersection = 0
  for (const word of claimWords) {
    if (sourceWords.has(word)) intersection++
  }
  const union = claimWords.size + sourceWords.size - intersection
  return union === 0 ? 0 : intersection / union
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

export function computeStrengthScore(items: ScorableItem[]): { score: number; breakdown: ScoreBreakdown } {
  if (items.length === 0) {
    const breakdown: ScoreBreakdown = { sourceCount: 0, quality: 0, recency: 0, relevance: 0 }
    return { score: 0, breakdown }
  }

  const currentYear = new Date().getFullYear()

  const sourceCount = Math.min(items.length, SOURCE_COUNT_CAP) / SOURCE_COUNT_CAP

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
