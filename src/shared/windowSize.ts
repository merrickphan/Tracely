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
  return sizeForScale(WINDOW_FONT_SCALE[fontSize] ?? 1)
}

// -- user resizing -----------------------------------------------------------
//
// The window is resizable, and it resizes by SCALING rather than by reflowing.
//
// That is forced by the layout, not chosen for ease. Home is a transcription of
// a Figma frame: `.home-canvas` fills the window but its `.home-el` children are
// `position: absolute` at literal design coordinates. Widen the window and they
// do not spread out, they sit exactly where they were with empty space beside
// them. Making them reflow means re-authoring the frame as a responsive layout
// and losing the property the whole UI is built on — that the app IS the Figma
// frame. See index.css's `.home-canvas` and `.app-shell`.
//
// So the layout box stays LAYOUT_WIDTH x LAYOUT_HEIGHT design units at every
// size, and the zoom factor absorbs the difference. Every view scales as one
// piece, which is also the only behaviour that keeps a fixed-coordinate design
// correct at an arbitrary size.
//
// The aspect ratio is locked main-side for the same reason: the layout box has
// one shape, and a window of a different shape could only letterbox it or clip
// it. With the ratio held, deriving the zoom from the WIDTH alone is exact.

/** The window's size in design units — what the renderer lays out inside. */
export const LAYOUT_WIDTH = MAIN_CARD_WIDTH + MAIN_WINDOW_MARGIN * 2
export const LAYOUT_HEIGHT = MAIN_CARD_HEIGHT + MAIN_WINDOW_MARGIN * 2

export const MAIN_WINDOW_ASPECT = LAYOUT_WIDTH / LAYOUT_HEIGHT

/**
 * How far the window may be scaled.
 *
 * The floor is not taste: index.css is written in absolute px, so scaling down
 * shrinks type with everything else, and below ~0.7 the 11px labels in Settings
 * and the evidence cards stop being readable. The ceiling is generous because
 * the cost of a too-large window is only wasted space, and a 4K display makes
 * the default look like a postage stamp.
 *
 * `small` (0.92) sits inside this range, so the font-size setting cannot put
 * the window somewhere the user is then unable to drag it back from.
 */
export const MIN_WINDOW_SCALE = 0.7
export const MAX_WINDOW_SCALE = 2.5

export function sizeForScale(scale: number): { width: number; height: number } {
  const clamped = clampWindowScale(scale)
  return {
    width: Math.round(LAYOUT_WIDTH * clamped),
    height: Math.round(LAYOUT_HEIGHT * clamped)
  }
}

export function clampWindowScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return Math.min(MAX_WINDOW_SCALE, Math.max(MIN_WINDOW_SCALE, scale))
}

/**
 * The zoom the renderer must apply, given the window's actual width.
 *
 * This replaces reading the font-size setting directly. The two are not
 * independent — the font size resizes the WINDOW (mainWindowSize above), and the
 * zoom then follows from the width — so deriving it here is what makes it
 * impossible for the zoom and the window to disagree. They did disagree once,
 * and the symptom was the login screen rendering off the bottom of the window;
 * the note at the top of this file is that bug.
 */
export function zoomForWindowWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  return width / LAYOUT_WIDTH
}
