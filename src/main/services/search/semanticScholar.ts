import type { Author, VenueType } from '@shared/types'
import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import { getConfig } from '../storage/config'
import type { NormalizedSourceResult } from './types'

interface S2Author {
  name?: string
}

interface S2Paper {
  paperId: string
  title?: string
  abstract?: string | null
  year?: number | null
  authors?: S2Author[]
  venue?: string | null
  publicationTypes?: string[] | null
  externalIds?: { DOI?: string } | null
  citationCount?: number | null
  openAccessPdf?: { url?: string } | null
  url?: string | null
}

function toVenueType(types: string[] | null | undefined): VenueType | null {
  if (!types || types.length === 0) return null
  const joined = types.join(' ').toLowerCase()
  if (joined.includes('conference')) return 'conference'
  if (joined.includes('journal') || joined.includes('article')) return 'journal'
  if (joined.includes('book')) return 'book'
  return 'other'
}

function toAuthors(authors: S2Author[] | undefined): Author[] {
  return (authors ?? [])
    .map((a) => a.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ family: name }))
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  const apiKey = getConfig().semanticScholarApiKey

  // Without a key, don't ask at all. This is a latency decision backed by two
  // measurements: across the whole labelled baseline Semantic Scholar
  // contributed ZERO sources that survived to any evidence list, and the
  // 1100ms throttle it needs is a per-key promise chain — so on an eight-claim
  // document the last claim waits nearly nine seconds for its turn to be told
  // 429 by a pool shared with every anonymous caller on earth.
  //
  // Paying nine seconds for nothing is worse than not asking. The moment a key
  // is present this reverts to a real provider with a real rate limit, and the
  // key is read from SEMANTIC_SCHOLAR_API_KEY or config.json.
  if (!apiKey) return []

  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'title,abstract,year,authors,venue,publicationTypes,externalIds,citationCount,openAccessPdf,url'
  })

  await throttle('semanticscholar', PROVIDER_MIN_INTERVAL_MS.semanticscholar)
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`, {
    headers: apiKey ? { 'x-api-key': apiKey } : {}
  })
  if (!res.ok) {
    // Semantic Scholar's unauthenticated tier is a single shared pool across
    // every anonymous caller worldwide, so 429 is the normal case without a
    // key, not an anomaly — an eval run saw it answer 4 of 14 queries. It
    // used to return [] silently, which is indistinguishable from "no papers
    // exist" and quietly cost a quarter of the evidence base. A free key is
    // read from SEMANTIC_SCHOLAR_API_KEY, or config.json if set there — there
    // is no Settings field for it yet, despite what this comment once said.
    console.warn(`[search:semanticscholar] ${res.status} ${res.statusText} — no results for "${query}"`)
    return []
  }

  const data = (await res.json()) as { data?: S2Paper[] }
  const papers = data.data ?? []

  return papers.map((paper, index) => ({
    doi: paper.externalIds?.DOI ?? null,
    title: paper.title ?? 'Untitled',
    authors: toAuthors(paper.authors),
    year: paper.year ?? null,
    venue: paper.venue || null,
    venueType: toVenueType(paper.publicationTypes),
    url: paper.url ?? null,
    pdfUrl: paper.openAccessPdf?.url ?? null,
    abstract: paper.abstract ?? null,
    provider: 'semanticscholar',
    providerId: paper.paperId,
    citationCount: paper.citationCount ?? null,
    oaStatus: paper.openAccessPdf?.url ? 'open' : null,
    relevanceRank: index,
    raw: paper
  }))
}
