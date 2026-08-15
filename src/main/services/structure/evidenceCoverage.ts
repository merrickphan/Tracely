// Relative, not '@shared/...', and it has to stay that way: this is a RUNTIME
// import, and `npm test` runs the .test.ts beside it through node --test with
// type stripping and no bundler, which resolves tsconfig path aliases for
// `import type` only. The alias form fails at require() time with
// MODULE_NOT_FOUND. (analyzeStructure.ts value-imports '@shared/claimSpans'
// with the alias and pays for it by having no test of its own.)
import { hasInlineCitation, hasInlineCitationNear } from '../../../shared/inlineCitation.ts'
// Relative + `.ts` for the same reason as the line above — a RUNTIME import in
// a module `node --test` loads directly. claimSpans.ts itself only type-imports,
// so it is safe to pull in here.
import { computeClaimSpans } from '../../../shared/claimSpans.ts'
import type { Claim, EvidenceCoverage } from '@shared/types'

/**
 * How well the draft's claims are actually sourced.
 *
 * Reported BESIDE the structure score, never inside it — see the note in
 * scoreDraft.ts on why folding retrieval into the number would double-count it
 * and turn the score into a measure of how searchable the topic is.
 *
 * "Has a relevant source" is read off `scoreBreakdown.sourceCount`, not by
 * re-thresholding `claim_evidence.relevance_score`. That factor is
 * `min(relevantCount, 6) / 6` computed at scoring time against
 * MIN_COUNTABLE_RELEVANCE for whichever metric produced the relevance values —
 * and which metric that was is NOT persisted alongside the rows. Applying the
 * lexical floor (0.2) to cosine values, or the dense floor (0.35) to word
 * overlap, would silently miscount in opposite directions depending on whether
 * the ML worker happened to be available. The breakdown already answers the
 * question with the right floor.
 *
 * This never initiates a search. Everything here reads what has already been
 * stored, so opening the Structure panel costs nothing.
 */

/** A claim whose evidence search has actually run. */
function isResolved(claim: Claim): boolean {
  return claim.strengthScore !== null
}

function hasRelevantSource(claim: Claim): boolean {
  return (claim.scoreBreakdown?.sourceCount ?? 0) > 0
}

/**
 * `documentText` is optional but should be passed wherever it exists.
 *
 * A detected claim is a sub-span of a sentence, so `hasInlineCitation` on the
 * claim alone cannot see an "(Author, Year)" that follows the assertion — the
 * count then disagreed with the underlines drawn over the very same draft.
 * Without the text this falls back to the claim-only test, which is the old
 * behaviour and still right for a stored claim with no snapshot to read.
 */
export function computeEvidenceCoverage(claims: Claim[], documentText?: string): EvidenceCoverage {
  const resolved = claims.filter(isResolved)
  const strengths = resolved
    .map((claim) => claim.strengthScore)
    .filter((score): score is number => score !== null)

  const citedById = documentText
    ? new Map(
        computeClaimSpans(documentText, claims).map(
          (span) => [span.claim.id, hasInlineCitationNear(documentText, span.start, span.end)] as const
        )
      )
    : null
  const isCited = (claim: Claim): boolean =>
    citedById?.get(claim.id) ?? hasInlineCitation(claim.text)

  return {
    detected: claims.length,
    withRelevantSource: claims.filter(hasRelevantSource).length,
    withOwnCitation: claims.filter(isCited).length,
    meanStrength:
      strengths.length === 0
        ? null
        : Math.round(strengths.reduce((sum, score) => sum + score, 0) / strengths.length),
    unchecked: claims.length - resolved.length
  }
}

/**
 * Claims that were searched and came back with nothing relevant.
 *
 * Deliberately excludes claims whose search has never run. "We looked and found
 * nothing" and "we have not looked" are different statements, and only the
 * first is a weakness in the draft — telling a student their claim is
 * unsupported before checking would be an accusation the app cannot back.
 */
export function claimsWithoutEvidence(claims: Claim[]): string[] {
  return claims.filter((claim) => isResolved(claim) && !hasRelevantSource(claim)).map((claim) => claim.id)
}
