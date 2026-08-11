import { screen } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { ScreenWatchHoverEvent } from '@shared/ipc-contract'
import { focusedShieldableWindow, isPointOverOpenTracer } from '../../windows/overlayShield'
import { getOverlayWindow, setOverlayMouseEventsCaptured } from '../../windows/overlayWindow'
import { getActivePopoverRect, getHoverTargets } from './screenWatchService'
import type { ScreenRect } from './uiaSnapshot'

// The overlay window is click-through by default (setIgnoreMouseEvents with
// forward:true) so it never steals clicks from whatever app is underneath —
// that's the whole point of an overlay. But that also means the renderer
// never receives real mouse events, so hovering can't be detected from
// inside the window itself. Instead we poll the OS-level cursor position
// from the main process (which works regardless of window focus) and toggle
// click-through on/off depending on whether the cursor is over a claim's
// underline — the same technique Grammarly's desktop overlay uses.
const POLL_MS = 80
// Opening a popover requires the cursor to actually touch the underline —
// like Grammarly — not just be somewhere in its general vicinity. Small,
// uniform pad, used for every target every time (no more "loose zone while
// already hovered" guesswork — see below for what replaced that).
const PAD_SIDE = 2
const PAD_TOP = 2
const PAD_BOTTOM = 3
// The collapsed launcher circle's badge pokes a few px past the circle's own
// bounds (see WIDGET_SIZE in screenWatchService.ts), and needs a small pad
// to stay clickable. The target explicitly overrides this to zero for the
// expanded panel so transparent pixels around it remain click-through.
const WIDGET_PAD = 5
// Once a claim's popover is open, its REAL rendered rect (reported by the
// renderer via setActivePopoverRect — see screenWatchService.ts) is used to
// decide whether the cursor is still "in" it, with just this small comfort
// margin — not a blindly large guessed pad. This is what makes moving to
// "Find a source"/"Dismiss" work AND makes moving away from the popover
// (not just away from the underline) actually close it.
const POPOVER_PAD = 4
// Small grace period after the cursor leaves the hit zone before actually
// hiding — absorbs the kind of momentary jitter that'd otherwise make the
// tooltip flicker in and out near the boundary, and bridges the small gap
// between the underline and the popover's top edge.
const LEAVE_GRACE_MS = 200

let pollTimer: ReturnType<typeof setInterval> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let hoveredKey: string | null = null
// While a widget drag is in progress the cursor moves freely around the
// whole screen, well outside the widget's own (small, or not-yet-updated)
// hit-test rect — normal poll-based hit-testing would toggle click-through
// back on mid-drag and drop the rest of the drag on the floor. Forcing
// capture for the drag's duration keeps mouse events flowing to the
// renderer regardless of what the poll loop would otherwise decide.
let dragActive = false

function setCaptureMouseEvents(capture: boolean): void {
  setOverlayMouseEventsCaptured(capture)
}

export function setDragActive(active: boolean): void {
  dragActive = active
  setCaptureMouseEvents(active)
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
  const hadHover = hoveredKey !== null
  hoveredKey = null
  setCaptureMouseEvents(false)
  if (hadHover) sendHover(null)
}

function within(point: { x: number; y: number }, rect: ScreenRect, pad: number): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  )
}

function poll(): void {
  // The overlay is at the screen-saver always-on-top level, above every
  // other Tracely window. Whichever one owns focus, release native capture so
  // a stale Screen Watch target can never turn transparent pixels into a
  // click shield over its controls — and, for Tracer, so the frozen
  // underlines behind it aren't hit-tested while the user is typing a
  // question about them (Screen Watch itself is frozen in that situation by
  // the "self" skip in screenWatchService.tick).
  //
  // One rule rather than a branch per window: Tracer used to be checked
  // separately *below* the dragActive early-return, so a widget drag
  // interrupted by Tracer taking focus kept native capture until some later
  // drag ended. Clearing dragActive uniformly closes that.
  if (focusedShieldableWindow() !== null) {
    dragActive = false
    clearHover()
    return
  }

  if (dragActive) return

  const targets = getHoverTargets()
  if (targets.length === 0) {
    clearHover()
    return
  }

  const cursor = screen.getCursorScreenPoint()

  // Tracer stays open and unfocused while the user goes back to writing, and
  // the overlay stays visible over it — so unlike main and floating it can't
  // be protected by hiding the overlay, and focus alone doesn't cover the
  // case where the overlay has been re-raised above it. Never capture over
  // its rect. See isPointOverOpenTracer for why that ordering is reachable.
  if (isPointOverOpenTracer(cursor)) {
    clearHover()
    return
  }

  const activeClaimId = hoveredKey?.split(':')[0] ?? null

  // If a claim is already hovered, first check whether the cursor is still
  // on its underline OR inside its actually-open popover's real rect. If
  // so, nothing to do — stay hovered, no new event needed.
  if (activeClaimId) {
    const activeTarget = targets.find((t) => t.claimId === activeClaimId)
    if (activeTarget) {
      const pad = activeTarget.kind === 'widget' ? (activeTarget.capturePadding ?? WIDGET_PAD) : PAD_SIDE
      const onUnderline = activeTarget.rectsAbsolute.some((r) => within(cursor, r, pad))
      const popover = getActivePopoverRect()
      const inPopover =
        popover.claimId === activeClaimId &&
        popover.rectAbsolute !== null &&
        within(cursor, popover.rectAbsolute, POPOVER_PAD)
      if (onUnderline || inPopover) {
        if (leaveTimer) {
          clearTimeout(leaveTimer)
          leaveTimer = null
        }
        return
      }
    }
  }

  // Otherwise, look for any target the cursor newly touches — always a
  // tight pad, every target, so hovering never sloppily jumps from one
  // flagged word straight into a neighboring one.
  let match: (typeof targets)[number] | null = null
  let matchedRectIndex = 0
  for (const t of targets) {
    const widgetPad = t.capturePadding ?? WIDGET_PAD
    const padSide = t.kind === 'widget' ? widgetPad : PAD_SIDE
    const padTop = t.kind === 'widget' ? widgetPad : PAD_TOP
    const padBottom = t.kind === 'widget' ? widgetPad : PAD_BOTTOM
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
