const lastCallAt = new Map<string, number>()
// One promise chain per key. Without this, throttle was only a delay, not a
// limiter: every concurrent caller read `lastCallAt` before any of them
// wrote it, so N callers computed the same wait, slept the same duration,
// and then all fired at the same instant. It correctly serialized strictly
// sequential awaited calls and did nothing at all for the case that
// actually matters here — Screen Watch fans out several findEvidence calls
// without awaiting, and each of those hits four providers in Promise.all.
const chains = new Map<string, Promise<void>>()

/**
 * Ensures at least `minIntervalMs` passes between calls sharing the same
 * `key`, including concurrent ones — callers queue and are released in
 * order rather than all waking together.
 */
export function throttle(key: string, minIntervalMs: number): Promise<void> {
  const previous = chains.get(key) ?? Promise.resolve()

  const next = previous.then(async () => {
    const wait = (lastCallAt.get(key) ?? 0) + minIntervalMs - Date.now()
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    lastCallAt.set(key, Date.now())
  })

  // The stored link swallows rejections so one failed waiter can't poison
  // the chain for every subsequent caller; `next` itself is returned
  // unswallowed so the caller still sees its own error.
  chains.set(
    key,
    next.catch(() => undefined)
  )
  return next
}

/**
 * Minimum gap between requests per provider.
 *
 * Only PubMed was throttled before, despite a comment elsewhere claiming
 * all providers were. Semantic Scholar is the one that actually hurt: its
 * unauthenticated tier is a single pool shared across every anonymous
 * caller worldwide, so it answered 429 to most requests and silently
 * contributed nothing (an eval run got 4 results from 14 queries). A key
 * from semanticscholar.org/product/api raises the limit; this keeps the
 * keyless case from being self-defeating in the meantime.
 */
export const PROVIDER_MIN_INTERVAL_MS = {
  openalex: 150,
  crossref: 150,
  semanticscholar: 1100,
  pubmed: 350 // NCBI allows ~3 req/sec unauthenticated
} as const

// NCBI raises the ceiling to 10 req/sec for requests carrying an api_key.
// Kept next to the unauthenticated figure so the two can't drift apart, and
// held slightly under the stated limit because the ceiling is enforced on
// their side against wall-clock arrival, not our send time.
export const PUBMED_KEYED_MIN_INTERVAL_MS = 110
