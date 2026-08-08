import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import type { NormalizedSourceResult } from './types'

// Wikipedia, for the claims the academic providers answer badly.
//
// Not every checkable sentence in a student essay is a scientific one. Dates,
// definitions, who someone was, what an organisation does — the peer-reviewed
// literature either has nothing on these or has something so specialised it
// reads as a non sequitur. The labelled baseline is full of the failure mode:
// a claim about the printing press retrieved papers on transistor lithography.
//
// The obvious objection is right: a student must not cite Wikipedia, and this
// module is not pretending otherwise. It is scored as VenueType 'reference' at
// 0.35, barely above 'other' and a third of a journal, so an encyclopedia
// article can inform a claim's evidence list without ever making it look well
// supported. What it is genuinely good for is orientation — and for the
// primary sources its own references point to, which is the natural follow-up.

// A hard cap rather than a share of the usual per-provider limit. Wikipedia
// will almost always look more textually relevant to a general claim than any
// single paper does, because it is written in the same plain register as the
// claim. Without a cap it would win the top slots on relevance and push out
// the peer-reviewed evidence that is the point of the product.
const MAX_RESULTS = 2

// Wikimedia's user-agent policy asks for a descriptive agent identifying the
// application and a contact. Requests without one are liable to be refused,
// and being identifiable is what earns a courtesy warning instead of a block.
const USER_AGENT = 'Tracely/0.3.76 (https://jointracely.com; info@jointracely.com)'

interface WikipediaPage {
  pageid: number
  title: string
  extract?: string
  fullurl?: string
  touched?: string
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  // One request, not two. `generator=search` feeds the search hits straight
  // into the property queries, so the intro extract and canonical URL come
  // back with the titles rather than needing a second round trip per article.
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(Math.min(limit, MAX_RESULTS)),
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    format: 'json',
    formatversion: '2',
    origin: '*'
  })

  await throttle('wikipedia', PROVIDER_MIN_INTERVAL_MS.wikipedia)

  let data: { query?: { pages?: WikipediaPage[] } }
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) {
      console.warn(`[search:wikipedia] ${res.status} ${res.statusText} — no results for "${query}"`)
      return []
    }
    data = (await res.json()) as { query?: { pages?: WikipediaPage[] } }
  } catch (error) {
    console.warn('[search:wikipedia] request failed', error)
    return []
  }

  const pages = data.query?.pages ?? []

  return pages.slice(0, MAX_RESULTS).map((page, index) => ({
    doi: null,
    title: page.title,
    // No author list on purpose. "Wikipedia contributors" is the correct
    // attribution and every citation style already knows how to render a
    // corporate/anonymous work from the venue, so inventing an author here
    // would only produce a wrong-looking citation.
    authors: [],
    // Deliberately null rather than the last-edited year. A citation needs the
    // date the reader retrieved the page, which is a property of the citation
    // and not of the article, and `touched` changes on edits that have nothing
    // to do with the claim.
    year: null,
    venue: 'Wikipedia',
    venueType: 'reference' as const,
    url: page.fullurl ?? `https://en.wikipedia.org/?curid=${page.pageid}`,
    pdfUrl: null,
    // The lead section, which is the part that states the plain facts a
    // general claim turns on. The full article would swamp the embedding with
    // sections irrelevant to the claim.
    abstract: page.extract?.trim() || null,
    provider: 'wikipedia' as const,
    providerId: String(page.pageid),
    citationCount: null,
    // Free to read by definition, which is most of why it is useful here.
    oaStatus: 'open',
    relevanceRank: index,
    raw: page
  }))
}
