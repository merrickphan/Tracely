import type {
  Analysis,
  AppSettings,
  Citation,
  CitationStyle,
  Claim,
  ClaimType,
  CritiqueVerdict,
  EvidenceItem,
  LibraryItem,
  ScoreBreakdown,
  Theme
} from './types'

export interface AnalyzeDetectClaimsRequest {
  text: string
  origin: 'main' | 'floating'
}
export interface AnalyzeDetectClaimsResponse {
  analysisId: string
  claims: Claim[]
}

export interface AnalyzeGetResultRequest {
  analysisId: string
}
export interface AnalyzeGetResultResponse {
  analysis: Analysis
  claims: Claim[]
}

export interface EvidenceFindRequest {
  claimId: string
}
export interface EvidenceFindResponse {
  evidence: EvidenceItem[]
  strengthScore: number
  scoreBreakdown: ScoreBreakdown
}

export interface EvidenceGetForClaimRequest {
  claimId: string
}
export interface EvidenceGetForClaimResponse {
  evidence: EvidenceItem[]
}

export interface CitationGenerateRequest {
  sourceId: string
  style: CitationStyle
}
export interface CitationGenerateResponse {
  citation: string
}

export interface CitationListRequest {
  sourceId: string
}
export interface CitationListResponse {
  citations: Citation[]
}

export interface CritiqueGenerateRequest {
  claimId: string
}
export interface CritiqueGenerateResponse {
  critique: string
  verdict: CritiqueVerdict
}

export interface LibrarySaveRequest {
  sourceId: string
  claimId?: string
  notes?: string
  tags?: string[]
}
export interface LibrarySaveResponse {
  item: LibraryItem
}

export interface LibraryListRequest {
  search?: string
  tag?: string
}
export interface LibraryListResponse {
  items: LibraryItem[]
}

export interface LibraryGetRequest {
  id: string
}
export interface LibraryGetResponse {
  item: LibraryItem
  citations: Citation[]
}

export interface LibraryUpdateRequest {
  id: string
  notes?: string
  tags?: string[]
}
export interface LibraryUpdateResponse {
  item: LibraryItem
}

export interface LibraryRemoveRequest {
  id: string
}
export interface LibraryRemoveResponse {
  ok: true
}

export type SettingsGetRequest = Record<string, never>
export type SettingsGetResponse = AppSettings

export interface SettingsSetRequest {
  defaultCitationStyle?: CitationStyle
  hotkeyAccelerator?: string
  enableStrengthSummaries?: boolean
  theme?: Theme
  screenWatchHotkeyAccelerator?: string
  screenWatchAllowedApps?: string
}
export type SettingsSetResponse = AppSettings

export interface HistoryClearRequest {
  includeLibrary: boolean
}
export interface HistoryClearResponse {
  ok: true
}

export type ClipboardReadRequest = Record<string, never>
export interface ClipboardReadResponse {
  text: string
}

export interface ClipboardWriteRequest {
  text: string
}
export interface ClipboardWriteResponse {
  ok: true
}

export interface WindowTargetRequest {
  target: 'main' | 'floating'
}
export interface WindowTargetResponse {
  ok: true
}

export interface ShellOpenExternalRequest {
  url: string
}
export interface ShellOpenExternalResponse {
  ok: true
}

export interface FloatingClipboardCapturedEvent {
  text: string
}

export interface ScreenWatchSetEnabledRequest {
  enabled: boolean
}
export interface ScreenWatchStatus {
  enabled: boolean
  active: boolean
  processName: string | null
  supportsUnderlines: boolean
  claimCount: number
  lastError: string | null
  blockedApp: string | null
}
export type ScreenWatchSetEnabledResponse = ScreenWatchStatus
export type ScreenWatchGetStatusRequest = Record<string, never>
export type ScreenWatchGetStatusResponse = ScreenWatchStatus

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}
export interface ScreenWatchOverlayUpdateEvent {
  underlines: { id: string; rects: ScreenRect[] }[]
}

export interface ScreenWatchHoverEvent {
  claimId: string
  text: string
  claimType: ClaimType
  // Window-local (same coordinate space as ScreenWatchOverlayUpdateEvent
  // rects), so the overlay renderer can position a tooltip without any unit
  // conversion.
  anchor: ScreenRect
}

export interface ScreenWatchAnalyzeClaimRequest {
  text: string
}
export interface ScreenWatchAnalyzeClaimResponse {
  ok: true
}
