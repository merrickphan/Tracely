import { createHash } from 'crypto'
import { getCached, setCached } from '../storage/cacheRepo'
import { findEvidence, type RankedSourceResult } from './aggregator'
import type { ScoreBreakdown } from '@shared/types'

export interface EvidenceResult {
  evidence: RankedSourceResult[]
  score: number
  breakdown: ScoreBreakdown
}

// 24h — evidence for a given query rarely changes intraday, and the point of
// the cache is the repeat lookups within one writing session.
const CACHE_TTL_MS = 1000 * 60 * 60 * 24

function cacheKey(query: string, claimText: string): string {
  // v5: World Bank results no longer enter stance classification and datasets
  // have a lower quality weight. A v4 hit would preserve both old behaviours
  // for up to 24 hours.
  //
  // claimText is part of the key because score and ordering depend on it via
  // computeTextRelevance, so two claims that happen to produce the same
  // searchQuery must not share an order computed for different claim text.
  return createHash('sha256').update(`search:aggregate::v5::${query}::${claimText}`).digest('hex')
}

/**
 * findEvidence with the SQLite request cache in front of it.
 *
 * This exists because there were two evidence paths and only one of them was
 * cached. The Analyze view went through evidenceHandlers, which cached for
 * 24h; Screen Watch called the aggregator directly at three sites and cached
 * nothing, so every automatic detection and every hover re-hit all four
 * providers from scratch. That is the real reason Semantic Scholar answers
 * 429 — not request volume in the abstract, but the same handful of queries
 * being re-issued indefinitely.
 *
 * The uncached `findEvidence` is deliberately still exported and still used
 * by the eval harness: a cache in front of the thing being measured would
 * serve pre-change results after a retrieval change and quietly invalidate
 * the comparison.
 */
export async function findEvidenceCached(query: string, claimText: string): Promise<EvidenceResult> {
  const key = cacheKey(query, claimText)

  const cached = getCached<EvidenceResult>(key)
  if (cached) return cached

  const { cacheable, ...result } = await findEvidence(query, claimText)
  if (cacheable) setCached(key, 'search:aggregate', result, CACHE_TTL_MS)
  return result
}
