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
// The zoom is derived from the WINDOW WIDTH now, not from the font-size
// setting, and that is the change that let the window become resizable. Both
// controls do the same thing to this UI — scale it — so a second source for one
// number is how they came to disagree once already: the note at the top of
// shared/windowSize.ts is that bug, and its symptom was the login screen
// rendering off the bottom of the window. Font size moves the WINDOW now,
// main-side, and this follows it.
function applyZoom(): void {
  const zoom = String(zoomForWindowWidth(window.innerWidth))
  document.documentElement.style.zoom = zoom
  // `zoom` scales rendered lengths, but `100vw`/`100vh` keep resolving against
  // the unzoomed viewport — so the shell rendered 12% larger than the window at
  // `large` and was clipped, and 8% smaller at `small`, leaving a transparent
  // strip. index.css divides the viewport units by this, which makes the shell
  // fill the window exactly. Set here rather than in the stylesheet so it cannot
  // drift from the `zoom` value it has to cancel out.
  document.documentElement.style.setProperty('--app-zoom', zoom)
}

/**
 * Keeps the zoom in step with the window for as long as the app is running.
 *
 * A `resize` listener rather than a one-shot: this is what makes dragging the
 * window edge scale the card live rather than on the next reload.
 *
 * Not debounced. The handler is two style writes, Chromium already coalesces
 * `resize` to one per frame, and a debounce would only add lag to the thing the
 * user is actively dragging.
 *
 * Returns its own teardown so a caller can be a well-behaved effect.
 */
export function trackWindowZoom(): () => void {
  applyZoom()
  window.addEventListener('resize', applyZoom)
  return () => window.removeEventListener('resize', applyZoom)
}

/**
 * The renderer-side entry point for the font-size setting.
 *
 * The real work is main-side now — the setting resizes the WINDOW, and the
 * resize listener above picks the new width up. This recomputes immediately so
 * the two call sites (App on boot, SettingsView on change) still do something
 * synchronous rather than appearing to be no-ops; setting a zoom from the font
 * scale here would fight the window that is about to change under it.
 */
export function applyFontSize(_size: FontSize): void {
  applyZoom()
}
