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
// Rects are padded past the underline itself, mainly downward, so the hit
// zone also covers the space the tooltip renders into — otherwise moving
// the mouse from the underline down to the tooltip's button would cross a
// gap with no hit zone and the tooltip would vanish before you get there.
// The tooltip is anchored directly under the underline (not the cursor),
// so this needs to comfortably cover that fixed gap.
const PAD_SIDE = 6
const PAD_TOP = 4
const PAD_BOTTOM = 90
// The widget badge has no tooltip growing below it (its label is a native
// OS title tooltip, not part of our DOM), so it only needs a small uniform
// pad — the claim's generous PAD_BOTTOM would otherwise create a dead zone
// below the widget that silently swallows clicks meant for the app
// underneath instead of passing them through.
const WIDGET_PAD = 4
// Small grace period after the cursor leaves the hit zone before actually
// hiding — absorbs the kind of momentary jitter that'd otherwise make the
// tooltip flicker in and out near the boundary.
const LEAVE_GRACE_MS = 200

let pollTimer: ReturnType<typeof setInterval> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let hoveredKey: string | null = null
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
  if (hoveredKey === null) return
  hoveredKey = null
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
  let match: (typeof targets)[number] | null = null
  let matchedRectIndex = 0
  for (const t of targets) {
    const padBottom = t.kind === 'widget' ? WIDGET_PAD : PAD_BOTTOM
    const padSide = t.kind === 'widget' ? WIDGET_PAD : PAD_SIDE
    const padTop = t.kind === 'widget' ? WIDGET_PAD : PAD_TOP
    const idx = t.rectsAbsolute.findIndex(
      (r) =>
        cursor.x >= r.x - padSide &&
        cursor.x <= r.x + r.width + padSide &&
        cursor.y >= r.y - padTop &&
        cursor.y <= r.y + r.height + padBottom
    )
    if (idx !== -1) {
      match = t
      matchedRectIndex = idx
      break
    }
  }

  if (match) {
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
    // Only re-send on an actual target (or matched line, for a claim that
    // wraps multiple lines) change — the tooltip is anchored to that rect,
    // not the cursor, so it has no reason to move on every tick.
    const hoverKey = `${match.claimId}:${matchedRectIndex}`
    if (hoveredKey !== hoverKey) {
      hoveredKey = hoverKey
      setCaptureMouseEvents(true)
      sendHover({
        claimId: match.claimId,
        kind: match.kind,
        text: match.text,
        claimType: match.claimType,
        anchor: match.rectsWindowLocal[matchedRectIndex] ?? match.rectsWindowLocal[0]
      })
    }
    return
  }

  if (hoveredKey !== null && !leaveTimer) {
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
  hoveredKey = null
  setCaptureMouseEvents(false)
}
