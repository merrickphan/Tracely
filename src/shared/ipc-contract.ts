import type {
  AccentColor,
  Analysis,
  AppSettings,
  AuthUser,
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
  SourceProvider,
  Theme,
  TracerConversation,
  TracerMessage
} from './types'

// Note: CitationStyle is already 'APA' | 'MLA' | 'Chicago' — reused as-is for
// the Screen Watch citation flow below, same enum the main app's citation
// generation already uses.

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
  bio: string
  // file:// URL to the locally-stored avatar image, or null if none set.
  avatarUrl: string | null
}
export type ProfileGetResponse = ProfileInfo

export interface ProfileSetRequest {
  firstName?: string
  lastName?: string
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
// Evidence search now runs in the background per flagged claim (fire-and-
// forget, kicked off right after detection) — this is its result once it
// resolves. `articles` is trimmed to the top few by rank (not the full
// result set — see leanEvidence in screenWatchService.ts) since it travels
// in the overlay payload that gets re-sent on every change; the full list is
// only ever fetched from the main Tracely window via the existing
// EVIDENCE_FIND flow, not through Screen Watch.
export interface ScreenWatchEvidenceArticle {
  title: string
  venue: string | null
  year: number | null
  provider: SourceProvider
  url: string | null
  // Real favicon for the source's own site, fetched server-side (see
  // main/services/search/favicon.ts) as a data: URI so it satisfies the
  // overlay's img-src 'self' data: CSP with no loosening. Null while
  // unavailable/unfetchable — the renderer falls back to the provider
  // monogram badge in that case.
  faviconDataUrl: string | null
}
export interface ScreenWatchClaimEvidence {
  score: number
  count: number
  articles: ScreenWatchEvidenceArticle[]
}

// Set once the user has actually inserted a citation into the watched
// document for this claim (see insertCitationForClaim in
// screenWatchService.ts) — the renderer treats a cited claim as resolved
// (dropped from the flagged/underline set) rather than re-showing the
// "missing citation" popup for something already fixed.
export interface ScreenWatchClaimCitation {
  inTextCitation: string
  worksCitedEntry: string
}

export interface ScreenWatchClaimSummary {
  id: string
  text: string
  claimType: ClaimType
  confidence: number
  // null while the background search hasn't resolved yet (or failed) for
  // this claim — the renderer shows a loading state, not a zero score.
  evidence: ScreenWatchClaimEvidence | null
  // Both null until the user explicitly clicks "Critique Argument" — unlike
  // evidence search, critique hits the paid relay, so it never runs
  // automatically for passive background reading (see critiqueClaim in
  // screenWatchService.ts).
  critique: string | null
  critiqueVerdict: CritiqueVerdict | null
  citation: ScreenWatchClaimCitation | null
}

// "Find a source" — a focused, single-claim search distinct from
// refreshEvidence's broader multi-source list: ranked candidates with a
// per-item match % so the user can pick one specific source to cite,
// rather than browsing everything found. sourceRef is an opaque id (same
// derivation as synthesizeEvidenceItem's Source.id in screenWatchService.ts)
// the follow-up insertCitation call uses to find the same item server-side —
// results aren't persisted anywhere, same ephemeral rule as the rest of
// Screen Watch's evidence.
export interface ScreenWatchFindSourceRequest {
  claimId: string
  // When set, re-runs the search with this text instead of the claim's own
  // searchQuery — backs the citation picker's "search again" box.
  query?: string
}
export interface ScreenWatchSourceCandidate {
  sourceRef: string
  title: string
  venue: string | null
  year: number | null
  provider: SourceProvider
  url: string | null
  matchPercent: number
  faviconDataUrl: string | null
}
export interface ScreenWatchFindSourceResponse {
  candidates: ScreenWatchSourceCandidate[]
}

export interface ScreenWatchInsertCitationRequest {
  claimId: string
  sourceRef: string
  style: CitationStyle
}
export interface ScreenWatchInsertCitationResponse {
  citation: ScreenWatchClaimCitation
}

export interface ScreenWatchUndoCitationRequest {
  claimId: string
}
export interface ScreenWatchUndoCitationResponse {
  ok: true
}

export interface ScreenWatchRefreshEvidenceRequest {
  claimId: string
}
export interface ScreenWatchRefreshEvidenceResponse {
  evidence: ScreenWatchClaimEvidence | null
}

export interface ScreenWatchCritiqueClaimRequest {
  claimId: string
}
export interface ScreenWatchCritiqueClaimResponse {
  critique: string
  verdict: CritiqueVerdict
}

export interface ScreenWatchWidget {
  rect: ScreenRect
  // Whether `rect` is the collapsed launcher circle or the expanded stats
  // panel — toggled via SCREENWATCH_SET_WIDGET_EXPANDED, recomputed here
  // (not client-side) so hoverTracking.ts's click-through hit-testing and
  // the renderer's draw position always agree on where the widget actually
  // is.
  expanded: boolean
  // Only meaningful while expanded — 'single' shows the top claim, 'all'
  // shows every currently-flagged claim in a grid. Determines `rect`'s
  // actual size (see computeAllPanelSize in screenWatchService.ts) since
  // "no scrolling" means the panel itself has to grow/shrink to fit.
  viewMode: 'single' | 'all'
  claimCount: number
  // Ordered by confidence, highest first — the popup/panel picks which one
  // to show (hovered claim, or the top one by default) from this list
  // rather than needing a separate round-trip per claim.
  claims: ScreenWatchClaimSummary[]
  // claims.length + the evidence item count of every claim whose search has
  // resolved so far — the single "how much has been found" number the
  // widget badge and panel header show.
  totalInfoCount: number
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

export interface ScreenWatchSetWidgetExpandedRequest {
  expanded: boolean
}
export interface ScreenWatchSetWidgetExpandedResponse {
  ok: true
}

export interface ScreenWatchSetWidgetViewModeRequest {
  mode: 'single' | 'all'
}
export interface ScreenWatchSetWidgetViewModeResponse {
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

// --- Tracer -----------------------------------------------------------
// The teaching assistant opened from the Screen Watch widget. It runs in
// its own focusable BrowserWindow (windows/tracerWindow.ts) rather than
// inside the overlay, because the overlay is deliberately unfocusable and
// so cannot host a text input — see the note in overlayWindow.ts.

// What Tracer can currently "see": the text of the document being watched
// and the claims flagged in it. Pushed to the Tracer window on open and
// whenever it changes, so the UI can show the user exactly what context
// their question will be answered against instead of leaving it implicit.
export interface TracerContext {
  // Null when Screen Watch is off or no allowed app is focused — Tracer
  // still answers, just without document context.
  processName: string | null
  documentText: string
  claims: { id: string; text: string; claimType: ClaimType; evidenceScore: number | null }[]
}

export interface TracerOpenRequest {
  // Set when opened from a specific claim ("Ask Tracer about this") so the
  // conversation starts anchored to it rather than the whole document.
  claimId?: string
}
export interface TracerOpenResponse {
  ok: true
}

export type TracerCloseRequest = Record<string, never>
export interface TracerCloseResponse {
  ok: true
}

export interface TracerSendRequest {
  conversationId: string
  message: string
}
export interface TracerSendResponse {
  // Both the stored user message and Tracer's stored reply — the renderer
  // appends these rather than optimistically inventing ids that wouldn't
  // match what's in the database.
  userMessage: TracerMessage
  reply: TracerMessage
}

export interface TracerGetConversationRequest {
  // Omit to get (or lazily create) the most recent conversation.
  conversationId?: string
}
export interface TracerGetConversationResponse {
  conversation: TracerConversation
  messages: TracerMessage[]
  context: TracerContext
  // False when this build has no relay configured — the renderer disables
  // the composer and explains why instead of failing on send.
  relayConfigured: boolean
  // Set when the window was opened via "Ask Tracer about this claim" — the
  // renderer prefills a starter question about it.
  focusedClaimId: string | null
}

export type TracerListConversationsRequest = Record<string, never>
export interface TracerListConversationsResponse {
  conversations: TracerConversation[]
}

export type TracerNewConversationRequest = Record<string, never>
export interface TracerNewConversationResponse {
  conversation: TracerConversation
}

export interface TracerDeleteConversationRequest {
  id: string
}
export interface TracerDeleteConversationResponse {
  ok: true
}

export type AuthGetUserRequest = Record<string, never>
export interface AuthGetUserResponse {
  user: AuthUser | null
  // False if this build has no Supabase project configured (no
  // SUPABASE_URL/SUPABASE_ANON_KEY at build time) — the renderer should
  // hide/disable the login UI rather than show sign-in attempts that will
  // always fail.
  configured: boolean
}

export interface AuthSignUpRequest {
  email: string
  password: string
  firstName: string
}
export interface AuthSignInRequest {
  email: string
  password: string
}
export interface AuthSignResponse {
  user: AuthUser | null
}

export type AuthSignOutRequest = Record<string, never>
export interface AuthSignOutResponse {
  ok: true
}

export type AuthSignInWithGoogleRequest = Record<string, never>
export interface AuthSignInWithGoogleResponse {
  // The system browser is opened with this URL; the actual signed-in user
  // arrives later via the AUTH_STATE_CHANGED event once the OAuth redirect
  // completes, not as this call's return value.
  ok: true
}

export interface AuthUpdateNameRequest {
  firstName: string
}
export type AuthUpdateNameResponse = AuthSignResponse

export interface AuthUpdateUsernameRequest {
  username: string
}
export type AuthUpdateUsernameResponse = AuthSignResponse

export type AuthDeleteAccountRequest = Record<string, never>
export interface AuthDeleteAccountResponse {
  ok: true
}
