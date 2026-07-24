import * as crossref from './crossref'
import * as openalex from './openalex'
import * as pubmed from './pubmed'
import * as semanticScholar from './semanticScholar'
import { computeStrengthScore } from './scoring'
import type { NormalizedSourceResult } from './types'

const PER_PROVIDER_LIMIT = 6
const MAX_MERGED_RESULTS = 8

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function dedupeKey(item: NormalizedSourceResult): string {
  if (item.doi) return `doi:${item.doi.toLowerCase()}`
  return `title:${normalizeTitle(item.title)}:${item.year ?? ''}`
}

async function safeSearch(
  name: string,
  fn: (query: string, limit?: number) => Promise<NormalizedSourceResult[]>,
  query: string
): Promise<NormalizedSourceResult[]> {
  try {
    return await fn(query, PER_PROVIDER_LIMIT)
  } catch (error) {
    console.error(`[search:${name}]`, error)
    return []
  }
}

export async function findEvidence(
  query: string
): Promise<{ evidence: NormalizedSourceResult[]; score: number; breakdown: ReturnType<typeof computeStrengthScore>['breakdown'] }> {
  const results = await Promise.all([
    safeSearch('openalex', openalex.search, query),
    safeSearch('crossref', crossref.search, query),
    safeSearch('semanticscholar', semanticScholar.search, query),
    safeSearch('pubmed', pubmed.search, query)
  ])

  const merged = new Map<string, NormalizedSourceResult>()
  for (const providerResults of results) {
    for (const item of providerResults) {
      const key = dedupeKey(item)
      const existing = merged.get(key)
      if (!existing || item.relevanceRank < existing.relevanceRank) {
        merged.set(key, item)
      }
    }
  }

  const evidence = Array.from(merged.values())
    .sort((a, b) => a.relevanceRank - b.relevanceRank)
    .slice(0, MAX_MERGED_RESULTS)

  const { score, breakdown } = computeStrengthScore(
    evidence.map((e) => ({ venueType: e.venueType, year: e.year, relevanceRank: e.relevanceRank }))
  )

  return { evidence, score, breakdown }
}
