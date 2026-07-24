import type { Author, SourceProvider, VenueType } from '@shared/types'

export interface NormalizedSourceResult {
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
  /** 0 = most relevant, per the provider's own ranking of the query. */
  relevanceRank: number
  raw: unknown
}
