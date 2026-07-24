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
  if (!res.ok) return []

  const data = (await res.json()) as { message?: { items?: CrossrefItem[] } }
  const items = data.message?.items ?? []

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
