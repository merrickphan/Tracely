// Real per-source favicons for the Screen Watch overlay, in place of the
// plain provider-monogram badge — fetched here (main process) rather than
// loaded directly in the overlay renderer specifically so the result can be
// handed over as a data: URI. overlay.html's CSP is img-src 'self' data: —
// a data URI satisfies that with no CSP loosening, and it's also the only
// way to cache/dedupe across the many source rows that share a domain
// without every renderer re-fetching the same icon.
//
// This does add a new category of outbound request beyond the app's
// existing "only academic search APIs + relay" network surface — favicon
// lookups reveal the domain of whatever a claim's evidence links to,  one
// request per distinct domain, to Google's public favicon service. The user
// explicitly opted into this trade-off (real images over the plain
// monogram) after being told the alternative was to keep no external image
// calls at all.

const FAVICON_TIMEOUT_MS = 3000
const FETCH_ATTEMPTED = new Map<string, Promise<string | null>>()

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

async function fetchFavicon(hostname: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS)
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`, {
      signal: controller.signal
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? 'image/png'
    const buffer = Buffer.from(await res.arrayBuffer())
    // Google's favicon service returns a generic globe placeholder (a
    // small, near-constant byte size) rather than an error for unknown
    // domains — not worth special-casing here, a generic globe is still a
    // reasonable fallback image, just not a wrong one.
    if (buffer.length === 0) return null
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns a cached data: URI favicon for the given source URL's domain, or
 * null if the URL is missing/unparseable or the fetch failed. In-memory
 * only (per app run), keyed by hostname so the many results that share a
 * domain (e.g. the same journal/publisher across several claims) only ever
 * trigger one real fetch.
 */
export function getFaviconDataUrl(sourceUrl: string | null): Promise<string | null> {
  if (!sourceUrl) return Promise.resolve(null)
  const hostname = hostnameOf(sourceUrl)
  if (!hostname) return Promise.resolve(null)

  const cached = FETCH_ATTEMPTED.get(hostname)
  if (cached) return cached

  const promise = fetchFavicon(hostname)
  FETCH_ATTEMPTED.set(hostname, promise)
  return promise
}
