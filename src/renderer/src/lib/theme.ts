import { useEffect, useState } from 'react'
import type { Theme } from '@shared/types'

export function applyTheme(theme: Theme): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

/**
 * Whether dark is EFFECTIVELY active, by the same rules the stylesheet uses:
 * an explicit `data-theme='dark'` wins, an explicit `'light'` wins the other
 * way, and no attribute at all falls through to the OS preference — exactly
 * the pair of selectors index.css pins its dark tokens to
 * (`:root[data-theme='dark']` and the `prefers-color-scheme` media block
 * guarded by `:not([data-theme='light'])`).
 */
function effectiveDark(): boolean {
  const theme = document.documentElement.dataset.theme
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * React hook over `effectiveDark`, live on BOTH inputs: the OS preference
 * (matchMedia 'change') and the Settings toggle (a MutationObserver on
 * documentElement's data-theme, which is what `applyTheme` writes). Components
 * that paint with JS values rather than CSS vars — the inline-styled Essay
 * Grade report — need this to re-render when either changes.
 */
export function useEffectiveDark(): boolean {
  const [dark, setDark] = useState<boolean>(() => effectiveDark())

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setDark(effectiveDark())
    media.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])

  return dark
}
