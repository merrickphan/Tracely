import { createHash } from 'crypto'
import { getCached, setCached } from '../storage/cacheRepo'
import { findEvidence, type RankedSourceResult } from './aggregator'
import type { ScoreBreakdown } from '@shared/types'

export interface EvidenceResult {
  evidence: RankedSourceResult[]
  score: number
  breakdown: ScoreBreakdown
}

// 24h — evidence for a given query rarely changes intraday, and the point of
// the cache is the repeat lookups within one writing session.
const CACHE_TTL_MS = 1000 * 60 * 60 * 24

/**
 * How long an EMPTY answer is kept. Minutes, not a day.
 *
 * `safeSearch` turns every provider failure into `[]`, so "nothing exists" and
 * "every provider failed" arrive here as the same value — and until 2026-08-21
 * both were frozen onto the claim for 24 hours. That is the wrong bet in both
 * directions: an empty result is far more likely to be transient (a rate limit,
 * a timeout, a relay hiccup, a provider that has just been added and has not
 * reached this claim yet) than a durable fact about the literature, and it is
 * also the one answer a writer will retry.
 *
 * Measured on the owner's database: a biography claim searched at 00:37 cached
 * `evidence: 0` until the following day. Every fix that followed — the cache
 * version bump, the retrieval-generation retry — correctly triggered a fresh
 * search, and every one of them was handed this row instead. Three fixes, all
 * invisible, on exactly the document being used to judge them. Owner: *"wait it
 * still does it I dont know why???"*
 *
 * Ten minutes is enough to stop a re-render or a sweep hammering four providers
 * in a row, and short enough that a transient failure or a shipped improvement
 * shows up while the writer is still in the document.
 */
const EMPTY_TTL_MS = 1000 * 60 * 10

function cacheKey(query: string, claimText: string): string {
  // v9: the web-search prompt and schema were rewritten (2026-08-21), so what
  // that provider contributes to this list is different — different sources,
  // different ordering, and enthusiast sites no longer returned at all.
  //
  // v8: empty results were being cached for 24h (see EMPTY_TTL_MS), so every
  // v7 key that happened to be written while a claim came back empty is a row
  // that will keep answering "no sources" until tomorrow. The TTL change fixes
  // the future; only a bump reaches the rows already written.
  //
  // v7: web search (#166) added a whole PROVIDER to the fan-out — the one that
  // covers biography, history, institutions and journalism, which is everything
  // the four academic indexes structurally cannot hold. It shipped without
  // moving this key, so every claim already searched kept returning the
  // pre-web-search list.
  //
  // Measured on the owner's own databases, 2026-08-20: 894 stored sources
  // across stable and preview, and NOT ONE of them from the `web` or
  // `wikipedia` providers — while the router sends 52 of the last 60 claims to
  // `general`, which is exactly the domain both of those run for. The wiring
  // was right, the endpoint was live on staging, and the answer came out of
  // this cache before either could run. Owner: *"all the citations you find are
  // really bad."* They were the old ones.
  //
  // This is the second time, and the paragraph below already said so in
  // capitals. The rule is not "bump when ranking changes" — it is bump when
  // anything about WHAT COMES BACK changes, and adding a provider is the
  // largest possible version of that.
  //
  // v6: the returned evidence is now filtered by MIN_COUNTABLE_RELEVANCE and
  // capped at five (see aggregator.ts). A v5 hit serves the old unfiltered
  // list of sixteen for up to 24 hours — which is exactly what happened: the
  // fix shipped, and the owner's next screenshot still showed eleven sources
  // at 0% match, because every claim in that draft had already been searched.
  //
  // BUMP THIS ON ANY CHANGE TO WHAT findEvidence RETURNS. Not just to how it
  // ranks — to what comes back, how much of it, or how it is scored. A
  // retrieval change that does not move this key is a retrieval change nobody
  // will see for a day, on precisely the documents being used to judge it.
  //
  // v5: World Bank results no longer enter stance classification and datasets
  // have a lower quality weight. A v4 hit would preserve both old behaviours
  // for up to 24 hours.
  //
  // claimText is part of the key because score and ordering depend on it via
  // computeTextRelevance, so two claims that happen to produce the same
  // searchQuery must not share an order computed for different claim text.
  return createHash('sha256').update(`search:aggregate::v9::${query}::${claimText}`).digest('hex')
}

/**
 * findEvidence with the SQLite request cache in front of it.
 *
 * This exists because there were two evidence paths and only one of them was
 * cached. The Analyze view went through evidenceHandlers, which cached for
 * 24h; Screen Watch called the aggregator directly at three sites and cached
 * nothing, so every automatic detection and every hover re-hit all four
 * providers from scratch. That is the real reason Semantic Scholar answers
 * 429 — not request volume in the abstract, but the same handful of queries
 * being re-issued indefinitely.
 *
 * The uncached `findEvidence` is deliberately still exported and still used
 * by the eval harness: a cache in front of the thing being measured would
 * serve pre-change results after a retrieval change and quietly invalidate
 * the comparison.
 */
export async function findEvidenceCached(query: string, claimText: string): Promise<EvidenceResult> {
  const key = cacheKey(query, claimText)

  const cached = getCached<EvidenceResult>(key)
  if (cached) return cached

  const { cacheable, ...result } = await findEvidence(query, claimText)
  // An answer with nothing in it is held for minutes rather than a day — see
  // EMPTY_TTL_MS. `cacheable` is a different question (the World Bank catalogue
  // not being embedded yet) and still gates both.
  const ttl = result.evidence.length === 0 ? EMPTY_TTL_MS : CACHE_TTL_MS
  if (cacheable) setCached(key, 'search:aggregate', result, ttl)
  return result
}
