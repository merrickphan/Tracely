/**
 * How a flagged span is drawn and how it moves — shared by the two surfaces
 * that draw one.
 *
 * The Screen Watch overlay (`OverlayApp.tsx`) and the document editor
 * (`DocumentMarkLayer.tsx`) both put a highlighter band and a coloured line
 * over a sentence, and until now only the overlay did it properly: the editor
 * drew a flat 12%-alpha box with no band, no entrance and no motion, so the
 * same problem on the same sentence looked like two different products
 * depending on which window it was in.
 *
 * Following the rule the rest of this codebase already uses for the popover
 * (`citationFlowCopy.ts`, `problemCopy.ts`): **the values and the decisions are
 * shared, the markup is not.** The overlay is inline styles in a window that
 * loads no stylesheet; the editor is `.docmark-*` classes from index.css.
 * Sharing a component between them would mean one of the two surfaces
 * rendering in a way it cannot support. Sharing the numbers means they cannot
 * silently disagree about what a hovered mark looks like.
 *
 * Every constant here was measured on the overlay first and is carried across
 * rather than re-picked, so a change to one surface is a change to both.
 */

/**
 * Opacity of the highlighter band under the pointer.
 *
 * 0.30 is not a taste call. On the overlay this started at 0.16, which
 * composited to roughly rgb(253,236,222) over white — invisible next to black
 * body text. Past about 0.35 the band starts fighting the text for contrast.
 * The band must stay translucent on both surfaces for the same reason: over
 * another app the overlay window sits on top of the words, and in the editor
 * the mark layer sits on top of the contentEditable. Anything opaque hides the
 * text it is meant to be drawing attention to.
 */
export const BAND_ALPHA = 0.3

/** The band, resting. Zero — it fades in on hover and is not drawn otherwise. */
export const BAND_ALPHA_RESTING = 0

/**
 * How much the band is squashed before it grows into place.
 *
 * Anchored at the bottom (`transform-origin: bottom`), so it reads as a
 * highlighter stroke swelling up off the line rather than as a box fading in.
 */
export const BAND_SCALE_RESTING = 0.72

/** The band extends 2px above the glyph box and 3px below it. A band clipped
 *  exactly to the text reads as a background colour change; a little air reads
 *  as a pen stroke. */
export const BAND_INSET_TOP = 2
export const BAND_INSET_BOTTOM = 3
export const BAND_RADIUS = 3

/** The line itself: 2px resting, 3px hovered, 1px radius. A 2px radius on a
 *  2px bar rounds it into a capsule and washes the colour out. */
export const LINE_HEIGHT = 2
export const LINE_HEIGHT_HOVERED = 3
export const LINE_RADIUS = 1

/** Room left under the text so the line clears descenders (g, y, p). */
export const DESCENDER_ROOM = 4

/** Band and line transitions. Fast enough that the band is up before the
 *  popover it accompanies has finished measuring. */
export const BAND_TRANSITION =
  'opacity 110ms ease, transform 110ms cubic-bezier(0.22, 1, 0.36, 1)'
export const LINE_TRANSITION = 'height 110ms ease'
export const MOVE_TRANSITION =
  'transform 150ms cubic-bezier(0.22, 1, 0.36, 1), width 150ms cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * Past this far, a mark cuts to its new position instead of gliding there.
 *
 * Marks shift by a few pixels constantly — typing, reflow, a font load — and
 * gliding those looks intentional. But a scroll (overlay) or an inserted
 * paragraph (editor) moves the same rect hundreds of pixels, and animating that
 * sends the underline swooping diagonally across unrelated text on its way.
 *
 * Asymmetric on purpose: horizontal reflow within a line is ordinary and gets a
 * generous allowance, while vertical movement past about one line height means
 * the text moved rather than rewrapped.
 */
export const JUMP_X = 40
export const JUMP_Y = 24

/**
 * Whether this mark moved far enough to cut rather than glide.
 *
 * `prev` is null on the first render, which counts as a jump — a mark must
 * appear where it belongs rather than sliding in from the origin.
 */
export function hasJumped(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number }
): boolean {
  if (prev === null) return true
  return Math.abs(next.x - prev.x) > JUMP_X || Math.abs(next.y - prev.y) > JUMP_Y
}

/** `#rrggbb` at the given alpha, for the band. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** The band's colour at rest and hovered, so neither surface picks its own. */
export function bandBackground(color: string, hovered: boolean): string {
  return withAlpha(color, hovered ? BAND_ALPHA : BAND_ALPHA_RESTING)
}
