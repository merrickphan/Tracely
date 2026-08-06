export type ClaimType = 'statistic' | 'causal' | 'factual' | 'prediction' | 'opinion'

// A signed-in Supabase account. Entirely separate from Profile (local
// display name/avatar) — this is the real, server-verified unique identity;
// null means signed out / no account configured.
export interface AuthUser {
  id: string
  email: string | null
  // Google sign-in populates this from the Google account automatically;
  // email/password sign-up asks for it explicitly (see AuthSignUpRequest)
  // since Supabase has no built-in name field. Null means "not set yet" —
  // the renderer should prompt for it before showing the main app rather
  // than ever rendering a blank greeting.
  firstName: string | null
  // Defaults to email until the user picks something else (see
  // updateUsername) — that default is also exactly what a Google account
  // already has, so "Google sign-in gets email as a username" needs no
  // separate handling. Null only for the placeholder case of no email
  // either (shouldn't happen in practice — every Supabase auth method here
  // collects an email).
  username: string | null
}

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

export type Theme = 'light' | 'dark' | 'system'

export type AccentColor = 'orange' | 'blue' | 'green' | 'purple'

export type Density = 'comfortable' | 'compact'

export interface AppSettings {
  defaultCitationStyle: CitationStyle
  hotkeyAccelerator: string
  enableStrengthSummaries: boolean
  theme: Theme
  accentColor: AccentColor
  density: Density
  // 0-1, higher = fewer/more-confident-only claims underlined. Exposed to
  // the user instead of a value we keep re-tuning ourselves in code.
  claimSensitivity: number
  screenWatchHotkeyAccelerator: string
  // Opt-in: apps this exe list contains are the ONLY ones Screen Watch
  // reads text from. Empty means nothing is enabled anywhere yet.
  screenWatchAllowedApps: string
}
