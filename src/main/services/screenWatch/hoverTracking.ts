import { screen } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { ScreenWatchHoverEvent } from '@shared/ipc-contract'
import { getOverlayWindow } from '../../windows/overlayWindow'
import { getHoverTargets } from './screenWatchService'

// The overlay window is click-through by default (setIgnoreMouseEvents with
// forward:true) so it never steals clicks from whatever app is underneath —
// that's the whole point of an overlay. But that also means the renderer
// never receives real mouse events, so hovering can't be detected from
// inside the window itself. Instead we poll the OS-level cursor position
// from the main process (which works regardless of window focus) and toggle
// click-through on/off depending on whether the cursor is over a claim's
// underline — the same technique Grammarly's desktop overlay uses.
const POLL_MS = 80
// Rects are padded well past the underline itself, mainly downward, so the
// hit zone also covers the space the tooltip renders into — otherwise
// moving the mouse from the underline down to the tooltip's button would
// cross a gap with no hit zone and the tooltip would vanish before you get
// there.
const PAD_SIDE = 6
const PAD_TOP = 4
const PAD_BOTTOM = 90
// Small grace period after the cursor leaves the hit zone before actually
// hiding — absorbs the kind of momentary jitter that'd otherwise make the
// tooltip flicker in and out near the boundary.
const LEAVE_GRACE_MS = 200

let pollTimer: ReturnType<typeof setInterval> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let hoveredClaimId: string | null = null
let mouseEventsCaptured = false

function setCaptureMouseEvents(capture: boolean): void {
  if (capture === mouseEventsCaptured) return
  mouseEventsCaptured = capture
  const win = getOverlayWindow()
  if (!win || win.isDestroyed()) return
  if (capture) {
    win.setIgnoreMouseEvents(false)
  } else {
    win.setIgnoreMouseEvents(true, { forward: true })
  }
}

function sendHover(event: ScreenWatchHoverEvent | null): void {
  const win = getOverlayWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC_EVENTS.SCREENWATCH_HOVER_CHANGED, event)
}

function clearHover(): void {
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
  if (hoveredClaimId === null) return
  hoveredClaimId = null
  setCaptureMouseEvents(false)
  sendHover(null)
}

function poll(): void {
  const targets = getHoverTargets()
  if (targets.length === 0) {
    clearHover()
    return
  }

  const cursor = screen.getCursorScreenPoint()
  const match = targets.find((t) =>
    t.rectsAbsolute.some(
      (r) =>
        cursor.x >= r.x - PAD_SIDE &&
        cursor.x <= r.x + r.width + PAD_SIDE &&
        cursor.y >= r.y - PAD_TOP &&
        cursor.y <= r.y + r.height + PAD_BOTTOM
    )
  )

  if (match) {
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
    if (hoveredClaimId !== match.claimId) {
      hoveredClaimId = match.claimId
      setCaptureMouseEvents(true)
      sendHover({
        claimId: match.claimId,
        text: match.text,
        claimType: match.claimType,
        anchor: match.rectsWindowLocal[0]
      })
    }
    return
  }

  if (hoveredClaimId !== null && !leaveTimer) {
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      clearHover()
    }, LEAVE_GRACE_MS)
  }
}

export function startHoverTracking(): void {
  if (pollTimer) return
  pollTimer = setInterval(poll, POLL_MS)
}

export function stopHoverTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
  hoveredClaimId = null
  setCaptureMouseEvents(false)
}
