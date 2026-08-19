import { computeClaimSpans } from './claimSpans.ts'
import { isCitedInScope } from './citationScope.ts'
import { hasInlineCitation } from './inlineCitation.ts'
import type { Claim } from './types.ts'

/**
 * Which claims may be critiqued without anybody pressing anything.
 *
 * The critique is the reasoning model — the most expensive call in this app —
 * and this is the only path that fires it unprompted. So the eligibility rule
 * lives here, in a leaf `npm test` can load, rather than inside a `useEffect`
 * in a 2,000-line view where nothing can reach it. Every bound below is a bound
 * on money.
 *
 * Why it exists at all: `claimsWithoutEvidence` stopped calling a cited claim
 * unsupported (2026-08-19), because a topical search of four scholarly indexes
 * never opens the work the writer named and has no business reporting on it.
 * That left a hole — a broken citation and a good one both went silent — and
 * this call is the only thing in Tracely that reads the cited source
 * (`citedEvidence.ts` puts it in slot 1; `CRITIQUE_SYSTEM_PROMPT` Pass 2
 * resolves it against Crossref and Open Library). It is therefore the only
 * thing that can tell them apart.
 */

/**
 * How many claims one analysis may critique unprompted.
 *
 * `MAX_CLAIMS_PER_ANALYSIS` is 8, so this is not much of a further cap on a
 * single pass. It is the backstop for the case that actually runs a bill up: a
 * long document re-analysed over and over while it is being edited.
 *
 * Re-exported from `main/services/ai/costGuard.ts`, which is where CLAUDE.md
 * tells people to look for AI limits. It is defined HERE because the sweep is
 * driven from the renderer and the renderer must not import from `main/`.
 */
export const MAX_AUTO_CRITIQUE_CLAIMS = 6

/**
 * Claim ids to critique, in document order, already capped.
 *
 * `documentText` is optional but should always be passed where it exists. A
 * detected claim is a sub-span of its sentence, so a reference that follows the
 * assertion is invisible to `hasInlineCitation(claim.text)` — the same bug that
 * made the coverage ratio and the weakness list disagree about one sentence.
 * Without it this falls back to the claim-only test, which under-selects
 * (missing a cited claim costs a check, not a false charge) and is the safe
 * direction for a function that spends money.
 */
export function autoCritiqueTargets(claims: Claim[], documentText?: string): string[] {
  const citedById = documentText
    ? new Map(
        computeClaimSpans(documentText, claims).map(
          (span) => [span.claim.id, isCitedInScope(documentText, span.start, span.end)] as const
        )
      )
    : null

  return claims
    .filter((claim) => {
      // The writer attached a source. An uncited claim's verdict is already
      // readable from its evidence score, and it is the cited ones the report
      // has gone quiet about.
      const cited = citedById?.get(claim.id) ?? hasInlineCitation(claim.text)
      if (!cited) return false
      // The critique reasons over an evidence list. Handing it an empty one
      // produces a verdict about the search rather than about the sentence —
      // see isRetrievalMiss in problemKind.ts.
      if (claim.strengthScore === null) return false
      // Already answered. Re-critiquing is a second charge for a verdict that
      // is sitting on the claim.
      if (claim.critiqueVerdict !== null) return false
      return true
    })
    .slice(0, MAX_AUTO_CRITIQUE_CLAIMS)
    .map((claim) => claim.id)
}
