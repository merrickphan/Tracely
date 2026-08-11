/**
 * Widget panel geometry.
 *
 * Sizing lives in main rather than the renderer because hoverTracking.ts's
 * click-through hit-test region is derived from the same rect the panel is
 * drawn at — if the two disagreed, the panel would be visible in one place and
 * clickable in another. The renderer mirrors the GRID_* constants (see
 * OverlayApp.tsx) to lay content out inside the rect it is given; it never
 * computes the rect itself.
 *
 * A leaf module with no value imports, so `node --test` can load it. That is
 * also why the constants moved here out of screenWatchService.ts, which has
 * enough imports to be untestable.
 */

/** Collapsed launcher circle. */
export const WIDGET_SIZE = 56

/**
 * 'single' — one claim's action card. Fixed, because the card's own content is
 * fixed; only the claim inside it changes.
 */
export const SINGLE_PANEL_WIDTH = 400
export const SINGLE_PANEL_HEIGHT = 400

/**
 * 'all' — a single vertical column (not a grid) so each row has room to show
 * real article titles, not just a count. Sized per claim count so a normal
 * number fits with no scrolling; capped for the rare case of many at once,
 * since letting the panel grow past the screen would just reintroduce
 * clipping. Mirrored client-side in OverlayApp.tsx — keep in sync.
 */
export const GRID_CARD_WIDTH = 364
export const GRID_CARD_HEIGHT = 108
export const GRID_GAP = 10
export const GRID_HEADER_HEIGHT = 44
export const GRID_PADDING = 18
export const MAX_LIST_PANEL_HEIGHT = 560

/**
 * Every panel mode is this wide.
 *
 * Not a coincidence worth preserving by accident: the panel is anchored to the
 * watched window's bottom-right corner, so a mode with a different width would
 * make the whole panel jump sideways when the user switches views. There is a
 * test asserting all three agree.
 */
export const PANEL_WIDTH = GRID_PADDING * 2 + GRID_CARD_WIDTH

export function computeAllPanelSize(claimCount: number): { width: number; height: number } {
  const count = Math.max(1, claimCount)
  const naturalHeight =
    GRID_PADDING * 2 + GRID_HEADER_HEIGHT + count * GRID_CARD_HEIGHT + (count - 1) * GRID_GAP
  return { width: PANEL_WIDTH, height: Math.min(naturalHeight, MAX_LIST_PANEL_HEIGHT) }
}

// Row heights for the structure view, measured against the rendered layout in
// OverlayApp.tsx. These only need to be close: the body scrolls, so being a few
// pixels out costs a scrollbar rather than clipped content — unlike 'all',
// where the panel is sized to fit exactly and overflow is hidden.
const STRUCTURE_SCORE_BLOCK = 96
const STRUCTURE_RUBRIC_BLOCK = 6 * 22 + 12
const STRUCTURE_SECTION_HEADING = 26
const STRUCTURE_WEAKNESS_ROW = 62
const STRUCTURE_PARAGRAPH_ROW = 30
const STRUCTURE_FOOTER = 34

/**
 * Rows past these counts are reached by scrolling rather than by growing the
 * panel. Paragraph count is unbounded, and MAX_LIST_PANEL_HEIGHT binds on any
 * real essay anyway — asking for 900px only to be clamped to 560 wastes the
 * request and makes the height meaningless.
 */
const STRUCTURE_MAX_WEAKNESS_ROWS = 4
const STRUCTURE_MAX_PARAGRAPH_ROWS = 8

export function computeStructurePanelSize({
  weaknessCount,
  paragraphCount
}: {
  weaknessCount: number
  paragraphCount: number
}): { width: number; height: number } {
  const weaknessRows = Math.min(weaknessCount, STRUCTURE_MAX_WEAKNESS_ROWS)
  const paragraphRows = Math.min(paragraphCount, STRUCTURE_MAX_PARAGRAPH_ROWS)

  const natural =
    GRID_PADDING * 2 +
    GRID_HEADER_HEIGHT +
    STRUCTURE_SCORE_BLOCK +
    STRUCTURE_RUBRIC_BLOCK +
    (weaknessRows > 0 ? STRUCTURE_SECTION_HEADING + weaknessRows * STRUCTURE_WEAKNESS_ROW : 0) +
    (paragraphRows > 0 ? STRUCTURE_SECTION_HEADING + paragraphRows * STRUCTURE_PARAGRAPH_ROW : 0) +
    STRUCTURE_FOOTER

  return { width: PANEL_WIDTH, height: Math.min(natural, MAX_LIST_PANEL_HEIGHT) }
}
