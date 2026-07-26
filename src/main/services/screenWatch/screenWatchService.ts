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
import { takeUiaSnapshot, type ScreenRect } from './uiaSnapshot'

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
  lastError: null
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
}

async function tick(): Promise<void> {
  if (!enabled || ticking) return
  ticking = true
  try {
    const queries = currentClaims.map((c) => c.text)
    const snapshot = await takeUiaSnapshot(queries)

    if (!snapshot.ok) {
      lastError = snapshot.error
      console.error('[screenWatch] snapshot failed:', snapshot.error)
      emitStatus({
        enabled,
        active: false,
        processName: null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError
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
        lastError
      })
      return
    }

    if (snapshot.text !== pendingText) {
      pendingText = snapshot.text
      pendingSince = Date.now()
    } else if (
      pendingText.trim().length >= MIN_TEXT_LENGTH &&
      pendingText !== lastAnalyzedText &&
      Date.now() - pendingSince >= STABLE_MS &&
      Date.now() >= retryAfter &&
      !detecting
    ) {
      detecting = true
      const textAtRequestTime = pendingText
      detectClaims(textAtRequestTime)
        .then((detected) => {
          // Only mark this text "done" on success — a failure must stay
          // retryable rather than being silently marked as already-tried.
          lastAnalyzedText = textAtRequestTime
          currentClaims = detected.map(synthesizeClaim)
          lastError = null
          console.log(`[screenWatch] detected ${currentClaims.length} claim(s)`)
          // Don't wait for the next scheduled poll tick to show results —
          // that adds up to POLL_INTERVAL_MS of dead time on top of the
          // relay round-trip for no reason.
          void tick()
        })
        .catch((err) => {
          retryAfter = Date.now() + RETRY_COOLDOWN_MS
          lastError = err instanceof Error ? err.message : String(err)
          console.error('[screenWatch] detectClaims failed:', lastError)
        })
        .finally(() => {
          detecting = false
        })
    }

    updateOverlay(snapshot.controlRect, snapshot.claimRects, currentClaims)

    emitStatus({
      enabled,
      active: true,
      processName: snapshot.processName,
      supportsUnderlines: snapshot.supportsTextPattern,
      claimCount: currentClaims.length,
      lastError
    })
  } finally {
    ticking = false
    if (enabled) timer = setTimeout(tick, POLL_INTERVAL_MS)
  }
}

function updateOverlay(
  controlRect: ScreenRect,
  claimRects: { query: string; rects: ScreenRect[] }[],
  claims: Claim[]
): void {
  const underlines: { id: string; rects: ScreenRect[] }[] = []

  for (const result of claimRects) {
    if (result.rects.length === 0) continue
    const claim = claims.find((c) => c.text === result.query)
    if (!claim) continue
    underlines.push({ id: claim.id, rects: result.rects })
  }

  if (underlines.length === 0) {
    if (claims.length > 0) {
      console.log(
        `[screenWatch] ${claims.length} claim(s) tracked but none located on screen (off-screen or no match)`
      )
    }
    hideOverlay()
    return
  }
  console.log(`[screenWatch] showing ${underlines.length} underline(s)`)

  const center = {
    x: controlRect.x + controlRect.width / 2,
    y: controlRect.y + controlRect.height / 2
  }
  const display = screen.getDisplayNearestPoint(center)
  const win = showOverlayOnDisplay(display)

  const localized = underlines.map((u) => ({
    id: u.id,
    rects: u.rects.map((r) => ({
      x: r.x - display.bounds.x,
      y: r.y - display.bounds.y,
      width: r.width,
      height: r.height
    }))
  }))

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
    lastError: null
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
