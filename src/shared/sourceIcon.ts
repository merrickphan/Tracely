/**
 * Which of a source's URLs identifies its PUBLISHER.
 *
 * A `Source` can carry two links and neither is guaranteed to be the publisher.
 * Crossref returns `https://doi.org/10.xxxx/...` as the canonical URL for
 * essentially every record it holds, and OpenAlex falls back to the DOI when it
 * has no landing page — so the hostname of `Source.url` is far more often
 * `doi.org` than it is a journal. Asking a favicon service about that returns
 * the DOI Foundation's mark, correctly and uselessly: every row in a results
 * list came back with the same icon, which is a column that identifies nothing
 * while looking like it does.
 *
 * A leaf with no imports, so `npm test` can load it and so both processes can:
 * main resolves the icon, the renderer decides which URL to ask about, and a
 * second copy of this list is a second answer to "is this a publisher?".
 */

/**
 * Hosts that are a redirect TO the source, never the source.
 *
 * Deliberately short. Every entry here costs a real lookup to get past, and a
 * host wrongly listed loses its icon for good — so this holds only the two
 * persistent-identifier resolvers the academic providers actually emit, not
 * every aggregator that might appear in a URL.
 */
const RESOLVER_HOSTS = new Set(['doi.org', 'dx.doi.org', 'hdl.handle.net', 'handle.net'])

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export function isResolverHost(hostname: string | null): boolean {
  if (!hostname) return false
  return RESOLVER_HOSTS.has(hostname.replace(/^www\./, ''))
}

/**
 * The URL whose favicon should be shown for this source.
 *
 * Prefers any link that already names a publisher over one that has to be
 * resolved: a source whose `url` is a DOI but whose `pdfUrl` is
 * `link.springer.com/...` can be identified with no network call at all. Falls
 * back to the DOI, which main then resolves by following it.
 *
 * Returns null when there is nothing to ask about, which renders the monogram.
 */
export function iconUrlFor(source: {
  url?: string | null
  pdfUrl?: string | null
}): string | null {
  const url = source.url ?? null
  const pdfUrl = source.pdfUrl ?? null

  // Parseable AND not a resolver. Checking only the second let an unparseable
  // string through as though it named a publisher — `hostnameOf` answers null
  // for it and `isResolverHost(null)` is false — so a source with a malformed
  // `url` and a perfectly good `pdfUrl` picked the malformed one and got no
  // icon at all.
  const namesAPublisher = (candidate: string | null): boolean => {
    const host = hostnameOf(candidate)
    return host !== null && !isResolverHost(host)
  }

  if (namesAPublisher(url)) return url
  if (namesAPublisher(pdfUrl)) return pdfUrl

  // Neither names a publisher. A resolver URL is still worth returning — main
  // follows it — but an unparseable one is not, so prefer whichever parses.
  if (hostnameOf(url)) return url
  if (hostnameOf(pdfUrl)) return pdfUrl
  return null
}
