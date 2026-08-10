import type { FontSize } from './types'

// The main window's geometry, in one place because two processes need to agree
// on it: the renderer lays the card out in literal Figma pixels, and the main
// process has to give it a window those pixels fit inside.
//
// They did not agree before. Settings > Appearance > Font size sets `zoom` on
// the document root, which scales every rendered length — but the window stayed
// 870x606. Measured in the preview harness at the real geometry:
//
//     zoom 1.12  ->  shell renders 974x679  ->  104px past the right edge, 73px past the bottom
//     zoom 0.92  ->  shell renders 800x558  ->  a 70px transparent strip right, 48px bottom
//
// The window is `resizable: false`, so nothing corrected for it. That is the
// "login screen is off the main screen" bug, and it applies to every view.
//
// Making the *window* scale with the zoom factor is the only fix that actually
// works: "render everything 12% bigger" inside a fixed-size window must either
// clip or overflow. The CSS side is in index.css's `.app-shell` rule, which
// divides 100vw/100vh by the same factor so the shell fills the window exactly.

/** The Figma frame the main window's layout is transcribed from. */
export const MAIN_CARD_WIDTH = 870
export const MAIN_CARD_HEIGHT = 606

// Gutter between the card and the window edge. The card draws a
// `-13px 13px` drop shadow, which previously fell entirely outside an
// 870-wide window inside an 870-wide card and so never rendered at all.
export const MAIN_WINDOW_MARGIN = 14

/**
 * Must stay in step with FONT_SCALE in renderer/src/lib/appearance.ts — that
 * one sets the CSS `zoom`, this one sizes the window it has to fit in. They are
 * separate because shared/ is imported by all three processes and pulling a DOM
 * helper in here would be worse than the duplication.
 */
export const WINDOW_FONT_SCALE: Record<FontSize, number> = {
  small: 0.92,
  medium: 1,
  large: 1.12
}

export function mainWindowSize(fontSize: FontSize): { width: number; height: number } {
  const scale = WINDOW_FONT_SCALE[fontSize] ?? 1
  return {
    width: Math.round((MAIN_CARD_WIDTH + MAIN_WINDOW_MARGIN * 2) * scale),
    height: Math.round((MAIN_CARD_HEIGHT + MAIN_WINDOW_MARGIN * 2) * scale)
  }
}
