import type { Author, VenueType } from '@shared/types'
import { getSetting } from '../storage/settingsRepo'
import type { NormalizedSourceResult } from './types'

interface CrossrefAuthor {
  given?: string
  family?: string
}

interface CrossrefItem {
  DOI?: string
  title?: string[]
  author?: CrossrefAuthor[]
  'container-title'?: string[]
  type?: string
  URL?: string
  'is-referenced-by-count'?: number
  abstract?: string
  issued?: { 'date-parts'?: number[][] }
}

function toVenueType(type: string | undefined): VenueType | null {
  if (!type) return null
  if (type.includes('journal')) return 'journal'
  if (type.includes('proceedings') || type.includes('conference')) return 'conference'
  if (type.includes('book')) return 'book'
  return 'other'
}

// Crossref indexes the whole scholarly record, not just papers: a plain
// keyword query routinely returns journal issues, whole volumes, component
// figures, peer-review reports and grant records, all of which arrived here
// as "sources" a student could cite. These are the record types that are
// never the thing someone means to cite.
const NON_ARTICLE_TYPES = new Set([
  'journal-issue',
  'journal-volume',
  'journal',
  'book-series',
  'book-set',
  'component',
  'peer-review',
  'grant',
  'report-component',
  'edited-book'
])

function stripTags(text: string | undefined): string | null {
  if (!text) return null
  const stripped = text.replace(/<[^>]+>/g, '').trim()
  return stripped || null
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  const mailto = getSetting('crossrefMailto')
  const params = new URLSearchParams({
    query,
    rows: String(limit),
    ...(mailto ? { mailto } : {})
  })

  const res = await fetch(`https://api.crossref.org/works?${params.toString()}`)
  if (!res.ok) {
    console.warn(`[search:crossref] ${res.status} ${res.statusText} — no results for "${query}"`)
    return []
  }

  const data = (await res.json()) as { message?: { items?: CrossrefItem[] } }
  // An untitled record can't be presented or cited either — it's almost
  // always a metadata stub rather than a real work.
  const items = (data.message?.items ?? []).filter(
    (item) => !NON_ARTICLE_TYPES.has(item.type ?? '') && Boolean(item.title?.[0])
  )

  return items.map((item, index) => ({
    doi: item.DOI ?? null,
    title: item.title?.[0] ?? 'Untitled',
    authors: (item.author ?? []).map((a): Author => ({ given: a.given, family: a.family ?? 'Unknown' })),
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
    venue: item['container-title']?.[0] ?? null,
    venueType: toVenueType(item.type),
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : null),
    pdfUrl: null,
    abstract: stripTags(item.abstract),
    provider: 'crossref',
    providerId: item.DOI ?? null,
    citationCount: item['is-referenced-by-count'] ?? null,
    oaStatus: null,
    relevanceRank: index,
    raw: item
  }))
}
