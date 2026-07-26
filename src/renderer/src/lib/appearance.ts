import type { AccentColor, Density } from '@shared/types'

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
