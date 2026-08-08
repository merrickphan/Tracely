import type { Author, VenueType } from '@shared/types'
import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import { politePoolMailto } from '../storage/settingsRepo'
import type { NormalizedSourceResult } from './types'

interface OpenAlexAuthorship {
  author?: { display_name?: string }
}

interface OpenAlexWork {
  id: string
  doi?: string | null
  title?: string | null
  display_name?: string | null
  publication_year?: number | null
  authorships?: OpenAlexAuthorship[]
  primary_location?: {
    source?: { display_name?: string | null; type?: string | null }
    landing_page_url?: string | null
    pdf_url?: string | null
  } | null
  open_access?: { oa_status?: string | null }
  cited_by_count?: number | null
  abstract_inverted_index?: Record<string, number[]> | null
  is_retracted?: boolean | null
  is_paratext?: boolean | null
}

function toAuthors(authorships: OpenAlexAuthorship[] | undefined): Author[] {
  if (!authorships) return []
  return authorships
    .map((a) => a.author?.display_name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ family: name }))
}

function toVenueType(type: string | null | undefined): VenueType | null {
  switch (type) {
    case 'journal':
      return 'journal'
    case 'conference':
      return 'conference'
    case 'repository':
    case 'preprint':
      return 'preprint'
    case 'book':
    case 'book-series':
      return 'book'
    default:
      return type ? 'other' : null
  }
}

function reconstructAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null
  const positions: string[] = []
  for (const [word, occurrences] of Object.entries(index)) {
    for (const pos of occurrences) positions[pos] = word
  }
  const text = positions.filter(Boolean).join(' ')
  return text || null
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  // Sent for identification only. OpenAlex no longer runs a polite pool — it
  // meters by budget now ($0.001/request, $0.10/day anonymous, $1/day with a
  // free API key), so this does not affect the rate limit. Kept because it is
  // free, and because being identifiable is what lets a provider contact you
  // instead of blocking you.
  const mailto = politePoolMailto()
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    ...(mailto ? { mailto } : {})
  })

  await throttle('openalex', PROVIDER_MIN_INTERVAL_MS.openalex)
  const res = await fetch(`https://api.openalex.org/works?${params.toString()}`)
  if (!res.ok) {
    // 429 here is a spent daily budget, not a burst limit, and it is worth
    // saying so plainly: retrying does not help, and the whole provider is
    // dark until midnight UTC. Without this the only symptom is an evidence
    // list that is quietly shorter than it should be.
    if (res.status === 429) {
      const resetSeconds = Number(res.headers.get('retry-after') ?? 0)
      const hours = resetSeconds > 0 ? ` — resets in ${(resetSeconds / 3600).toFixed(1)}h` : ''
      console.warn(
        `[search:openalex] daily budget exhausted${hours}. Results will be missing OpenAlex ` +
          `until it resets. A free API key raises the budget from $0.10/day to $1/day.`
      )
      return []
    }
    console.warn(`[search:openalex] ${res.status} ${res.statusText} — no results for "${query}"`)
    return []
  }

  const data = (await res.json()) as { results?: OpenAlexWork[] }
  // Retracted papers are the worst possible evidence — the literature has
  // formally withdrawn them — and paratext is a work record for a journal's
  // front matter, cover, or table of contents rather than a paper at all.
  // Both were being surfaced to students as citable sources. Filtering
  // after the fetch rather than via an API filter param keeps the request
  // identical for every provider and costs one pass over six records.
  const works = (data.results ?? []).filter((w) => w.is_retracted !== true && w.is_paratext !== true)

  return works.map((work, index) => ({
    doi: work.doi ? work.doi.replace('https://doi.org/', '') : null,
    title: work.title ?? work.display_name ?? 'Untitled',
    authors: toAuthors(work.authorships),
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    venueType: toVenueType(work.primary_location?.source?.type),
    url: work.primary_location?.landing_page_url ?? (work.doi ?? null),
    pdfUrl: work.primary_location?.pdf_url ?? null,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    provider: 'openalex',
    providerId: work.id,
    citationCount: work.cited_by_count ?? null,
    oaStatus: work.open_access?.oa_status ?? null,
    relevanceRank: index,
    raw: work
  }))
}
