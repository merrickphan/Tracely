import type { AccentColor, Density, FontSize } from '@shared/types'
import { zoomForWindowWidth } from '@shared/windowSize'

export function applyAccentColor(accent: AccentColor): void {
  if (accent === 'orange') {
    // 'orange' is the base palette — no override needed, and removing the
    // attribute (rather than setting data-accent="orange") keeps the DOM
    // clean for the common/default case.
    document.documentElement.removeAttribute('data-accent')
  } else {
    document.documentElement.setAttribute('data-accent', accent)
  }
}

export function applyDensity(density: Density): void {
  document.body.classList.toggle('density-compact', density === 'compact')
}

// index.css is written in absolute px throughout, so there is no root em for
// a font-size change to cascade from — setting `html { font-size }` would do
// nothing. Chromium's `zoom` on the root element rescales the whole box tree
// proportionally, which keeps every panel's proportions intact instead of
// requiring every size in the sheet to be rewritten as rem.
//
// The zoom is the FONT-SIZE SETTING again, and nothing else.
//
// It was derived from the window width for a while, so that dragging the window
// scaled the whole UI. That is what made the window resizable at all, and it is
// what has now been removed — see the long note in shared/windowSize.ts. The
// short version: a zoomed root makes every `vh` in the stylesheet wrong by the
// zoom factor (the report modal was allowed to be 1.9x the window's height and
// clipped at both ends), it makes every measured rect need a conversion, and
// "bigger window" meant "bigger text" rather than "more room", which is not
// what resizing a window means anywhere else.
//
// So this is a user preference with three values, applied once, and the window
// is free to be any size independently of it.
const FONT_SCALE: Record<FontSize, number> = {
  small: 0.92,
  medium: 1,
  large: 1.12
}

function applyZoom(scale: number): void {
  const zoom = String(scale)
  document.documentElement.style.zoom = zoom
  // Still published, and still load-bearing. `zoom` scales rendered lengths
  // while `100vw`/`100vh` keep resolving against the unzoomed viewport, so
  // anything in the sheet using viewport units has to divide by this or it is
  // wrong by the font scale. That is a factor of at most 1.12 now rather than
  // 2.5, but wrong is wrong — see `.app-shell` and `.argscore-card`.
  document.documentElement.style.setProperty('--app-zoom', zoom)
}

/**
 * The renderer-side entry point for the font-size setting.
 *
 * Synchronous and complete: this is the only thing that sets the zoom now, so
 * there is no window resize to race with and no second source for the number.
 */
export function applyFontSize(size: FontSize): void {
  applyZoom(FONT_SCALE[size] ?? 1)
}

/**
 * Retained so `App.tsx` keeps a single teardown-returning call, and because
 * removing an exported function from a module several views import is a bigger
 * change than this one needs to be.
 *
 * It no longer listens for anything. Resizing the window does not change the
 * zoom — that is the entire point of the change — so a `resize` handler here
 * would be a listener that recomputes a constant on every frame of a drag.
 */
export function trackWindowZoom(): () => void {
  return () => {}
}
