import { randomUUID } from 'crypto'
import type { Author, Source, SourceProvider, VenueType } from '@shared/types'
import { queryOne, run } from './db'

interface SourceRow {
  id: string
  doi: string | null
  title: string
  authors: string
  year: number | null
  venue: string | null
  venue_type: string | null
  url: string | null
  pdf_url: string | null
  abstract: string | null
  provider: string
  provider_id: string | null
  citation_count: number | null
  oa_status: string | null
  created_at: string
}

function toDomain(row: SourceRow): Source {
  return {
    id: row.id,
    doi: row.doi,
    title: row.title,
    authors: JSON.parse(row.authors) as Author[],
    year: row.year,
    venue: row.venue,
    venueType: row.venue_type as VenueType | null,
    url: row.url,
    pdfUrl: row.pdf_url,
    abstract: row.abstract,
    provider: row.provider as SourceProvider,
    providerId: row.provider_id,
    citationCount: row.citation_count,
    oaStatus: row.oa_status,
    createdAt: row.created_at
  }
}

export interface NewSource {
  doi: string | null
  title: string
  authors: Author[]
  year: number | null
  venue: string | null
  venueType: VenueType | null
  url: string | null
  pdfUrl: string | null
  abstract: string | null
  provider: SourceProvider
  providerId: string | null
  citationCount: number | null
  oaStatus: string | null
  raw?: unknown
}

export function findByDoi(doi: string): Source | null {
  const row = queryOne<SourceRow>('SELECT * FROM sources WHERE doi = $doi', { $doi: doi })
  return row ? toDomain(row) : null
}

export function getSourceById(id: string): Source | null {
  const row = queryOne<SourceRow>('SELECT * FROM sources WHERE id = $id', { $id: id })
  return row ? toDomain(row) : null
}

export function upsertSource(input: NewSource): Source {
  if (input.doi) {
    const existing = findByDoi(input.doi)
    if (existing) return existing
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  run(
    `INSERT INTO sources (id, doi, title, authors, year, venue, venue_type, url, pdf_url, abstract, provider, provider_id, citation_count, oa_status, raw_json, created_at)
     VALUES ($id, $doi, $title, $authors, $year, $venue, $venueType, $url, $pdfUrl, $abstract, $provider, $providerId, $citationCount, $oaStatus, $raw, $createdAt)`,
    {
      $id: id,
      $doi: input.doi,
      $title: input.title,
      $authors: JSON.stringify(input.authors),
      $year: input.year,
      $venue: input.venue,
      $venueType: input.venueType,
      $url: input.url,
      $pdfUrl: input.pdfUrl,
      $abstract: input.abstract,
      $provider: input.provider,
      $providerId: input.providerId,
      $citationCount: input.citationCount,
      $oaStatus: input.oaStatus,
      $raw: input.raw ? JSON.stringify(input.raw) : null,
      $createdAt: createdAt
    }
  )

  return {
    id,
    doi: input.doi,
    title: input.title,
    authors: input.authors,
    year: input.year,
    venue: input.venue,
    venueType: input.venueType,
    url: input.url,
    pdfUrl: input.pdfUrl,
    abstract: input.abstract,
    provider: input.provider,
    providerId: input.providerId,
    citationCount: input.citationCount,
    oaStatus: input.oaStatus,
    createdAt
  }
}
