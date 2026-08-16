import type { ScreenWatchClaimEvidence } from '@shared/ipc-contract'
import type { Claim } from '@shared/types'

/**
 * A persisted `Claim` in the shape the shared popover copy expects.
 *
 * The document editor draws the same underlines Screen Watch draws, and reuses
 * its copy (`problemCopyFor`), which is written against `ScreenWatchClaimEvidence`.
 * Screen Watch builds one from a live search result it is still holding; the
 * editor only has a row out of the `claims` table, so the two fields that are
 * not on that row have to be supplied.
 *
 * `count` is one of them, and getting it wrong is the bug this file exists for.
 * It means "how many articles came back", and `problemCopyFor` renders it as
 * literal copy — "5 sources came back, but they score 22/100". The editor used
 * to fill it from `scoreBreakdown.sourceCount`, which is not a count at all but
 * the 0..1 FRACTION of the six-source cap that cleared the relevance floor (see
 * SOURCE_COUNT_CAP in services/search/scoring.ts), so the popover could print
 * "0.667 sources". It went unnoticed while `problemKindsFor` read the same field
 * and only ever tested it against zero; once that switched to
 * `hasRelevantSource(breakdown)` the fraction reached the display path alone.
 *
 * So the count is an argument, threaded in from whoever holds the claim's
 * evidence list. `undefined` means it has not been loaded yet, which is NOT
 * `0` — zero articles is a finding, an unread list is not — and is answered
 * with `null`, the same "nothing is known about this claim yet" the caller
 * already handles for an unresolved search.
 */
export function claimEvidenceFor(
  claim: Pick<Claim, 'strengthScore' | 'scoreBreakdown'>,
  articleCount: number | undefined
): ScreenWatchClaimEvidence | null {
  if (claim.strengthScore === null) return null
  if (articleCount === undefined) return null
  return {
    score: claim.strengthScore,
    count: articleCount,
    // Empty because no caller has needed the article list here: the popover's
    // copy reads only `score`, `count` and `breakdown`.
    articles: [],
    breakdown: claim.scoreBreakdown ?? { sourceCount: 0, quality: 0, recency: 0, relevance: 0, support: 0 }
  }
}
