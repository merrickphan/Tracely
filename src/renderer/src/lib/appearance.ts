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
}
