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

// -- resizing like an ordinary window ----------------------------------------
//
// Everything above this line describes the window as it WAS: one layout box at
// a fixed aspect ratio, with a CSS `zoom` absorbing the difference so the whole
// UI grew and shrank as one piece. The reasoning is left in place because it is
// still true about the Home screen, and because it explains most of this file.
//
// It is no longer how the window resizes. Owner's call, 2026-08-18, after
// three rounds on it: "make it so the app doesn't get bigger as a whole, I can
// kind of resize it normally like any other app".
//
// What scaling cost, in the end:
//
//   * Nothing could use viewport units. `100vh` resolves against the UNZOOMED
//     viewport while `zoom` multiplies what is rendered, so every `vh` in the
//     stylesheet was wrong by the zoom factor. `.app-shell` divided by it and
//     was correct; `.argscore-card`'s `max-height: calc(100vh - 140px)` did not
//     and was allowed to be 1.9x the window's height on a large window — which
//     is the report clipped at the top AND bottom in the screenshot, with the
//     header scrolled off the screen entirely.
//   * Every measurement needed a conversion. `getBoundingClientRect` is
//     post-zoom, `clientHeight` and `scrollTop` are not; `shared/zoomLayout.ts`
//     exists solely to convert between them, and hover, mark placement and
//     popover positioning each broke on it at least once.
//   * Making the window bigger made the TEXT bigger, which is not what anyone
//     means by resizing a window. More room was never available at any size.
//
// So the zoom is the font-size setting again — a deliberate user choice, and
// the only thing it was ever for — and the window is free. Views reflow into
// the space. Home is the one screen that cannot (its 16 elements sit at literal
// Figma coordinates), so its card keeps its design size and centres, which is
// what a floating card in a transparent window should do anyway.

/**
 * The smallest the window may be dragged.
 *
 * Not the layout size. The card is 870x606 and it no longer has to fit: the
 * editor, Settings and the modals all reflow, and Home's card simply overflows
 * its (scrollable) container below this. What this protects is the point where
 * the toolbar's own controls start colliding, which is a genuinely unusable
 * window rather than a cramped one.
 */
export const MIN_WINDOW_WIDTH = 680
export const MIN_WINDOW_HEIGHT = 480

/**
 * A dragged size, held inside the display and above the usable minimum.
 *
 * Width and height are independent now — there is no ratio to convert through,
 * which is the whole point. The work-area bound stays for the reason it was
 * added: a window taller than the screen puts its own resize grips under the
 * taskbar, and this app has no title bar to drag it back by.
 */
export function clampWindowBounds(
  size: { width: number; height: number },
  workArea: { width: number; height: number },
  margin = WINDOW_EDGE_MARGIN
): { width: number; height: number } {
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, workArea.width - margin * 2)
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, workArea.height - margin * 2)
  return {
    width: Math.round(Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, size.width))),
    height: Math.round(Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, size.height)))
  }
}

/** The size "maximize" should use: the work area, less the grip margin. */
export function maximizedBounds(
  workArea: { width: number; height: number },
  margin = WINDOW_EDGE_MARGIN
): { width: number; height: number } {
  return clampWindowBounds(
    { width: workArea.width - margin * 2, height: workArea.height - margin * 2 },
    workArea,
    margin
  )
}

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

/**
 * RETIRED as a cap on maximize, and kept only because `src/shared/*` is
 * additive (see the branch rules in CLAUDE.md).
 *
 * The argument for it was that this window scales rather than reflows, so a
 * maximize that filled a 4K display would mean 28px body text and a 62px
 * heading — "more comfortable, not enormous". It is a real effect and the
 * reasoning is preserved here rather than deleted.
 *
 * It was wrong about whose call it is. On a 2560x1392 work area the screen
 * allows 2.12 and this held maximize to 1.6 — the button used 75% of the
 * height available and looked, correctly, like it barely did anything. A user
 * pressing maximize has said what size they want; second-guessing it with a
 * taste threshold makes the control feel broken, and the drag handles were
 * already free to go past this anyway, so the two disagreed about the same
 * question. Owner's call, 2026-08-18, second time raised.
 *
 * Nothing reads it now. MIN_WINDOW_SCALE and MAX_WINDOW_SCALE remain the real
 * bounds, and `fitToWorkAreaScale` keeps the window on the display.
 */
export const MAX_COMFORTABLE_SCALE = 1.6

/**
 * The scale maximize should use on a display of this size.
 *
 * `margin` keeps the window off the very edges of the work area, so the
 * resize grips stay grabbable after maximizing — a window flush to every edge
 * has no outside left to grab, and this app has no title bar to drag either.
 */
/**
 * Kept off the very edges of the work area, so the resize grips stay grabbable.
 *
 * A window flush to every edge has no outside left to grab, and this app has no
 * title bar to drag either — the grips ARE the only way to change its size, so
 * a size that puts them under the taskbar is a size the user cannot undo.
 */
export const WINDOW_EDGE_MARGIN = 24

/**
 * The largest scale that actually fits on this display.
 *
 * Both axes, and that is the whole point. The aspect ratio is locked, so a
 * window sized from the WIDTH alone can be arbitrarily taller than the screen:
 * at MAX_WINDOW_SCALE on a 2560x1392 work area the window is 2245x1585 — 193px
 * of it below the bottom of the display, which on this layout is the footer of
 * every view and the lower half of any open popover. That is the "the overlay
 * cuts out when you resize the app too big" report, and it is not a rendering
 * bug: the pixels are drawn correctly, off-screen.
 *
 * Deliberately NOT capped by MAX_COMFORTABLE_SCALE — see maximizedScale, which
 * applies that cap on top of this. A drag is the user explicitly asking for a
 * size; maximize is the app choosing one for them, and only the second should
 * be second-guessed about comfort.
 */
export function fitToWorkAreaScale(
  workArea: { width: number; height: number },
  margin = WINDOW_EDGE_MARGIN
): number {
  const byWidth = (workArea.width - margin * 2) / LAYOUT_WIDTH
  const byHeight = (workArea.height - margin * 2) / LAYOUT_HEIGHT
  return Math.min(byWidth, byHeight)
}

/**
 * The scale a DRAG may reach on this display: never past the screen edge, never
 * past MAX_WINDOW_SCALE, never below the readable floor.
 *
 * The floor wins over the fit. On a display too small to hold even
 * MIN_WINDOW_SCALE something has to overflow, and overflowing the screen edge
 * is recoverable — the window can be moved — while shrinking below 0.7 makes
 * the 11px labels in Settings unreadable, which is not.
 */
export function clampDragScale(
  scale: number,
  workArea: { width: number; height: number },
  margin = WINDOW_EDGE_MARGIN
): number {
  const fits = fitToWorkAreaScale(workArea, margin)
  const ceiling = Math.max(MIN_WINDOW_SCALE, Math.min(MAX_WINDOW_SCALE, fits))
  return Math.min(ceiling, clampWindowScale(scale))
}

export function maximizedScale(
  workArea: { width: number; height: number },
  margin = WINDOW_EDGE_MARGIN
): number {
  return clampWindowScale(fitToWorkAreaScale(workArea, margin))
}

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

/**
 * The height of the invisible caption strip at the top of the main window.
 *
 * The window has `titleBarStyle: 'hidden'` with a transparent `titleBarOverlay`
 * — no title bar is drawn, but Windows still renders and hit-tests the real
 * minimize / maximize / close buttons inside a band this tall at the top-right.
 * Main passes it to `titleBarOverlay.height`; `--titlebar-h` in index.css
 * mirrors it, and `.app-dragbar` is the strip that makes the rest of that band
 * draggable, since a hidden title bar has no caption area to grab.
 *
 * 34px because that is roughly Windows' own caption height: shorter and the
 * glyphs are cramped against the top edge, taller and the strip starts eating
 * into content.
 */
export const TITLEBAR_HEIGHT = 34

/**
 * How much of the top-right corner those three buttons occupy.
 *
 * Windows draws them ~46px wide each at 100% scale. Views with content along
 * the top edge subtract this (`--winctl-reserve`) so nothing renders underneath
 * them — which the document editor's toolbar did the last time the buttons
 * lived over the page, putting the close button on top of "AI Insights".
 */
export const WINDOW_CONTROLS_WIDTH = 138
