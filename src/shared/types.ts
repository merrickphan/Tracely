export type ClaimType = 'statistic' | 'causal' | 'factual' | 'prediction' | 'opinion'

export type CitationStyle = 'APA' | 'MLA' | 'Chicago'

export type CritiqueVerdict =
  | 'contradicted'
  | 'well-supported'
  | 'partially-supported'
  | 'weak'
  | 'unsupported'

export type VenueType = 'journal' | 'conference' | 'preprint' | 'book' | 'other'

export type SourceProvider = 'openalex' | 'crossref' | 'semanticscholar' | 'pubmed' | 'manual'

export interface Author {
  given?: string
  family: string
}

export interface Claim {
  id: string
  analysisId: string
  text: string
  claimType: ClaimType
  confidence: number
  searchQuery: string
  strengthScore: number | null
  scoreBreakdown: ScoreBreakdown | null
  critique: string | null
  critiqueVerdict: CritiqueVerdict | null
  createdAt: string
}

export interface Analysis {
  id: string
  sourceText: string
  origin: 'main' | 'floating'
  createdAt: string
}

export interface ScoreBreakdown {
  sourceCount: number
  quality: number
  recency: number
  relevance: number
}

export interface Source {
  id: string
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
  createdAt: string
}

export interface EvidenceItem {
  source: Source
  relevanceScore: number
  rank: number
}

export interface Citation {
  id: string
  sourceId: string
  style: CitationStyle
  formattedText: string
  createdAt: string
}

export interface LibraryItem {
  id: string
  sourceId: string
  claimId: string | null
  notes: string | null
  tags: string[]
  savedAt: string
  source: Source
}

export interface AppSettings {
  defaultCitationStyle: CitationStyle
  hotkeyAccelerator: string
  crossrefMailto: string
  enableStrengthSummaries: boolean
  hasSemanticScholarKey: boolean
}
