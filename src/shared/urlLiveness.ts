/**
 * What an HTTP status says about whether a page EXISTS.
 *
 * The guard on model-found sources is that every URL is fetched before it is
 * offered — a model with web search retrieves rather than recalls, but a
 * garbled or stale URL still has to be caught before a student cites it.
 *
 * The subtlety is that "I could not read it" is not "it is not there", and
 * getting that backwards throws away good sources. Measured on 2026-08-19,
 * checking five real sources by hand: `unicef.org/goodwill-ambassadors/…`
 * answered 200 and then the next three unicef.org requests answered **403**.
 * Retried after a pause, `unicef.org/history` answered 200. The 403 was
 * rate-limiting, and a checker treating it as dead would have discarded three
 * genuine sources from the organisation the essay is actually about.
 *
 * So this drops only what is positively absent. A paywall, a bot wall, a rate
 * limit and a server having a bad minute are all pages that exist, and the
 * reader following the citation is a browser rather than a fetch from a
 * desktop app.
 *
 * A leaf with no imports.
 */

export type Liveness = 'live' | 'gone' | 'unreachable'

/**
 * 404 and 410 are the web saying "there is nothing here", which is what an
 * invented URL looks like. 401/403/429 are "not to you". 5xx is "not now".
 */
export function livenessFromStatus(status: number): Liveness {
  return status === 404 || status === 410 ? 'gone' : 'live'
}

/**
 * Whether a source that resolved this way should be offered to the writer.
 *
 * `unreachable` — DNS failure, connection refused, timeout — is the other shape
 * an invented URL takes, and unlike a 403 there is no evidence the host exists
 * at all. Dropped, and it is the one judgement call here: a real site that is
 * down at this moment is lost. That is the right direction, because the cost of
 * the opposite error is a citation to a page that was never real.
 */
export function shouldOffer(liveness: Liveness): boolean {
  return liveness === 'live'
}

/**
 * A URL worth even attempting.
 *
 * Cheap structural rejects before any network call: a model asked for a page
 * sometimes hands back the search it ran, a bare domain, or a placeholder host,
 * and none of those needs a request to rule out.
 */
export function isPlausibleSourceUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (!url.hostname.includes('.')) return false
  if (/(^|\.)(example|test|invalid)\.(com|org|net)$/i.test(url.hostname)) return false
  // A results page is not a source — these are the shapes that appear when a
  // model returns the search instead of what it found.
  if (/^(www\.)?(google|bing|duckduckgo)\./i.test(url.hostname)) return false
  return true
}
