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
import { takeUiaSnapshot, type ClaimSpanRequest, type ScreenRect } from './uiaSnapshot'

const POLL_INTERVAL_MS = 1200
const STABLE_MS = 1200
const MIN_TEXT_LENGTH = 20

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

// Fail closed: an empty/unset allowlist means Screen Watch runs nowhere,
// rather than defaulting to "everywhere" — this is the guard against
// scanning apps like Discord that the user never asked it to read, and it's
// also what keeps relay token usage bounded to only the apps picked.
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
  currentSpans = []
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

    if (!isProcessAllowed(snapshot.processName)) {
      // Not an error — the user just hasn't put this app on the allowlist.
      // Bail out before any text ever reaches detectClaims: this is the
      // actual token-usage and privacy boundary, not just a UI filter.
      hideOverlay()
      resetTrackingState()
      logScreenWatch(`focused app ${snapshot.processName} is not in the allowlist, skipping`)
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
          currentClaims = detected.map(synthesizeClaim)
          lastError = null
          logScreenWatch(
            `detected ${currentClaims.length} claim(s): ${currentClaims.map((c) => JSON.stringify(c.text)).join(', ')}`
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

    updateOverlay(snapshot.controlRect, snapshot.claimRects, currentClaims)

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

function updateOverlay(
  controlRect: ScreenRect,
  claimRects: { id: string; rects: ScreenRect[] }[],
  claims: Claim[]
): void {
  const underlines = (Array.isArray(claimRects) ? claimRects : []).filter(
    (r) => Array.isArray(r.rects) && r.rects.length > 0
  )

  if (underlines.length === 0) {
    if (claims.length > 0) {
      logScreenWatch(`${claims.length} claim(s) tracked but none located on screen (off-screen or no match)`)
    }
    hideOverlay()
    return
  }

  const center = {
    x: controlRect.x + controlRect.width / 2,
    y: controlRect.y + controlRect.height / 2
  }
  const display = screen.getDisplayNearestPoint(center)
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
  const localized = underlines.map((u) => ({
    id: u.id,
    rects: u.rects.map((r) => ({
      x: r.x / scale - display.bounds.x,
      y: r.y / scale - display.bounds.y,
      width: r.width / scale,
      height: r.height / scale
    }))
  }))

  logScreenWatch(
    `showing ${underlines.length} underline(s) on display ${display.id} (bounds ${JSON.stringify(display.bounds)}, scaleFactor=${display.scaleFactor}), overlay window bounds=${JSON.stringify(win.getBounds())}, visible=${win.isVisible()}, rects=${JSON.stringify(localized)}`
  )

  win.webContents.send(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, { underlines: localized })
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
  void tick()
}

export function stopScreenWatch(): void {
  enabled = false
  setSetting('screenWatchEnabled', 'false')
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
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
  const win = getOverlayWindow()
  win?.destroy()
}
