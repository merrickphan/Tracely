import { getFloatingWindow } from './floatingWindow'
import { getMainWindow } from './mainWindow'
import { getTracerWindow, isTracerWindowFocused } from './tracerWindow'

// The Screen Watch overlay sits at the 'screen-saver' always-on-top level
// (overlayWindow.ts) — above every other Tracely window — and flips itself
// click-capturing (setIgnoreMouseEvents(false)) whenever hoverTracking finds
// a target under the cursor. Any focusable Tracely surface underneath can
// therefore be shielded by transparent pixels: the click lands on the
// overlay, the window below never sees it, and nothing repairs that until
// the next UIA poll notices Tracely is foreground.
//
// The main window and the floating claim checker each shipped that bug and
// each got their own guard. This module exists so the third window (Tracer)
// and any fourth don't have to rediscover it — the rule lives in one place
// instead of being a list remembered at every call site.
//
// It deliberately sits beside the window modules rather than inside
// overlayWindow.ts: mainWindow.ts and floatingWindow.ts already import
// hideOverlay from there, so importing them back would be a cycle.

export type ShieldableWindow = 'main' | 'floating' | 'tracer'

/**
 * Which Tracely window, if any, currently owns OS focus and could be sitting
 * under the overlay.
 *
 * Callers that can respond by hiding the overlay outright (main, floating)
 * should treat any non-null result as "release capture". Callers that must
 * keep the overlay visible have to discriminate — see the Tracer note in
 * `updateOverlayAndWidget`.
 */
export function focusedShieldableWindow(): ShieldableWindow | null {
  const main = getMainWindow()
  if (main && !main.isDestroyed() && main.isFocused()) return 'main'

  const floating = getFloatingWindow()
  if (floating && !floating.isDestroyed() && floating.isFocused()) return 'floating'

  if (isTracerWindowFocused()) return 'tracer'

  return null
}

/**
 * Whether a screen point falls inside the Tracer window while it is open.
 *
 * Tracer is the one shieldable window the overlay is expected to stay
 * *visible* underneath, so "hide the overlay on focus" — the fix that works
 * for main and floating — is not available: Screen Watch deliberately holds
 * its claims and underlines while the user talks to Tracer about them.
 *
 * Focus alone doesn't protect it either. `showOverlayOnWindow` calls
 * `showInactive()` on a hidden overlay, which re-raises it above Tracer at
 * the same 'screen-saver' level; from then on the overlay wins clicks over
 * Tracer's rect, so Tracer never receives one, never regains focus, and the
 * shield never lifts. Excluding its rect from hit-testing makes that
 * unreachable regardless of z-order, and costs nothing real — a popover
 * opened there would be drawn behind Tracer anyway.
 *
 * `getBounds()` and `screen.getCursorScreenPoint()` are both logical (DIP)
 * screen coordinates, the same space as `HoverTarget.rectsAbsolute`, so no
 * scale conversion is needed here.
 */
export function isPointOverOpenTracer(point: { x: number; y: number }): boolean {
  const win = getTracerWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return false

  const b = win.getBounds()
  return (
    point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height
  )
}
