import type {
  AccentColor,
  Analysis,
  AppSettings,
  Citation,
  CitationStyle,
  Claim,
  ClaimType,
  CritiqueVerdict,
  Density,
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
  accentColor?: AccentColor
  density?: Density
  claimSensitivity?: number
  screenWatchHotkeyAccelerator?: string
  screenWatchBlockedApps?: string
}
export type SettingsSetResponse = AppSettings

export type SettingsScanInstalledAppsRequest = Record<string, never>
export interface SettingsScanInstalledAppsResponse {
  // Exe basenames found via Start Menu shortcuts — best-effort, not
  // exhaustive (misses portable installs). Empty means "couldn't tell,"
  // not "nothing is installed."
  found: string[]
}

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

export type WindowMinimizeRequest = Record<string, never>
export interface WindowMinimizeResponse {
  ok: true
}

export type WindowMaximizeToggleRequest = Record<string, never>
export interface WindowMaximizeToggleResponse {
  maximized: boolean
}

export type WindowIsMaximizedRequest = Record<string, never>
export interface WindowIsMaximizedResponse {
  maximized: boolean
}

export interface WindowMaximizeChangedEvent {
  maximized: boolean
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
export interface ScreenWatchWidget {
  rect: ScreenRect
  claimCount: number
  // Full watched-text snapshot, so clicking the widget can trigger a
  // whole-text analysis without a separate round-trip.
  text: string
}

export interface ScreenWatchOverlayUpdateEvent {
  underlines: { id: string; rects: ScreenRect[] }[]
  widget: ScreenWatchWidget | null
}

export interface ScreenWatchHoverEvent {
  claimId: string
  kind: 'claim' | 'widget'
  text: string
  claimType: ClaimType
  // Window-local (same coordinate space as ScreenWatchOverlayUpdateEvent
  // rects) — the specific rect the cursor was actually over, so a claim
  // that wraps multiple lines anchors under the right line rather than
  // always the first one.
  anchor: ScreenRect
}

export interface ScreenWatchAnalyzeClaimRequest {
  text: string
}
export interface ScreenWatchAnalyzeClaimResponse {
  ok: true
}
