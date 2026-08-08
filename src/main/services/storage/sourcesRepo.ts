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

// Case/whitespace-insensitive on purpose — different providers don't always
// agree on DOI casing for the same paper (e.g. one preserves a registrant's
// mixed-case suffix, another normalizes it), and an exact-string match here
// let those show up as two separate Source rows for what's really one
// article once evidence accumulates across multiple analyses over time.
export function normalizeDoi(doi: string): string {
  return doi.toLowerCase().trim()
}

// Matches the stored doi_key column rather than computing lower(trim(doi))
// per row. Same semantics, but a function applied to a column makes the
// UNIQUE(doi) index unusable, so this was a full table scan of an
// ever-growing table for every result of every search.
export function findByDoi(doi: string): Source | null {
  const row = queryOne<SourceRow>('SELECT * FROM sources WHERE doi_key = $key', {
    $key: normalizeDoi(doi)
  })
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
    // raw_json is deliberately not written. It held each provider's entire
    // response payload — an OpenAlex work carries a full inverted abstract
    // index, several KB per paper — and nothing in the app has ever read it
    // back: there is no `raw` field on the Source domain type and no query
    // selects the column. Because sql.js rewrites the whole database file on
    // every write, that dead payload was a permanent tax on every unrelated
    // write, growing with the library. Every field the app actually uses is
    // already normalized into its own column, and anything else can be
    // re-fetched. The column is kept so existing rows stay readable; a
    // migration nulls them out.
    `INSERT INTO sources (id, doi, doi_key, title, authors, year, venue, venue_type, url, pdf_url, abstract, provider, provider_id, citation_count, oa_status, created_at)
     VALUES ($id, $doi, $doiKey, $title, $authors, $year, $venue, $venueType, $url, $pdfUrl, $abstract, $provider, $providerId, $citationCount, $oaStatus, $createdAt)`,
    {
      $id: id,
      $doi: input.doi,
      $doiKey: input.doi ? normalizeDoi(input.doi) : null,
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
