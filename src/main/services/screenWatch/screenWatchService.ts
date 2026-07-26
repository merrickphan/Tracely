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
import { startHoverTracking, stopHoverTracking } from './hoverTracking'
import { takeUiaSnapshot, type ClaimSpanRequest, type ScreenRect } from './uiaSnapshot'

const POLL_INTERVAL_MS = 1200
const STABLE_MS = 1200
const MIN_TEXT_LENGTH = 20
// Screen Watch underlines passively, without the user asking about any one
// sentence — a borderline/low-confidence call here is far more annoying
// (flagging ordinary descriptive sentences) than it would be in Analyze,
// where the user explicitly asked for a full pass and can just ignore a
// weak one. Filtering to higher-confidence claims only is a second,
// independent guard on top of the detection prompt itself.
const MIN_CLAIM_CONFIDENCE = 0.6

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
          const confident = detected.filter((c) => c.confidence >= MIN_CLAIM_CONFIDENCE)
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

const WIDGET_SIZE = 26
const WIDGET_INSET = 6

function updateOverlayAndWidget(
  controlRect: ScreenRect,
  claimRects: { id: string; rects: ScreenRect[] }[],
  claims: Claim[],
  fullText: string
): void {
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

  const localized = underlines.map((u) => ({ id: u.id, rects: u.rects.map(toLocal) }))

  const widgetPhysicalSize = WIDGET_SIZE * scale
  const widgetInsetPhysical = WIDGET_INSET * scale
  const widgetPhysicalRect: ScreenRect = {
    x: controlRect.x + controlRect.width - widgetPhysicalSize - widgetInsetPhysical,
    y: controlRect.y + controlRect.height - widgetPhysicalSize - widgetInsetPhysical,
    width: widgetPhysicalSize,
    height: widgetPhysicalSize
  }
  const widgetLocal = toLocal(widgetPhysicalRect)
  const widgetAbsolute = toAbsolute(widgetPhysicalRect)

  if (underlines.length > 0) {
    logScreenWatch(
      `showing ${underlines.length} underline(s) on display ${display.id} (bounds ${JSON.stringify(display.bounds)}, scaleFactor=${display.scaleFactor}), overlay window bounds=${JSON.stringify(win.getBounds())}, visible=${win.isVisible()}, rects=${JSON.stringify(localized)}`
    )
  }

  win.webContents.send(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, {
    underlines: localized,
    widget: { rect: widgetLocal, claimCount: claims.length, text: fullText }
  })

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
    rectsAbsolute: [widgetAbsolute],
    rectsWindowLocal: [widgetLocal]
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
