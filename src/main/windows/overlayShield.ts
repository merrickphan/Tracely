import { getFloatingWindow } from './floatingWindow'
import { getMainWindow } from './mainWindow'

// The Screen Watch overlay sits at the 'screen-saver' always-on-top level
// (overlayWindow.ts) — above every other Tracely window — and flips itself
// click-capturing (setIgnoreMouseEvents(false)) whenever hoverTracking finds
// a target under the cursor. Any focusable Tracely surface underneath can
// therefore be shielded by transparent pixels: the click lands on the
// overlay, the window below never sees it, and nothing repairs that until
// the next UIA poll notices Tracely is foreground.
//
// The main window and the floating claim checker each shipped that bug and
// each got their own guard. This module exists so a third focusable window
// doesn't have to rediscover it — the rule lives in one place instead of
// being a list remembered at every call site. (It had a third member, the
// Tracer chat window, until Tracer was removed; the shape stayed because the
// next focusable window will need exactly this.)
//
// It deliberately sits beside the window modules rather than inside
// overlayWindow.ts: mainWindow.ts and floatingWindow.ts already import
// hideOverlay from there, so importing them back would be a cycle.

export type ShieldableWindow = 'main' | 'floating'

/**
 * Which Tracely window, if any, currently owns OS focus and could be sitting
 * under the overlay. Any non-null result means "release capture".
 */
export function focusedShieldableWindow(): ShieldableWindow | null {
  const main = getMainWindow()
  if (main && !main.isDestroyed() && main.isFocused()) return 'main'

  const floating = getFloatingWindow()
  if (floating && !floating.isDestroyed() && floating.isFocused()) return 'floating'

  return null
}
