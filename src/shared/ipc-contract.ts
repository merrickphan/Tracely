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
  FontSize,
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
  fontSize?: FontSize
  claimSensitivity?: number
  screenWatchHotkeyAccelerator?: string
  screenWatchAllowedApps?: string
}
export type SettingsSetResponse = AppSettings

export type SettingsScanInstalledAppsRequest = Record<string, never>
export interface ScannedApp {
  name: string
  exe: string
}
export interface SettingsScanInstalledAppsResponse {
  // Installed apps found via the Windows installed-programs registry data —
  // best-effort, not exhaustive (see scan-apps.ps1 for what gets dropped
  // and why). Empty means "couldn't tell," not "nothing is installed."
  found: ScannedApp[]
}

// Real, locally-persisted profile info — no account/server involved, this
// is just local display preferences (name shown in Settings, avatar image).
// Kept as its own get/set pair rather than folded into AppSettings so the
// avatar (a data URL round-trip on set, a file path at rest) never has to
// travel through the plain settings:get call every other feature also uses.
export type ProfileGetRequest = Record<string, never>
export interface ProfileInfo {
  firstName: string
  lastName: string
  username: string
  bio: string
  // file:// URL to the locally-stored avatar image, or null if none set.
  avatarUrl: string | null
}
export type ProfileGetResponse = ProfileInfo

export interface ProfileSetRequest {
  firstName?: string
  lastName?: string
  username?: string
  bio?: string
  // Raw data URL (e.g. "data:image/png;base64,...") from a freshly-picked
  // file, written to disk server-side; pass null to remove the avatar.
  // Omit entirely to leave the existing avatar untouched.
  avatarDataUrl?: string | null
}
export type ProfileSetResponse = ProfileInfo

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
// Real per-claimType counts over the currently-flagged claims. Deliberately
// NOT an evidence-quality judgment — no evidence search runs during Screen
// Watch (see costGuard.ts), so Tracely never actually checks whether a
// claim is unverified, missing a citation, etc. This only reports what's
// real: the claim type detectClaims assigned it.
export interface ScreenWatchWidgetBreakdown {
  statisticCount: number
  factualCount: number
  otherCount: number
}
export interface ScreenWatchWidget {
  rect: ScreenRect
  // Whether `rect` is the collapsed launcher circle or the expanded stats
  // panel — toggled via SCREENWATCH_SET_WIDGET_EXPANDED, recomputed here
  // (not client-side) so hoverTracking.ts's click-through hit-testing and
  // the renderer's draw position always agree on where the widget actually
  // is.
  expanded: boolean
  claimCount: number
  breakdown: ScreenWatchWidgetBreakdown
  // Average claim-detection confidence (0-100) across currently-flagged
  // claims — real, already-computed data. Shown as the ring's "Sourced" %
  // since no evidence search runs in this flow to produce a true sourced
  // percentage; it's the closest real signal, not a literal sourced rate.
  avgConfidencePercent: number
  // Full watched-text snapshot, so clicking the widget can trigger a
  // whole-text analysis without a separate round-trip.
  text: string
}

export interface ScreenWatchOverlayUpdateEvent {
  underlines: { id: string; rects: ScreenRect[]; claimType: ClaimType }[]
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

export interface ScreenWatchSetWidgetExpandedRequest {
  expanded: boolean
}
export interface ScreenWatchSetWidgetExpandedResponse {
  ok: true
}

export type ScreenWatchWidgetDragStartRequest = Record<string, never>
export interface ScreenWatchWidgetDragStartResponse {
  ok: true
}

export interface ScreenWatchWidgetDragEndRequest {
  // Window-local coordinates (same space as ScreenWatchWidget.rect) of the
  // widget's final top-left corner after the drag.
  x: number
  y: number
}
export interface ScreenWatchWidgetDragEndResponse {
  ok: true
}

// The renderer computes the popover's exact on-screen rect (position +
// size) when it opens for a given claim; reporting it back lets
// hoverTracking.ts hit-test against the popover's REAL bounds instead of a
// guessed fixed padding, so moving the mouse onto its buttons never breaks
// the hover and moving away from it (not just away from the underline)
// reliably closes it. Pass rect: null (claimId still set) when the popover
// is hidden/dismissed.
export interface ScreenWatchSetActivePopoverRectRequest {
  claimId: string | null
  // Window-local coordinates (same space as ScreenWatchOverlayUpdateEvent
  // rects).
  rect: ScreenRect | null
}
export interface ScreenWatchSetActivePopoverRectResponse {
  ok: true
}
