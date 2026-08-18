/**
 * Converting measured screen geometry into the coordinates the marks are drawn
 * in, when the document root carries a CSS `zoom`.
 *
 * The whole app is scaled by `document.documentElement.style.zoom`, set from
 * the window width so dragging the window edge rescales the UI
 * (`lib/appearance.ts`). That makes two coordinate systems, and the mark layers
 * were mixing them:
 *
 *   - `getBoundingClientRect()` returns POST-ZOOM pixels. Measured in the
 *     preview harness at zoom 1.3: an element with `clientWidth` 691 reports a
 *     rect width of 898, and a child 150 layout-px below its scroll container
 *     reports a delta of 195.
 *   - `scrollTop` / `scrollLeft` / `clientWidth` are LAYOUT pixels — 150 stays
 *     150 — and so are the `left`/`top`/`transform` values used to position a
 *     mark inside the zoomed subtree.
 *
 * So the old `rect.left - wrapRect.left + wrap.scrollLeft` added a post-zoom
 * delta to a layout-px scroll offset and then handed the total to CSS, which
 * scaled it by the zoom a second time. At zoom 1 every term is identical and
 * nothing is visibly wrong, which is why this survived: every test and every
 * screenshot was taken at the default window size. Resize the window and every
 * underline drifts, further the lower it sits on the page, until they read as
 * strikethroughs across the wrong lines.
 *
 * Pure arithmetic, kept out of `documentMarks.ts` so `npm test` can load it —
 * that module's `@shared/*` value imports are exactly what Node's type
 * stripping refuses to resolve.
 */

/** A zoom that cannot produce Infinity or flip the sign of an offset. */
export function safeZoom(zoom: number | null | undefined): number {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

/**
 * A distance measured from `getBoundingClientRect()`, in layout pixels.
 *
 * Use for widths, heights, and the gap between two measured rects.
 */
export function clientToLayout(clientDistance: number, zoom: number): number {
  return clientDistance / safeZoom(zoom)
}

/**
 * Where a measured point sits in the scroll container's content coordinates —
 * the space the mark layer positions things in.
 *
 * `clientDelta` is post-zoom (a difference of two `getBoundingClientRect`
 * values); `scroll` is layout px. The division has to happen BEFORE the scroll
 * offset is added, not after, or the scroll term is divided too and a scrolled
 * document puts every mark in the wrong place by a different amount than an
 * unscrolled one.
 */
export function contentOffset(clientDelta: number, scroll: number, zoom: number): number {
  return clientDelta / safeZoom(zoom) + scroll
}

/**
 * Reads the effective zoom off a document root.
 *
 * `getComputedStyle().zoom` is a string, is absent on browsers without the
 * property, and is the literal `'normal'` in some engines — all of which
 * resolve to 1 rather than to NaN, because a mark drawn at NaN is not drawn at
 * all and a silently unscaled mark is merely slightly wrong.
 */
// Structurally typed rather than in terms of `Element` / `Window`: this file is
// in `shared/` and is therefore compiled by tsconfig.node.json too, where the
// DOM lib is absent and naming those types is a build error.
export function readZoom<T>(
  view: { getComputedStyle: (el: T) => { zoom?: string } } | null | undefined,
  root: T | null | undefined
): number {
  if (!view || !root) return 1
  const raw = view.getComputedStyle(root).zoom
  if (!raw) return 1
  return safeZoom(parseFloat(raw))
}
