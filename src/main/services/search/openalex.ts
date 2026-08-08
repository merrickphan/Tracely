import type { Author, VenueType } from '@shared/types'
import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
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

/** What a DOI lookup can add to a record another provider found first. */
export interface OpenAlexEnrichment {
  abstract: string | null
  pdfUrl: string | null
  oaStatus: string | null
  landingPageUrl: string | null
  venueType: VenueType | null
  citationCount: number | null
  retracted: boolean
}

// OpenAlex bills by operation, and the difference is 10x. Measured against the
// live X-RateLimit-Credits-Required header rather than inferred from the docs:
//
//   search=...                 10 credits
//   filter=title.search:...    10 credits   (the search is the cost, not the shape)
//   filter=doi:a|b|c            1 credit    (up to 100 DOIs in one call)
//   /works/doi:...              0 credits   (returned 200 with the budget at $0)
//
// So looking up papers we already have DOIs for is close to free, while
// discovering them is the expensive part. That is the whole reason this
// function exists: let Crossref and PubMed — which are free and unmetered —
// do discovery, then use OpenAlex for what it is uniquely good at. It carried
// abstracts for 90% of the labelled baseline where Crossref managed 24%, and
// abstracts are what moved dense relevance separation from 0.192 to 0.238.
const DOI_BATCH_SIZE = 50

/** Bare lowercase DOI, with any doi.org/dx.doi.org prefix stripped. Providers
 *  disagree about which form they return, and OpenAlex keys on the bare one. */
export function normalizeDoi(doi: string): string {
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase()
}

function toEnrichment(work: OpenAlexWork): OpenAlexEnrichment {
  return {
    abstract: reconstructAbstract(work.abstract_inverted_index),
    pdfUrl: work.primary_location?.pdf_url ?? null,
    oaStatus: work.open_access?.oa_status ?? null,
    landingPageUrl: work.primary_location?.landing_page_url ?? null,
    venueType: toVenueType(work.primary_location?.source?.type),
    citationCount: work.cited_by_count ?? null,
    retracted: work.is_retracted === true
  }
}

/**
 * Free singleton fallback, one request per DOI.
 *
 * Worth the extra round trips because singleton gets cost 0 credits and keep
 * working when the daily budget is spent — verified by fetching a paper
 * successfully while `search` was returning 429 with $0 remaining. So a heavy
 * user who has exhausted their budget still gets abstracts and open-access
 * links, just more slowly.
 */
async function enrichIndividually(dois: string[]): Promise<Map<string, OpenAlexEnrichment>> {
  const found = new Map<string, OpenAlexEnrichment>()
  for (const doi of dois) {
    try {
      await throttle('openalex', PROVIDER_MIN_INTERVAL_MS.openalex)
      const res = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`)
      if (!res.ok) continue
      found.set(doi, toEnrichment((await res.json()) as OpenAlexWork))
    } catch {
      // One unreachable paper must not cost the rest their abstracts.
    }
  }
  return found
}

/**
 * Looks up papers by DOI and returns what OpenAlex knows about them.
 *
 * Keyed by normalized DOI. A DOI that OpenAlex has never seen is simply absent
 * from the map rather than being an error — enrichment is additive, and a
 * source with no abstract is still a source.
 */
export async function enrichByDoi(dois: string[]): Promise<Map<string, OpenAlexEnrichment>> {
  const unique = [...new Set(dois.map(normalizeDoi).filter(Boolean))]
  if (unique.length === 0) return new Map()

  const found = new Map<string, OpenAlexEnrichment>()

  for (let i = 0; i < unique.length; i += DOI_BATCH_SIZE) {
    const batch = unique.slice(i, i + DOI_BATCH_SIZE)
    try {
      await throttle('openalex', PROVIDER_MIN_INTERVAL_MS.openalex)
      const params = new URLSearchParams({
        filter: `doi:${batch.join('|')}`,
        per_page: String(batch.length)
      })
      const res = await fetch(`https://api.openalex.org/works?${params.toString()}`)

      if (!res.ok) {
        if (res.status === 429) {
          // The batch costs a credit and the budget is gone, but singletons
          // cost nothing and still answer. Degrade to those rather than
          // dropping abstracts for the rest of the day.
          for (const [doi, enrichment] of await enrichIndividually(batch)) found.set(doi, enrichment)
          continue
        }
        console.warn(`[search:openalex] enrichment ${res.status} ${res.statusText} for ${batch.length} DOIs`)
        continue
      }

      const data = (await res.json()) as { results?: OpenAlexWork[] }
      for (const work of data.results ?? []) {
        if (!work.doi) continue
        found.set(normalizeDoi(work.doi), toEnrichment(work))
      }
    } catch (error) {
      console.warn('[search:openalex] enrichment failed', error)
    }
  }

  return found
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  // No mailto here, deliberately — OpenAlex removed the parameter along with
  // the polite pool: "No more email parameter in your calls—it was never
  // secure and couldn't scale." It meters by budget now, and a search costs 10
  // credits ($0.001) against $0.10/day without a key or $1/day with one.
  // Crossref still honours mailto; OpenAlex ignores it.
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit)
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
