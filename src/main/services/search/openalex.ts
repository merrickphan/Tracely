import type { Author, VenueType } from '@shared/types'
import { getSetting } from '../storage/settingsRepo'
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
  const mailto = getSetting('crossrefMailto')
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    ...(mailto ? { mailto } : {})
  })

  const res = await fetch(`https://api.openalex.org/works?${params.toString()}`)
  if (!res.ok) return []

  const data = (await res.json()) as { results?: OpenAlexWork[] }
  const works = data.results ?? []

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
