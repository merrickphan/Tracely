import { randomUUID } from 'crypto'
import { BrowserWindow, screen } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type {
  ScreenWatchClaimCitation,
  ScreenWatchClaimEvidence,
  ScreenWatchClaimSummary,
  ScreenWatchSourceCandidate,
  ScreenWatchStatus,
  TracerContext
} from '@shared/ipc-contract'
import type { CitationStyle, Claim, CritiqueVerdict, EvidenceItem, Source } from '@shared/types'
import { computeClaimSpans } from '@shared/claimSpans'
import { detectClaims } from '../ai/claimDetection'
import { generateCritique } from '../ai/critique'
import { formatCitation } from '../citations'
import { formatInTextCitation } from '../citations/inText'
import { findEvidenceCached } from '../search/cachedEvidence'
import { getFaviconDataUrl } from '../search/favicon'
import { computeTextRelevance } from '../search/scoring'
import type { NormalizedSourceResult } from '../search/types'
import { getSetting, setSetting } from '../storage/settingsRepo'
import { getOverlayWindow, hideOverlay, showOverlayOnWindow } from '../../windows/overlayWindow'
import { getMainWindow } from '../../windows/mainWindow'
import { getTracerWindow, isTracerWindowOpen } from '../../windows/tracerWindow'
import { logScreenWatch, resetScreenWatchLog } from './debugLog'
import { setDragActive, startHoverTracking, stopHoverTracking } from './hoverTracking'
import {
  insertCitationText,
  takeUiaSnapshot,
  undoLastInsert,
  type ClaimSpanRequest,
  type ScreenRect
} from './uiaSnapshot'

const POLL_INTERVAL_MS = 1200
// How long the text has to stop changing before it's analyzed. This was
// 1200ms, which is not "the user finished a thought" — it's the pause
// between words. Someone drafting an essay clears a 1.2s bar dozens of
// times per paragraph, and because the cache is keyed on the whole
// document, every one of those was a guaranteed miss (the text differs by
// whatever was just typed) and so a full relay call re-analyzing the entire
// document. 4s is still responsive for someone who has genuinely stopped
// to think, and removes most of that.
const STABLE_MS = 4000
// Floor on time between two analyses regardless of stability. STABLE_MS
// alone doesn't bound anything: alternating type-pause-type-pause can clear
// it indefinitely. This is the actual ceiling on Screen Watch's spend —
// at most one detection per 20s per user while actively writing.
const MIN_ANALYSIS_INTERVAL_MS = 20_000
// Re-analyzing after a handful of characters changed re-reads the whole
// document to discover the same claims plus a partial sentence. Requiring a
// sentence-sized delta means a detection is triggered by new content, not
// by a typo fix. (Deletions count: Math.abs.)
const MIN_TEXT_DELTA_CHARS = 80
// How many of a detection's claims get their evidence fetched automatically
// (see triggerEvidenceSearch). The rest search when the user opens them.
const MAX_AUTO_EVIDENCE_CLAIMS = 3
const MIN_TEXT_LENGTH = 20
// User-configurable now (Settings > General > sensitivity) rather than a
// value we keep re-tuning in code — Screen Watch underlines passively,
// without the user asking about any one sentence, so a borderline call
// here is far more annoying (flagging ordinary descriptive sentences) than
// it would be in Analyze, where the user asked for a full pass and can
// just ignore a weak one. Default (0.55) sits below the relay prompt's own
// confidence calibration for unambiguous claims (0.8+) since the two
// compound — a high threshold on top of deliberately deflated scores for
// borderline claims suppressed real claims entirely in testing.
function getMinClaimConfidence(): number {
  const raw = Number(getSetting('claimSensitivity'))
  return Number.isFinite(raw) ? raw : 0.55
}

let enabled = false
let timer: ReturnType<typeof setTimeout> | null = null
let ticking = false
let detecting = false

let pendingText = ''
let pendingSince = 0
let lastAnalyzedText = ''
let lastAnalysisAt = 0

// Cheap stand-in for an edit distance: the length change, plus whether one
// text is still a prefix of the other. Rewriting a sentence in place keeps
// the length nearly identical, so length alone would miss it — but such an
// edit also breaks the common prefix, which this catches. Good enough to
// separate "typed a new sentence" from "fixed a typo", which is all the
// gate below needs to decide.
function hasMeaningfulDelta(next: string, previous: string): boolean {
  if (!previous) return true
  if (Math.abs(next.length - previous.length) >= MIN_TEXT_DELTA_CHARS) return true
  const shared = next.length < previous.length ? next.length : previous.length
  let i = 0
  while (i < shared && next[i] === previous[i]) i++
  // Everything after the first difference is rewritten text on both sides.
  return previous.length - i + (next.length - i) >= MIN_TEXT_DELTA_CHARS
}
let currentClaims: Claim[] = []
// Background evidence search result per currently-flagged claim — kicked
// off right after detection (see triggerEvidenceSearch) rather than waiting
// for the user to ask, so the widget/popup can show a real "X sources
// found" number instead of only the claim-detection confidence. Full
// results are kept here (not just the lean score/count sent to the
// renderer, see leanEvidence) so critiqueClaim below has real titles/
// abstracts to work with without a second search round-trip. Kept separate
// from `currentClaims` (rather than mutating strengthScore on the Claim
// objects directly) since results arrive asynchronously, one claim at a
// time, well after currentClaims was already set.
let evidenceResultByClaimId = new Map<string, { evidence: NormalizedSourceResult[]; score: number }>()
// Critique is never run automatically here (unlike evidence search) — it's
// the paid relay, so it only runs when the user explicitly clicks "Critique
// Argument" in the overlay (see critiqueClaim).
let critiqueByClaimId = new Map<string, { critique: string; verdict: CritiqueVerdict }>()
// Results of the focused "Find a source" search (findSourceForClaim) — kept
// separate from evidenceResultByClaimId (the broader background auto-search)
// since it's a distinct, user-triggered search that can use a different
// query than the claim's own searchQuery (the picker's "search again" box).
let findSourceResultByClaimId = new Map<string, NormalizedSourceResult[]>()
// Set once insertCitationForClaim has actually typed a citation into the
// watched document for a claim — insertOffset is kept only so a future
// insert on the same claim (unlikely, since cited claims are hidden from
// the flagged set) wouldn't need to re-derive it; nothing reads it back out
// today beyond the map value itself.
let citationByClaimId = new Map<string, { inTextCitation: string; worksCitedEntry: string; insertOffset: number }>()
let currentSpans: ClaimSpanRequest[] = []
let retryAfter = 0
let lastError: string | null = null
const RETRY_COOLDOWN_MS = 5000
let lastSkipReason: string | null = null

export interface HoverTarget {
  claimId: string
  kind: 'claim' | 'widget'
  text: string
  claimType: Claim['claimType']
  // Absolute logical (DIP) screen coordinates — same space as
  // screen.getCursorScreenPoint() — for hit-testing in hoverTracking.ts.
  rectsAbsolute: ScreenRect[]
  // Window-local coordinates — same space sent in
  // SCREENWATCH_OVERLAY_UPDATE — for positioning the tooltip in the overlay
  // renderer without any unit conversion there.
  rectsWindowLocal: ScreenRect[]
}

let hoverTargets: HoverTarget[] = []

export function getHoverTargets(): HoverTarget[] {
  return hoverTargets
}

let widgetExpanded = false
// Cached so toggling expanded/collapsed can redraw immediately instead of
// waiting up to POLL_INTERVAL_MS for the next scheduled snapshot.
let lastUpdateInputs: {
  windowRect: ScreenRect
  claimRects: { id: string; rects: ScreenRect[] }[]
  claims: Claim[]
  fullText: string
} | null = null

// Window-local top-left corner the user last dragged the widget/panel to —
// overrides the fixed corner anchor while set. Cleared whenever the widget
// collapses or a new control/app comes into focus, so the next expand
// starts fresh at the anchor rather than wherever it happened to be left.
let widgetManualPos: { x: number; y: number } | null = null

// 'single' shows just one claim at a time (the highest-confidence one);
// 'all' shows every currently-flagged claim in a grid sized to fit with no
// scrolling — the panel's actual pixel size (see updateOverlayAndWidget)
// depends on this, so it has to be known server-side rather than left as a
// renderer-only toggle the way the hover popover's own single/all switch is.
export type WidgetViewMode = 'single' | 'all'
let widgetViewMode: WidgetViewMode = 'single'

export function setWidgetExpanded(expanded: boolean): void {
  widgetExpanded = expanded
  if (!expanded) {
    widgetManualPos = null
    widgetViewMode = 'single'
  }
  redrawOverlay()
}

export function setWidgetViewMode(mode: WidgetViewMode): void {
  widgetViewMode = mode
  redrawOverlay()
}

export function setWidgetDragStart(): void {
  setDragActive(true)
}

export function setWidgetDragEnd(local: { x: number; y: number }): void {
  widgetManualPos = local
  setDragActive(false)
  redrawOverlay()
}

// The overlay's own logical top-left (the focused app window's origin, not
// the display's) the last time it was drawn — needed to convert the
// renderer-reported popover rect (window-local) into absolute screen
// coordinates for hoverTracking.ts, the same way widget drag positions are
// converted.
let lastOverlayOrigin: { x: number; y: number } | null = null
let activePopoverClaimId: string | null = null
let activePopoverRectAbsolute: ScreenRect | null = null

export function setActivePopoverRect(claimId: string | null, rectLocal: ScreenRect | null): void {
  activePopoverClaimId = claimId
  activePopoverRectAbsolute =
    rectLocal && lastOverlayOrigin
      ? {
          x: rectLocal.x + lastOverlayOrigin.x,
          y: rectLocal.y + lastOverlayOrigin.y,
          width: rectLocal.width,
          height: rectLocal.height
        }
      : null
}

export function getActivePopoverRect(): { claimId: string | null; rectAbsolute: ScreenRect | null } {
  return { claimId: activePopoverClaimId, rectAbsolute: activePopoverRectAbsolute }
}

function synthesizeClaim(detected: {
  text: string
  claimType: Claim['claimType']
  confidence: number
  searchQuery: string
}): Claim {
  return {
    id: randomUUID(),
    analysisId: '',
    text: detected.text,
    claimType: detected.claimType,
    confidence: detected.confidence,
    searchQuery: detected.searchQuery,
    strengthScore: null,
    scoreBreakdown: null,
    critique: null,
    critiqueVerdict: null,
    createdAt: new Date().toISOString()
  }
}

let lastStatus: ScreenWatchStatus = {
  enabled: false,
  active: false,
  processName: null,
  supportsUnderlines: false,
  claimCount: 0,
  lastError: null,
  blockedApp: null
}

function getAllowedApps(): string[] {
  return getSetting('screenWatchAllowedApps')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Opt-in allowlist — Screen Watch reads nothing anywhere until the user
// explicitly picks which apps it's allowed to work in (Settings >
// Preferences), rather than working everywhere by default with an opt-out
// blocklist. Nothing is enabled out of the box.
function isProcessAllowed(processName: string): boolean {
  const allowed = getAllowedApps()
  return allowed.some((name) => name.toLowerCase() === processName.toLowerCase())
}

function emitStatus(status: ScreenWatchStatus): void {
  lastStatus = status
  const win = getMainWindow()
  win?.webContents.send(IPC_EVENTS.SCREENWATCH_STATUS_CHANGED, status)
}

export function getScreenWatchStatus(): ScreenWatchStatus {
  return lastStatus
}

function resetTrackingState(): void {
  pendingText = ''
  pendingSince = 0
  lastAnalyzedText = ''
  currentClaims = []
  evidenceResultByClaimId = new Map()
  critiqueByClaimId = new Map()
  findSourceResultByClaimId = new Map()
  citationByClaimId = new Map()
  faviconByUrl = new Map()
  faviconFetchInFlight = new Set()
  currentSpans = []
  hoverTargets = []
  widgetExpanded = false
  widgetViewMode = 'single'
  widgetManualPos = null
  lastUpdateInputs = null
  activePopoverClaimId = null
  activePopoverRectAbsolute = null
  lastSentPayloadKey = null
}

async function tick(): Promise<void> {
  if (!enabled || ticking) return
  ticking = true
  try {
    const snapshot = await takeUiaSnapshot(currentSpans)

    if (!snapshot.ok) {
      lastError = snapshot.error
      logScreenWatch(`snapshot failed: ${snapshot.error}`)
      emitStatus({
        enabled,
        active: false,
        processName: null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError,
        blockedApp: null
      })
      return
    }

    if (snapshot.skip) {
      // Talking to Tracer means Tracely itself is the foreground app, which
      // UIA reports as `skip: "self"`. Treating that like any other skip
      // would wipe the very claims the user opened Tracer to ask about and
      // hide the underlines out from under them mid-question. So while the
      // Tracer window is up, a "self" skip freezes Screen Watch instead:
      // keep the claims, keep the overlay drawn where it was, and pick the
      // document back up on the next tick after Tracer is closed. Every
      // other skip reason (and "self" with Tracer closed) still resets.
      if (snapshot.reason === 'self' && isTracerWindowOpen()) {
        return
      }

      // Logged only on change, not every tick — "not-editable-control-type"
      // in particular would otherwise spam the log constantly while just
      // browsing a normal webpage.
      if (snapshot.reason !== lastSkipReason) {
        lastSkipReason = snapshot.reason
        logScreenWatch(
          `skipping (${snapshot.reason}) on ${'processName' in snapshot ? (snapshot.processName ?? 'unknown') : 'unknown'}`
        )
      }
      hideOverlay()
      resetTrackingState()
      emitStatus({
        enabled,
        active: false,
        processName: 'processName' in snapshot ? (snapshot.processName ?? null) : null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError,
        blockedApp: null
      })
      return
    }
    lastSkipReason = null

    if (!isProcessAllowed(snapshot.processName)) {
      // Not an error — the user just hasn't allowed this app. Bail out
      // before any text ever reaches detectClaims: this is the actual
      // token-usage and privacy boundary, not just a UI filter.
      hideOverlay()
      resetTrackingState()
      logScreenWatch(`focused app ${snapshot.processName} is not on the allowed list, skipping`)
      emitStatus({
        enabled,
        active: false,
        processName: null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError,
        blockedApp: snapshot.processName
      })
      return
    }

    if (snapshot.text !== pendingText) {
      pendingText = snapshot.text
      pendingSince = Date.now()
      logScreenWatch(
        `text changed on ${snapshot.processName} (len ${pendingText.length}, supportsTextPattern=${snapshot.supportsTextPattern})`
      )
    } else if (
      pendingText.trim().length >= MIN_TEXT_LENGTH &&
      pendingText !== lastAnalyzedText &&
      hasMeaningfulDelta(pendingText, lastAnalyzedText) &&
      Date.now() - pendingSince >= STABLE_MS &&
      Date.now() - lastAnalysisAt >= MIN_ANALYSIS_INTERVAL_MS &&
      Date.now() >= retryAfter &&
      !detecting
    ) {
      detecting = true
      lastAnalysisAt = Date.now()
      const textAtRequestTime = pendingText
      logScreenWatch(`text stable, triggering detectClaims (len ${textAtRequestTime.length})`)
      detectClaims(textAtRequestTime)
        .then((detected) => {
          // Only mark this text "done" on success — a failure must stay
          // retryable rather than being silently marked as already-tried.
          lastAnalyzedText = textAtRequestTime
          const confident = detected.filter((c) => c.confidence >= getMinClaimConfidence())
          currentClaims = confident.map(synthesizeClaim)
          lastError = null
          logScreenWatch(
            `detected ${detected.length} claim(s), ${confident.length} above confidence threshold: ` +
              `${currentClaims.map((c) => JSON.stringify(c.text)).join(', ')}`
          )
          // Compute spans against the text we just analyzed *now*, rather
          // than leaving currentSpans at whatever they were before this
          // detection (usually empty). Without this, the immediate redraw
          // below asks the OS for bounding rects using stale/empty offsets,
          // draws nothing, and only catches up a full poll cycle later.
          const freshSpans = computeClaimSpans(textAtRequestTime, currentClaims)
          currentSpans = freshSpans.map((s) => ({ id: s.claim.id, start: s.start, length: s.end - s.start }))
          // Fresh claim set → any evidence/critique/citation from the
          // previous one no longer applies to anything currently shown.
          evidenceResultByClaimId = new Map()
          critiqueByClaimId = new Map()
          findSourceResultByClaimId = new Map()
          citationByClaimId = new Map()
          triggerEvidenceSearch(currentClaims)
          // Don't wait for the next scheduled poll tick to show results —
          // that adds up to POLL_INTERVAL_MS of dead time on top of the
          // relay round-trip for no reason.
          void tick()
        })
        .catch((err) => {
          retryAfter = Date.now() + RETRY_COOLDOWN_MS
          lastError = err instanceof Error ? err.message : String(err)
          logScreenWatch(`detectClaims failed: ${lastError}`)
        })
        .finally(() => {
          detecting = false
        })
    }

    // Locate claims within THIS tick's text ourselves — via the same fuzzy
    // matching the Live tab uses — rather than asking UIA's FindText to
    // search for the AI's claim text, which is frequently not an exact
    // substring (see the note atop resources/uia-watch.ps1). The resulting
    // offsets are sent up on the *next* tick's snapshot request.
    const claimSpans = computeClaimSpans(snapshot.text, currentClaims)
    currentSpans = claimSpans.map((s) => ({ id: s.claim.id, start: s.start, length: s.end - s.start }))

    if (currentClaims.length > 0) {
      logScreenWatch(
        `provider layout check: wholeDocRects=${snapshot.wholeDocRectCount ?? '?'} ` +
          `visibleRanges=${snapshot.visibleRangeCount ?? '?'} visibleRangeRects=${snapshot.visibleRangeRectCount ?? '?'}`
      )
      logScreenWatch(
        `located ${claimSpans.length}/${currentClaims.length} claim(s) in text this tick; ` +
          `claimRects from snapshot: ${snapshot.claimRects
            .map(
              (r) =>
                `${r.id.slice(0, 8)}=${r.rects.length}/${r.rawRectCount ?? '?'}rect(s) ` +
                `rangeText=${JSON.stringify(r.rangeTextPreview ?? null)} ` +
                `moveError=${r.moveError ?? 'none'} scrollError=${r.scrollError ?? 'none'} rectError=${r.rectError ?? 'none'}`
            )
            .join(' | ')}`
      )
    }

    updateOverlayAndWidget(snapshot.windowRect, snapshot.claimRects, currentClaims, snapshot.text)

    emitStatus({
      enabled,
      active: true,
      processName: snapshot.processName,
      supportsUnderlines: snapshot.supportsTextPattern,
      claimCount: currentClaims.length,
      lastError,
      blockedApp: null
    })
  } finally {
    ticking = false
    if (enabled) timer = setTimeout(tick, POLL_INTERVAL_MS)
  }
}

// Matches the Figma "Collapsed Launcher" mockup's 56px circle.
const WIDGET_SIZE = 56
// Fixed distance from the focused window's bottom-right corner — matches
// where the Figma mockups place it, and (deliberately) has nothing to do
// with where the focused control or text cursor currently is.
const EDGE_MARGIN = 24
// Single-claim panel — big enough for the full action card (claim text,
// evidence row, Find Evidence/Critique Argument buttons, and the critique
// result once run), no scrolling. Must match OverlayApp.tsx's
// POPOVER_WIDTH/EST_HEIGHT-equivalent sizing intent for the same content.
const SINGLE_PANEL_WIDTH = 400
const SINGLE_PANEL_HEIGHT = 400
// "Show all" — a single vertical column (not a grid) so each row has room
// to show real article titles, not just a count. Sized per-claim-count
// below (computeAllPanelSize) so a normal number of claims fits with no
// scrolling; height is capped (MAX_LIST_PANEL_HEIGHT) for the rare case of
// many claims at once, since letting the panel grow past the screen would
// just reintroduce clipping — the renderer scrolls internally only past
// that cap. Mirrored client-side in OverlayApp.tsx (GRID_*) — keep in sync.
const GRID_CARD_WIDTH = 364
const GRID_CARD_HEIGHT = 176
const GRID_GAP = 10
const GRID_HEADER_HEIGHT = 44
const GRID_PADDING = 18
const MAX_LIST_PANEL_HEIGHT = 560

function computeAllPanelSize(claimCount: number): { width: number; height: number } {
  const count = Math.max(1, claimCount)
  const naturalHeight = GRID_PADDING * 2 + GRID_HEADER_HEIGHT + count * GRID_CARD_HEIGHT + (count - 1) * GRID_GAP
  return {
    width: GRID_PADDING * 2 + GRID_CARD_WIDTH,
    height: Math.min(naturalHeight, MAX_LIST_PANEL_HEIGHT)
  }
}

let lastSentPayloadKey: string | null = null

function redrawOverlay(): void {
  if (!lastUpdateInputs) return
  updateOverlayAndWidget(
    lastUpdateInputs.windowRect,
    lastUpdateInputs.claimRects,
    lastUpdateInputs.claims,
    lastUpdateInputs.fullText
  )
}

// Top 3 by rank, not the full result set — enough for the overlay to show
// real article titles instead of just a count, without ballooning the
// payload that gets re-sent on every overlay-update.
const MAX_ARTICLES_IN_OVERLAY = 3

// Favicon lookups are async (a real network call, see search/favicon.ts)
// but leanEvidence itself has to stay synchronous — it's read on every
// redrawOverlay(), which nothing downstream awaits. So this is a
// fire-and-forget-then-redraw cache: the first time a URL is seen its
// favicon returns null immediately (fetch kicked off in the background),
// and once that resolves a fresh redraw picks up the real image. Reset
// per-session like every other per-run map (favicons are cheap enough to
// just refetch next run rather than persist across restarts).
let faviconByUrl = new Map<string, string | null>()
let faviconFetchInFlight = new Set<string>()

function ensureFaviconsFor(urls: (string | null)[]): void {
  for (const url of urls) {
    if (!url || faviconByUrl.has(url) || faviconFetchInFlight.has(url)) continue
    faviconFetchInFlight.add(url)
    getFaviconDataUrl(url)
      .then((dataUrl) => {
        faviconByUrl.set(url, dataUrl)
        redrawOverlay()
      })
      .finally(() => {
        faviconFetchInFlight.delete(url)
      })
  }
}

function leanEvidence(claimId: string): ScreenWatchClaimEvidence | null {
  const result = evidenceResultByClaimId.get(claimId)
  if (!result) return null
  ensureFaviconsFor(result.evidence.slice(0, MAX_ARTICLES_IN_OVERLAY).map((item) => item.url))
  return {
    score: result.score,
    count: result.evidence.length,
    articles: result.evidence.slice(0, MAX_ARTICLES_IN_OVERLAY).map((item) => ({
      title: item.title,
      venue: item.venue,
      year: item.year,
      faviconDataUrl: item.url ? (faviconByUrl.get(item.url) ?? null) : null,
      provider: item.provider,
      url: item.url
    }))
  }
}

// Stable id for a search result within one claim's result set — same
// derivation synthesizeEvidenceItem always used, now also doubling as the
// "sourceRef" the citation flow's IPC responses hand back to the renderer
// and expect returned on insertCitationForClaim, since these results are
// never persisted through sourcesRepo (no real database id exists to use).
function sourceRefFor(item: NormalizedSourceResult, rank: number): string {
  return item.doi ?? item.providerId ?? `${item.provider}:${rank}`
}

// generateCritique and formatCitation/formatInTextCitation only ever read
// plain fields off a Source (title/abstract/authors/year/venue) — building
// one here (rather than persisting these ephemeral, never-saved search
// results through sourcesRepo just to get a real id) is safe precisely
// because nothing downstream needs a real database-backed id for a claim's
// evidence to be critiqued or cited correctly.
function synthesizeSourceFromResult(item: NormalizedSourceResult, rank: number): Source {
  return {
    id: sourceRefFor(item, rank),
    doi: item.doi,
    title: item.title,
    authors: item.authors,
    year: item.year,
    venue: item.venue,
    venueType: item.venueType,
    url: item.url,
    pdfUrl: item.pdfUrl,
    abstract: item.abstract,
    provider: item.provider,
    providerId: item.providerId,
    citationCount: item.citationCount,
    oaStatus: item.oaStatus,
    createdAt: new Date().toISOString()
  }
}

function synthesizeEvidenceItem(item: NormalizedSourceResult, rank: number): EvidenceItem {
  const source = synthesizeSourceFromResult(item, rank)
  return { source, relevanceScore: 1 - rank / Math.max(1, item.relevanceRank + 1), rank }
}

// Looks a citation-flow sourceRef back up across both places a result could
// have come from: the focused "Find a source" search, or the background
// auto-search's broader result set (when the user clicked "Add citation"
// straight from evidence that was already on hand).
function resolveSourceRef(claimId: string, sourceRef: string): NormalizedSourceResult | null {
  const pools = [findSourceResultByClaimId.get(claimId) ?? [], evidenceResultByClaimId.get(claimId)?.evidence ?? []]
  for (const pool of pools) {
    const idx = pool.findIndex((item, i) => sourceRefFor(item, i) === sourceRef)
    if (idx !== -1) return pool[idx]
  }
  return null
}

// Fired once per fresh claim set, right after detection — free public APIs
// (OpenAlex/Crossref/Semantic Scholar/PubMed, already rate-limited per
// provider in rateLimiter.ts), not the paid relay, so running this
// automatically for passive background reading doesn't add API cost the way
// auto-running claim detection/critique would. Each claim's result lands in
// evidenceResultByClaimId independently and triggers its own redraw as soon
// as it's ready, rather than waiting for every claim's search to finish.
function triggerEvidenceSearch(claims: Claim[]): void {
  // Every claim here costs four provider searches, so a full set of 8 fired
  // 32 HTTP requests per detection, unprompted, for claims the user may
  // never look at. That is the main reason Semantic Scholar answers 429 —
  // its unauthenticated tier is a shared global pool. Claims arrive sorted
  // by confidence, so the top few are the ones most likely to be opened;
  // the rest search on demand via refreshEvidenceForClaim when the user
  // actually hovers one.
  for (const claim of claims.slice(0, MAX_AUTO_EVIDENCE_CLAIMS)) {
    findEvidenceCached(claim.searchQuery, claim.text)
      .then((result) => {
        // The claim set may have moved on (text changed again, focus moved
        // to a different app) by the time this resolves — a result for a
        // claim that's no longer current would only show stale data.
        if (!currentClaims.some((c) => c.id === claim.id)) return
        evidenceResultByClaimId.set(claim.id, { evidence: result.evidence, score: result.score })
        redrawOverlay()
      })
      .catch((err) => {
        logScreenWatch(`background evidence search failed for claim ${claim.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
      })
  }
}

// User-initiated re-run of evidence search for one claim (the overlay's
// "Find Evidence"/"Refresh Evidence" button) — same search as
// triggerEvidenceSearch, just for a single claim on demand instead of the
// whole set automatically.
export async function refreshEvidenceForClaim(claimId: string): Promise<ScreenWatchClaimEvidence | null> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) return null
  const result = await findEvidenceCached(claim.searchQuery, claim.text)
  if (!currentClaims.some((c) => c.id === claimId)) return null
  evidenceResultByClaimId.set(claimId, { evidence: result.evidence, score: result.score })
  redrawOverlay()
  return leanEvidence(claimId)
}

// User-initiated only (the overlay's "Critique Argument" button) — unlike
// evidence search this hits the paid relay, so it never runs automatically
// for passive background reading.
export async function critiqueClaim(claimId: string): Promise<{ critique: string; verdict: CritiqueVerdict }> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) throw new Error('This claim is no longer being tracked (the watched text likely changed).')
  const evidence = evidenceResultByClaimId.get(claimId)
  const evidenceItems = evidence ? evidence.evidence.map((item, i) => synthesizeEvidenceItem(item, i)) : []
  const claimWithScore: Claim = { ...claim, strengthScore: evidence?.score ?? null }
  const result = await generateCritique(claimWithScore, evidenceItems)
  if (currentClaims.some((c) => c.id === claimId)) {
    critiqueByClaimId.set(claimId, result)
    redrawOverlay()
  }
  return result
}

// Ranked candidates for one claim, capped so the picker stays scannable —
// this is deliberately smaller/more curated than Refresh Evidence's list.
const MAX_FIND_SOURCE_CANDIDATES = 5
// Mirrors PER_PROVIDER_LIMIT in search/scoring.ts — that constant isn't
// exported (it's an internal tuning knob for the whole-claim strength
// score), so it's duplicated here for the same per-item rank-relevance
// blend, applied to a single claim's candidate list rather than the whole
// evidence set.
const RANK_RELEVANCE_LIMIT = 6

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// The focused, single-claim search behind the overlay's "Find a source"
// action — same cached evidence lookup Refresh Evidence already uses, but with a
// per-item match % (the same text-relevance/rank blend computeStrengthScore
// uses internally for the whole claim, just surfaced per candidate here)
// so the user can pick one specific source to cite instead of browsing a
// plain list. `query` overrides the claim's own searchQuery for the
// picker's "search again" box.
export async function findSourceForClaim(claimId: string, query?: string): Promise<ScreenWatchSourceCandidate[]> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) return []
  const result = await findEvidenceCached(query ?? claim.searchQuery, claim.text)
  if (!currentClaims.some((c) => c.id === claimId)) return []
  findSourceResultByClaimId.set(claimId, result.evidence)

  const ranked = result.evidence
    .map((item, i) => {
      // The aggregator's own figure, not a re-derivation. It recomputed word
      // overlap here, which now disagrees with how the results were actually
      // ranked: findEvidence scores candidates by embedding similarity when
      // the model is available, so recomputing coverage would show the user a
      // match % for a metric that had no part in choosing or ordering these.
      const textRelevance = item.textRelevance
      const rankRelevance = clamp01(1 - item.relevanceRank / RANK_RELEVANCE_LIMIT)
      const matchPercent = Math.round(100 * clamp01(0.75 * textRelevance + 0.25 * rankRelevance))
      return { item, sourceRef: sourceRefFor(item, i), matchPercent }
    })
    .sort((a, b) => b.matchPercent - a.matchPercent)
    .slice(0, MAX_FIND_SOURCE_CANDIDATES)

  // Unlike leanEvidence's fire-and-forget favicon lookups (fine there since
  // widget.claims re-pushes on every redraw), this response is a one-shot
  // IPC reply the renderer stores directly — there's no later redraw that
  // would pick up a favicon that resolved after the fact. So this awaits
  // the (small, capped, timeout-bounded) fetch for just the final top-N
  // candidates before returning, rather than returning null placeholders.
  const candidates: ScreenWatchSourceCandidate[] = await Promise.all(
    ranked.map(async ({ item, sourceRef, matchPercent }) => ({
      sourceRef,
      title: item.title,
      venue: item.venue,
      year: item.year,
      provider: item.provider,
      url: item.url,
      matchPercent,
      faviconDataUrl: await getFaviconDataUrl(item.url)
    }))
  )
  return candidates
}

// The overlay's "Insert citation" action — formats both citation forms from
// the chosen candidate (never touching sourcesRepo/citationsRepo, same
// ephemeral rule as the rest of Screen Watch) and types the in-text form
// into the watched external document right after the claim's current text,
// via the new UIA write-back in uiaSnapshot.ts.
export async function insertCitationForClaim(
  claimId: string,
  sourceRef: string,
  style: CitationStyle
): Promise<ScreenWatchClaimCitation> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) throw new Error('This claim is no longer being tracked (the watched text likely changed).')

  const item = resolveSourceRef(claimId, sourceRef)
  if (!item) throw new Error('That source is no longer available — try searching again.')

  const source = synthesizeSourceFromResult(item, 0)
  const worksCitedEntry = formatCitation(source, style)
  const inTextCitation = formatInTextCitation(source, style)

  const span = currentSpans.find((s) => s.id === claimId)
  if (!span) throw new Error('Could not locate this claim in the document anymore — try again.')
  const insertOffset = span.start + span.length
  const fullText = lastUpdateInputs?.fullText ?? ''
  const expectedSnippet = fullText.slice(insertOffset, insertOffset + 30)

  const result = await insertCitationText(insertOffset, ` ${inTextCitation}`, expectedSnippet)
  if (!result.ok) throw new Error(result.error)

  const citation: ScreenWatchClaimCitation = { inTextCitation, worksCitedEntry }
  citationByClaimId.set(claimId, { ...citation, insertOffset })
  redrawOverlay()
  return citation
}

// "Undo" on the citation-added confirmation — a plain Ctrl+Z to whatever
// app is still focused. Reliable because insertCitationForClaim always
// performs exactly one paste, which is one undo step in effectively every
// real text editor/browser; Tracely doesn't need to track its own undo
// stack for this. Leaves the claim flagged again (removed from
// citationByClaimId) so the user can retry or pick a different source.
export async function undoCitationForClaim(claimId: string): Promise<void> {
  if (!citationByClaimId.has(claimId)) return
  const result = await undoLastInsert()
  if (!result.ok) throw new Error(result.error)
  citationByClaimId.delete(claimId)
  redrawOverlay()
}

function updateOverlayAndWidget(
  windowRect: ScreenRect,
  claimRects: { id: string; rects: ScreenRect[] }[],
  claims: Claim[],
  fullText: string
): void {
  lastUpdateInputs = { windowRect, claimRects, claims, fullText }

  const underlines = (Array.isArray(claimRects) ? claimRects : []).filter(
    (r) => Array.isArray(r.rects) && r.rects.length > 0
  )

  if (underlines.length === 0 && claims.length > 0) {
    logScreenWatch(`${claims.length} claim(s) tracked but none located on screen (off-screen or no match)`)
  }

  const center = {
    x: windowRect.x + windowRect.width / 2,
    y: windowRect.y + windowRect.height / 2
  }
  const display = screen.getDisplayNearestPoint(center)

  // UI Automation returns physical screen pixels; Electron window bounds are
  // logical (DPI-scaled) pixels. On anything other than 100% display scaling
  // (125%/150% are the common Windows defaults on modern laptops) these are
  // different units — divide by scaleFactor or every rect lands in the wrong
  // place. This assumes the display's physical top-left aligns with its
  // logical (0,0), which holds for the primary display; a true secondary-
  // display-with-different-scale fix would need each display's physical
  // origin, which Electron doesn't expose — still a known gap for that
  // specific case.
  const scale = display.scaleFactor || 1
  const windowLogical = {
    x: windowRect.x / scale,
    y: windowRect.y / scale,
    width: windowRect.width / scale,
    height: windowRect.height / scale
  }
  lastOverlayOrigin = { x: windowLogical.x, y: windowLogical.y }

  // The overlay is sized to the focused app's own window, not the whole
  // display — the OS clips anything drawn outside a window's own bounds for
  // free, which is what keeps underlines/the widget confined to whichever
  // app is actually focused instead of "leaking" across the rest of the
  // screen. The widget badge (see hoverTracking.ts / OverlayApp.tsx) shows
  // whenever a supported text field is focused — like Grammarly's icon —
  // independent of whether any claims were found yet, so the overlay stays
  // shown for that even with zero underlines.
  const win = showOverlayOnWindow({
    x: Math.round(windowLogical.x),
    y: Math.round(windowLogical.y),
    width: Math.max(1, Math.round(windowLogical.width)),
    height: Math.max(1, Math.round(windowLogical.height))
  })

  const toLocal = (r: ScreenRect): ScreenRect => ({
    x: r.x / scale - windowLogical.x,
    y: r.y / scale - windowLogical.y,
    width: r.width / scale,
    height: r.height / scale
  })
  const toAbsolute = (r: ScreenRect): ScreenRect => ({
    x: r.x / scale,
    y: r.y / scale,
    width: r.width / scale,
    height: r.height / scale
  })

  const localized = underlines.map((u) => ({
    id: u.id,
    rects: u.rects.map(toLocal),
    claimType: claims.find((c) => c.id === u.id)?.claimType ?? 'factual'
  }))

  // Anchored to a fixed corner of the focused app's window, not the focused
  // control — a control-relative anchor moved every time the user typed (the
  // control's rect can shift as text reflows), which is exactly the "don't
  // follow where I'm typing" behavior this replaced. Local space is already
  // window-local logical pixels (the overlay window IS the app window), so
  // no physical/scale conversion is needed here at all, unlike the underline
  // rects above.
  const winBounds = win.getBounds()
  const widgetLocalAnchored: ScreenRect = {
    x: Math.max(0, winBounds.width - WIDGET_SIZE - EDGE_MARGIN),
    y: Math.max(0, winBounds.height - WIDGET_SIZE - EDGE_MARGIN),
    width: WIDGET_SIZE,
    height: WIDGET_SIZE
  }
  const panelSize =
    widgetViewMode === 'all'
      ? computeAllPanelSize(claims.length)
      : { width: SINGLE_PANEL_WIDTH, height: SINGLE_PANEL_HEIGHT }
  const panelLocalAnchored: ScreenRect = {
    x: Math.max(0, winBounds.width - panelSize.width - EDGE_MARGIN),
    y: Math.max(0, winBounds.height - panelSize.height - EDGE_MARGIN),
    width: panelSize.width,
    height: panelSize.height
  }

  const anchoredLocal = widgetExpanded ? panelLocalAnchored : widgetLocalAnchored
  // A user-dragged position overrides the anchor until the widget collapses
  // or a new control/app comes into focus (see widgetManualPos above).
  const activeLocal: ScreenRect = widgetManualPos
    ? { x: widgetManualPos.x, y: widgetManualPos.y, width: anchoredLocal.width, height: anchoredLocal.height }
    : anchoredLocal
  // Must add the overlay's own origin (the focused app window's logical
  // top-left, windowLogical), not display.bounds — the overlay is sized to
  // that window, not the whole display, since the window-scoping change.
  // Adding the display's origin here left the widget's hit-test rect offset
  // from where it's actually drawn whenever the app window didn't start at
  // the display's own top-left corner, so hoverTracking.ts never detected
  // the cursor over it and clicks always passed through.
  const activeAbsolute: ScreenRect = {
    x: activeLocal.x + windowLogical.x,
    y: activeLocal.y + windowLogical.y,
    width: activeLocal.width,
    height: activeLocal.height
  }

  if (underlines.length > 0) {
    logScreenWatch(
      `showing ${underlines.length} underline(s) on display ${display.id} (bounds ${JSON.stringify(display.bounds)}, scaleFactor=${display.scaleFactor}), overlay window bounds=${JSON.stringify(win.getBounds())}, visible=${win.isVisible()}, rects=${JSON.stringify(localized)}`
    )
  }

  const claimSummaries: ScreenWatchClaimSummary[] = [...claims]
    .sort((a, b) => b.confidence - a.confidence)
    .map((c) => {
      const critique = critiqueByClaimId.get(c.id)
      const citation = citationByClaimId.get(c.id)
      return {
        id: c.id,
        text: c.text,
        claimType: c.claimType,
        confidence: c.confidence,
        evidence: leanEvidence(c.id),
        critique: critique?.critique ?? null,
        critiqueVerdict: critique?.verdict ?? null,
        citation: citation ? { inTextCitation: citation.inTextCitation, worksCitedEntry: citation.worksCitedEntry } : null
      }
    })
  // The actual number of sources found across every currently-flagged claim
  // — previously this also added +1 per claim (counting the claim itself as
  // a piece of "info"), which inflated the badge well past the number of
  // real sources anyone could actually see or click on.
  const totalInfoCount = claimSummaries.reduce((sum, c) => sum + (c.evidence?.count ?? 0), 0)

  const payload: {
    underlines: typeof localized
    widget: {
      rect: ScreenRect
      expanded: boolean
      viewMode: WidgetViewMode
      claimCount: number
      claims: ScreenWatchClaimSummary[]
      totalInfoCount: number
    }
  } = {
    underlines: localized,
    widget: {
      rect: activeLocal,
      expanded: widgetExpanded,
      viewMode: widgetViewMode,
      claimCount: claims.length,
      claims: claimSummaries,
      totalInfoCount
    }
  }
  // Re-sending an unchanged payload every poll tick (every 1.2s, even when
  // nothing on screen actually changed) forces the renderer to re-render
  // the whole overlay tree for no reason — on a transparent always-on-top
  // window that's a plausible source of visible flicker. Skip the send
  // (and the resulting re-render) when nothing observable changed.
  const payloadKey = JSON.stringify(payload)
  if (payloadKey === lastSentPayloadKey) return
  lastSentPayloadKey = payloadKey

  win.webContents.send(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, payload)
  emitTracerContext()

  const claimTargets = underlines
    .map((u, idx) => {
      const claim = claims.find((c) => c.id === u.id)
      if (!claim) return null
      const target: HoverTarget = {
        claimId: u.id,
        kind: 'claim',
        text: claim.text,
        claimType: claim.claimType,
        rectsAbsolute: u.rects.map(toAbsolute),
        rectsWindowLocal: localized[idx].rects
      }
      return target
    })
    .filter((t): t is HoverTarget => t !== null)

  const widgetTarget: HoverTarget = {
    claimId: '__widget__',
    kind: 'widget',
    text: fullText,
    claimType: 'factual',
    rectsAbsolute: [activeAbsolute],
    rectsWindowLocal: [activeLocal]
  }

  hoverTargets = [...claimTargets, widgetTarget]
}

/**
 * What Tracer is allowed to see: the text of the watched document and the
 * claims currently flagged in it. Read live from the same in-memory state
 * the overlay draws from — deliberately NOT from the database, since Screen
 * Watch persists none of this (see the note on synthesizeClaim).
 *
 * Returns empty context rather than throwing when Screen Watch is off or no
 * allowed app is focused: Tracer is still useful as a plain tutor with no
 * document in hand, it just can't refer to anything specific.
 */
export function getTracerContext(): TracerContext {
  const claims = lastUpdateInputs?.claims ?? currentClaims
  return {
    processName: lastStatus.active ? lastStatus.processName : null,
    documentText: lastUpdateInputs?.fullText ?? '',
    claims: claims.map((c) => ({
      id: c.id,
      text: c.text,
      claimType: c.claimType,
      evidenceScore: evidenceResultByClaimId.get(c.id)?.score ?? null
    }))
  }
}

// Pushed to the Tracer window whenever the watched document or its claims
// change, so an open conversation's "what I can see" header stays live
// instead of being a snapshot from whenever the window happened to open.
function emitTracerContext(): void {
  const win = getTracerWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send(IPC_EVENTS.TRACER_CONTEXT_CHANGED, getTracerContext())
}

export function isScreenWatchEnabled(): boolean {
  return enabled
}

export function startScreenWatch(): void {
  if (enabled) return
  enabled = true
  setSetting('screenWatchEnabled', 'true')
  resetTrackingState()
  resetScreenWatchLog()
  lastError = null
  lastStatus = { ...lastStatus, enabled: true, lastError: null }
  startHoverTracking()
  void tick()
}

export function stopScreenWatch(): void {
  enabled = false
  setSetting('screenWatchEnabled', 'false')
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  stopHoverTracking()
  resetTrackingState()
  hideOverlay()
  emitStatus({
    enabled: false,
    active: false,
    processName: null,
    supportsUnderlines: false,
    claimCount: 0,
    lastError: null,
    blockedApp: null
  })
}

export function initScreenWatch(): void {
  if (getSetting('screenWatchEnabled') === 'true') {
    startScreenWatch()
  }
}

export function shutdownScreenWatch(): void {
  enabled = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  stopHoverTracking()
  const win = getOverlayWindow()
  win?.destroy()
}
