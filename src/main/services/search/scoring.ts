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

export interface ScorableItem {
  venueType: VenueType | null
  year: number | null
  relevanceRank: number
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

  const relevance =
    items.reduce((sum, item) => sum + clamp01(1 - item.relevanceRank / PER_PROVIDER_LIMIT), 0) / items.length

  const breakdown: ScoreBreakdown = { sourceCount, quality, recency, relevance }
  const weighted = 0.25 * sourceCount + 0.3 * quality + 0.15 * recency + 0.3 * relevance
  const score = Math.round(100 * clamp01(weighted))

  return { score, breakdown }
}
