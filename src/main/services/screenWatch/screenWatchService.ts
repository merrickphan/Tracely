import { randomUUID } from 'crypto'
import { BrowserWindow, screen } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import type { Claim } from '@shared/types'
import { computeClaimSpans } from '@shared/claimSpans'
import { detectClaims } from '../ai/claimDetection'
import { getSetting, setSetting } from '../storage/settingsRepo'
import { getOverlayWindow, hideOverlay, showOverlayOnDisplay } from '../../windows/overlayWindow'
import { getMainWindow } from '../../windows/mainWindow'
import { logScreenWatch, resetScreenWatchLog } from './debugLog'
import { setDragActive, startHoverTracking, stopHoverTracking } from './hoverTracking'
import { takeUiaSnapshot, type ClaimSpanRequest, type ScreenRect } from './uiaSnapshot'

const POLL_INTERVAL_MS = 1200
const STABLE_MS = 1200
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
let currentClaims: Claim[] = []
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
  controlRect: ScreenRect
  claimRects: { id: string; rects: ScreenRect[] }[]
  claims: Claim[]
  fullText: string
} | null = null

// Window-local top-left corner the user last dragged the widget/panel to —
// overrides the fixed corner anchor while set. Cleared whenever the widget
// collapses or a new control/app comes into focus, so the next expand
// starts fresh at the anchor rather than wherever it happened to be left.
let widgetManualPos: { x: number; y: number } | null = null

export function setWidgetExpanded(expanded: boolean): void {
  widgetExpanded = expanded
  if (!expanded) widgetManualPos = null
  if (lastUpdateInputs) {
    updateOverlayAndWidget(
      lastUpdateInputs.controlRect,
      lastUpdateInputs.claimRects,
      lastUpdateInputs.claims,
      lastUpdateInputs.fullText
    )
  }
}

export function setWidgetDragStart(): void {
  setDragActive(true)
}

export function setWidgetDragEnd(local: { x: number; y: number }): void {
  widgetManualPos = local
  setDragActive(false)
  if (lastUpdateInputs) {
    updateOverlayAndWidget(
      lastUpdateInputs.controlRect,
      lastUpdateInputs.claimRects,
      lastUpdateInputs.claims,
      lastUpdateInputs.fullText
    )
  }
}

// The display a claim's underline was last drawn on — needed to convert the
// renderer-reported popover rect (window-local) into absolute screen
// coordinates for hoverTracking.ts, the same way widget drag positions are
// converted.
let lastDisplayOrigin: { x: number; y: number } | null = null
let activePopoverClaimId: string | null = null
let activePopoverRectAbsolute: ScreenRect | null = null

export function setActivePopoverRect(claimId: string | null, rectLocal: ScreenRect | null): void {
  activePopoverClaimId = claimId
  activePopoverRectAbsolute =
    rectLocal && lastDisplayOrigin
      ? {
          x: rectLocal.x + lastDisplayOrigin.x,
          y: rectLocal.y + lastDisplayOrigin.y,
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

function getBlockedApps(): string[] {
  return getSetting('screenWatchBlockedApps')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Default-allow (works in any app, like Grammarly) with an opt-out
// blocklist rather than an opt-in allowlist — the blocklist defaults to
// chat/DM apps (Discord, Slack, Teams, ...) so casual messages don't get
// read without the user ever having to configure anything, while any other
// app just works out of the box.
function isProcessBlocked(processName: string): boolean {
  const blocked = getBlockedApps()
  return blocked.some((name) => name.toLowerCase() === processName.toLowerCase())
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
  currentSpans = []
  hoverTargets = []
  widgetExpanded = false
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

    if (isProcessBlocked(snapshot.processName)) {
      // Not an error — the user's blocklist just excludes this app. Bail
      // out before any text ever reaches detectClaims: this is the actual
      // token-usage and privacy boundary, not just a UI filter.
      hideOverlay()
      resetTrackingState()
      logScreenWatch(`focused app ${snapshot.processName} is on the blocklist, skipping`)
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
      Date.now() - pendingSince >= STABLE_MS &&
      Date.now() >= retryAfter &&
      !detecting
    ) {
      detecting = true
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

    updateOverlayAndWidget(snapshot.controlRect, snapshot.claimRects, currentClaims, snapshot.text)

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
// Fixed distance from the display's bottom-right corner — matches where the
// Figma mockups place it, and (deliberately) has nothing to do with where
// the focused control or text cursor currently is.
const EDGE_MARGIN = 24
// Matches the Figma "Widget over Document" mockup's card size exactly.
const PANEL_WIDTH = 560
const PANEL_HEIGHT = 320

let lastSentPayloadKey: string | null = null

function computeWidgetBreakdown(claims: Claim[]): { statisticCount: number; factualCount: number; otherCount: number } {
  let statisticCount = 0
  let factualCount = 0
  let otherCount = 0
  for (const claim of claims) {
    if (claim.claimType === 'statistic') statisticCount++
    else if (claim.claimType === 'factual') factualCount++
    else otherCount++
  }
  return { statisticCount, factualCount, otherCount }
}

function computeAvgConfidencePercent(claims: Claim[]): number {
  if (claims.length === 0) return 0
  const sum = claims.reduce((acc, c) => acc + c.confidence, 0)
  return Math.round((sum / claims.length) * 100)
}

function updateOverlayAndWidget(
  controlRect: ScreenRect,
  claimRects: { id: string; rects: ScreenRect[] }[],
  claims: Claim[],
  fullText: string
): void {
  lastUpdateInputs = { controlRect, claimRects, claims, fullText }

  const underlines = (Array.isArray(claimRects) ? claimRects : []).filter(
    (r) => Array.isArray(r.rects) && r.rects.length > 0
  )

  if (underlines.length === 0 && claims.length > 0) {
    logScreenWatch(`${claims.length} claim(s) tracked but none located on screen (off-screen or no match)`)
  }

  const center = {
    x: controlRect.x + controlRect.width / 2,
    y: controlRect.y + controlRect.height / 2
  }
  const display = screen.getDisplayNearestPoint(center)
  lastDisplayOrigin = { x: display.bounds.x, y: display.bounds.y }
  // The widget badge (see hoverTracking.ts / OverlayApp.tsx) shows
  // whenever a supported text field is focused — like Grammarly's icon —
  // independent of whether any claims were found yet, so the overlay stays
  // shown for that even with zero underlines.
  const win = showOverlayOnDisplay(display)

  // UI Automation returns physical screen pixels; Electron window bounds are
  // logical (DPI-scaled) pixels. On anything other than 100% display scaling
  // (125%/150% are the common Windows defaults on modern laptops) these are
  // different units — divide by scaleFactor or every rect lands in the wrong
  // place, usually off the visible overlay window entirely. This assumes the
  // display's physical top-left aligns with its logical (0,0), which holds
  // for the primary display; a true secondary-display-with-different-scale
  // fix would need each display's physical origin, which Electron doesn't
  // expose — still a known gap for that specific case.
  const scale = display.scaleFactor || 1
  const toLocal = (r: ScreenRect): ScreenRect => ({
    x: r.x / scale - display.bounds.x,
    y: r.y / scale - display.bounds.y,
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

  // Anchored to a fixed corner of the display, not the focused control — a
  // control-relative anchor moved every time the user typed (the control's
  // rect can shift as text reflows), which is exactly the "don't follow
  // where I'm typing" behavior this replaced. Local space is already
  // window-local logical pixels (the overlay window IS the display), so no
  // physical/scale conversion is needed here at all, unlike the underline
  // rects above.
  const winBounds = win.getBounds()
  const widgetLocalAnchored: ScreenRect = {
    x: Math.max(0, winBounds.width - WIDGET_SIZE - EDGE_MARGIN),
    y: Math.max(0, winBounds.height - WIDGET_SIZE - EDGE_MARGIN),
    width: WIDGET_SIZE,
    height: WIDGET_SIZE
  }
  const panelLocalAnchored: ScreenRect = {
    x: Math.max(0, winBounds.width - PANEL_WIDTH - EDGE_MARGIN),
    y: Math.max(0, winBounds.height - PANEL_HEIGHT - EDGE_MARGIN),
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT
  }

  const anchoredLocal = widgetExpanded ? panelLocalAnchored : widgetLocalAnchored
  // A user-dragged position overrides the anchor until the widget collapses
  // or a new control/app comes into focus (see widgetManualPos above).
  const activeLocal: ScreenRect = widgetManualPos
    ? { x: widgetManualPos.x, y: widgetManualPos.y, width: anchoredLocal.width, height: anchoredLocal.height }
    : anchoredLocal
  const activeAbsolute: ScreenRect = {
    x: activeLocal.x + display.bounds.x,
    y: activeLocal.y + display.bounds.y,
    width: activeLocal.width,
    height: activeLocal.height
  }

  if (underlines.length > 0) {
    logScreenWatch(
      `showing ${underlines.length} underline(s) on display ${display.id} (bounds ${JSON.stringify(display.bounds)}, scaleFactor=${display.scaleFactor}), overlay window bounds=${JSON.stringify(win.getBounds())}, visible=${win.isVisible()}, rects=${JSON.stringify(localized)}`
    )
  }

  const payload: {
    underlines: typeof localized
    widget: {
      rect: ScreenRect
      expanded: boolean
      claimCount: number
      breakdown: ReturnType<typeof computeWidgetBreakdown>
      avgConfidencePercent: number
      text: string
    }
  } = {
    underlines: localized,
    widget: {
      rect: activeLocal,
      expanded: widgetExpanded,
      claimCount: claims.length,
      breakdown: computeWidgetBreakdown(claims),
      avgConfidencePercent: computeAvgConfidencePercent(claims),
      text: fullText
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
