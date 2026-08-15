// Relative, not '@shared/...', and it has to stay that way: this is a RUNTIME
// import, and `npm test` runs the .test.ts beside it through node --test with
// type stripping and no bundler, which resolves tsconfig path aliases for
// `import type` only. The alias form fails at require() time with
// MODULE_NOT_FOUND. (analyzeStructure.ts value-imports '@shared/claimSpans'
// with the alias and pays for it by having no test of its own.)
import { hasInlineCitation } from '../../../shared/inlineCitation.ts'
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

export function computeEvidenceCoverage(claims: Claim[]): EvidenceCoverage {
  const resolved = claims.filter(isResolved)
  const strengths = resolved
    .map((claim) => claim.strengthScore)
    .filter((score): score is number => score !== null)

  return {
    detected: claims.length,
    withRelevantSource: claims.filter(hasRelevantSource).length,
    withOwnCitation: claims.filter((claim) => hasInlineCitation(claim.text)).length,
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
