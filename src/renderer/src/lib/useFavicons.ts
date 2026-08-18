import { useEffect, useState } from 'react'
import { tracelyApi } from './api'

/**
 * Real site icons for a list of source URLs, resolving in the background.
 *
 * Returns a map from URL to data: URI. A URL that is absent, or present with a
 * `null`, means "draw the monogram" — the caller must never wait on this or
 * hide a row for it. The icon is decoration on a row whose text is already
 * correct, so the row renders immediately with its fallback and the image
 * swaps in when it arrives; a spinner or a reserved blank would make a list of
 * sources look broken for the second it takes a favicon service to answer.
 *
 * Module-level cache, deliberately outside React. Several surfaces show the
 * same sources — the report's evidence list, the citation picker, the library —
 * and a per-component `useState` would re-ask on every mount and re-flash the
 * monogram each time the report is reopened. Main caches by hostname too, so
 * the duplicate would not cost a network request; it would cost the visible
 * flicker, which is the part worth avoiding.
 *
 * Never evicted. It is one small data URI per distinct publisher domain in a
 * session — the same trade main/services/search/favicon.ts already makes, and
 * the numbers are per-session tens, not thousands.
 */
const CACHE = new Map<string, string | null>()

/** URLs already requested, so two lists mounting together ask once. */
const IN_FLIGHT = new Set<string>()

export function useFavicons(urls: Array<string | null | undefined>): Map<string, string | null> {
  // `useState` of a version counter rather than of the map: the map IS the
  // module cache, and copying it into state per hook instance is what would
  // reintroduce the duplication this exists to avoid.
  const [, bump] = useState(0)

  // The join is the dependency, not the array — a fresh array literal every
  // render (which is what every call site passes) would re-run this effect on
  // every keystroke in the editor.
  const key = urls.filter((url): url is string => !!url).sort().join('|')

  useEffect(() => {
    const wanted = key.length > 0 ? key.split('|') : []
    const missing = wanted.filter((url) => !CACHE.has(url) && !IN_FLIGHT.has(url))
    if (missing.length === 0) return

    for (const url of missing) IN_FLIGHT.add(url)

    let live = true
    void tracelyApi
      .sourceFavicons(missing)
      .then((icons) => {
        for (const url of missing) {
          // A URL the response never mentions is recorded as null rather than
          // left absent, so it is not asked for again on the next render. Over
          // the batch cap and "the lookup failed" are the same outcome here:
          // draw the monogram, do not retry in a loop.
          CACHE.set(url, icons[url] ?? null)
        }
        if (live) bump((n) => n + 1)
      })
      .catch(() => {
        for (const url of missing) CACHE.set(url, null)
        if (live) bump((n) => n + 1)
      })
      .finally(() => {
        for (const url of missing) IN_FLIGHT.delete(url)
      })

    return () => {
      live = false
    }
  }, [key])

  return CACHE
}
