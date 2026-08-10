import type { AccentColor, Density, FontSize } from '@shared/types'

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

const FONT_SCALE: Record<FontSize, string> = {
  small: '0.92',
  medium: '1',
  large: '1.12'
}

// index.css is written in absolute px throughout, so there is no root em for
// a font-size change to cascade from — setting `html { font-size }` would do
// nothing. Chromium's `zoom` on the root element rescales the whole box tree
// proportionally, which keeps every panel's proportions intact instead of
// requiring every size in the sheet to be rewritten as rem.
export function applyFontSize(size: FontSize): void {
  document.documentElement.style.zoom = FONT_SCALE[size]
  // `zoom` scales rendered lengths, but `100vw`/`100vh` keep resolving against
  // the unzoomed viewport — so the shell rendered 12% larger than the window at
  // `large` and was clipped, and 8% smaller at `small`, leaving a transparent
  // strip. index.css divides the viewport units by this, which makes the shell
  // fill the window exactly at every setting.
  //
  // Set here rather than in the stylesheet so it cannot drift from the `zoom`
  // value it has to cancel out. The window itself is resized to match, main-side
  // — see shared/windowSize.ts.
  document.documentElement.style.setProperty('--app-zoom', FONT_SCALE[size])
}
