/**
 * How many paid web searches one analysis — and one hour — may run.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `find-sources` is the only paid provider in retrieval and the only one
 * nothing bounded. Measured on the owner's OpenAI dashboard, 2026-08-21: the
 * first day web search ever actually ran in a packaged build came to $0.62,
 * against $1.18 for the entire preceding fortnight. Of that day, roughly nine
 * cents was every chat call combined — 13 critiques, 20 detections, 8 grades —
 * and the rest was fourteen web searches.
 *
 * Two reasons it is invisible without a cap like this:
 *
 *  1. **The tool charge is not in `response.usage`.** OpenAI bills
 *     `web_search_preview` per call, separately from tokens, so the relay's own
 *     `[usage] find-sources … cost=$…` line reports the tokens and omits the
 *     part that dominates. Our cost log cannot see this; only a cap can.
 *  2. **The prompt runs SEVERAL searches per call.** It is told to try
 *     site-restricted queries against archives and papers of record — seven
 *     were observed in one call — so one cache entry is many billed searches.
 *
 * ── Per analysis, mirroring MAX_AUTO_CRITIQUE_CLAIMS ───────────────────────
 * The evidence sweep runs in document order, so a bounded budget is spent on
 * the top of the draft rather than an arbitrary subset — the same argument
 * `shared/autoCritique.ts` makes for the critique cap, for the same reason.
 *
 * ── And an hourly backstop, which is not the same thing ────────────────────
 * The per-analysis cap assumes analyses are discrete. Nothing enforces that:
 * Screen Watch mints a fresh claim id per detection and passes no analysis at
 * all, and the editor now detects on a debounce. A loop that re-analysed every
 * fifteen seconds would respect the per-analysis cap perfectly and still spend
 * without limit. The hourly ceiling is the one that holds when the assumption
 * behind the other one is wrong.
 *
 * A leaf: no imports, so `npm test` can load it, and a caller passes the clock
 * rather than this reading it.
 */

/**
 * Paid web searches one analysis may run.
 *
 * Six, matching `MAX_AUTO_CRITIQUE_CLAIMS` — the other per-analysis cap on a
 * paid call, spent the same way, on the top of the document in order.
 *
 * **Deliberately a ceiling rather than a routine constraint.** Replayed against
 * the owner's real workload, the FALLBACK alone takes an 8-claim essay from 8
 * web searches to 4.6, because 43% of claims already had a citable source from
 * the free indexes. So a cap of 6 almost never binds, and one of 4 would buy
 * roughly seven more percentage points by denying the web to claims that
 * genuinely need it — which is the "No sources found" card this provider was
 * added to fix. The saving belongs to the fallback; this is here for the
 * pathological draft, and `MAX_WEB_SEARCHES_PER_HOUR` is what actually stops a
 * runaway.
 */
export const MAX_WEB_SEARCHES_PER_ANALYSIS = 6

/** Paid web searches in any rolling hour, across every analysis and surface. */
export const MAX_WEB_SEARCHES_PER_HOUR = 25

const HOUR_MS = 1000 * 60 * 60

/**
 * Analyses are keyed by id; everything without one shares a single bucket.
 *
 * Screen Watch synthesizes claims with a fresh `randomUUID()` per detection and
 * never persists an analysis, so keying on the id it happens to carry would
 * give every passive re-read a brand new budget — which is exactly the surface
 * that reads text forever without being asked. One shared bucket for all of it
 * is the conservative reading, and it resets on the same hourly window.
 */
const ANONYMOUS = '__no-analysis__'

const perAnalysis = new Map<string, number>()
let recent: number[] = []

export interface WebBudgetDecision {
  allowed: boolean
  /** Why not, for the log. Null when allowed. */
  reason: 'per-analysis-cap' | 'hourly-cap' | null
}

/**
 * Take one web search from the budget, or refuse.
 *
 * Call this immediately BEFORE spending, never after: a decision recorded on
 * completion cannot bound calls that are in flight, and the sweep runs three
 * claims at once.
 */
export function takeWebSearch(analysisId: string | null, now: number): WebBudgetDecision {
  recent = recent.filter((at) => now - at < HOUR_MS)
  if (recent.length >= MAX_WEB_SEARCHES_PER_HOUR) {
    return { allowed: false, reason: 'hourly-cap' }
  }

  const key = analysisId ?? ANONYMOUS
  // The anonymous bucket is bounded by the hour alone. Applying a per-analysis
  // cap to it would permanently switch web search off for Screen Watch after
  // its first four claims, since that bucket never resets.
  if (key !== ANONYMOUS) {
    const spent = perAnalysis.get(key) ?? 0
    if (spent >= MAX_WEB_SEARCHES_PER_ANALYSIS) {
      return { allowed: false, reason: 'per-analysis-cap' }
    }
    perAnalysis.set(key, spent + 1)
  }

  recent.push(now)
  return { allowed: true, reason: null }
}

/** What an analysis has spent so far. For tests and for the log line. */
export function webSearchesSpent(analysisId: string | null): number {
  return perAnalysis.get(analysisId ?? ANONYMOUS) ?? 0
}

/** Searches taken in the last hour, as of `now`. */
export function webSearchesThisHour(now: number): number {
  return recent.filter((at) => now - at < HOUR_MS).length
}

/** Tests only. The real process never resets — that is the point of a budget. */
export function __resetWebBudget(): void {
  perAnalysis.clear()
  recent = []
}
