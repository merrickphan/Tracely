// Relative, not '@shared/...', and it has to stay that way: this is a RUNTIME
// import, and `npm test` runs the .test.ts beside it through node --test with
// type stripping and no bundler, which resolves tsconfig path aliases for
// `import type` only. The alias form fails at require() time with
// MODULE_NOT_FOUND. (analyzeStructure.ts value-imports '@shared/claimSpans'
// with the alias and pays for it by having no test of its own.)
import { hasInlineCitation } from '../../../shared/inlineCitation.ts'
import { isCitedInScope } from '../../../shared/citationScope.ts'
// Relative + `.ts` for the same reason as the line above — a RUNTIME import in
// a module `node --test` loads directly. claimSpans.ts itself only type-imports,
// so it is safe to pull in here.
import { computeClaimSpans } from '../../../shared/claimSpans.ts'
// Same rule again — a runtime import in a module `node --test` loads directly.
import { retrievalScopeFor } from '../../../shared/retrievalScope.ts'
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
 * A claim the four academic indexes were never going to hold.
 *
 * Asked of the claim TEXT and nothing else, so it is true whether or not a
 * search has run — which is what lets `claimsWithoutEvidence` withhold the
 * `unsupported-claim` weakness for these. "This draft makes claims nothing
 * supports" is a serious thing to tell a student, and over a close reading of a
 * novel or a line from a statute it is not a finding about the draft at all;
 * it is retrieval's coverage, restated as the writer's failure. See
 * retrievalScope.ts.
 */
function isOutsideIndexes(claim: Claim): boolean {
  return retrievalScopeFor(claim.text) !== null
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
/**
 * Did the WRITER attach a source to this sentence?
 *
 * Span-aware when the document is available: a detected claim is a sub-span of
 * a sentence, so testing the claim text alone misses an "(Author, Year)" that
 * follows the assertion. Falls back to the claim-only test for a stored claim
 * with no snapshot to read.
 *
 * Extracted so `claimsWithoutEvidence` can ask the same question the coverage
 * ratio asks. The two disagreeing is what produced a report that counted a
 * claim under "has its own citation" and named it under "no supporting source"
 * in the same panel.
 */
function citationLookup(claims: Claim[], documentText?: string): (claim: Claim) => boolean {
  const citedById = documentText
    ? new Map(
        computeClaimSpans(documentText, claims).map(
          (span) => [span.claim.id, isCitedInScope(documentText, span.start, span.end)] as const
        )
      )
    : null
  return (claim) => citedById?.get(claim.id) ?? hasInlineCitation(claim.text)
}

export function computeEvidenceCoverage(claims: Claim[], documentText?: string): EvidenceCoverage {
  const resolved = claims.filter(isResolved)
  const strengths = resolved
    .map((claim) => claim.strengthScore)
    .filter((score): score is number => score !== null)

  const isCited = citationLookup(claims, documentText)

  return {
    detected: claims.length,
    withRelevantSource: claims.filter(hasRelevantSource).length,
    withOwnCitation: claims.filter(isCited).length,
    meanStrength:
      strengths.length === 0
        ? null
        : Math.round(strengths.reduce((sum, score) => sum + score, 0) / strengths.length),
    unchecked: claims.length - resolved.length,
    outsideIndexes: claims.filter(isOutsideIndexes).length
  }
}

/**
 * Claims that were searched and came back with nothing relevant.
 *
 * Deliberately excludes claims whose search has never run. "We looked and found
 * nothing" and "we have not looked" are different statements, and only the
 * first is a weakness in the draft — telling a student their claim is
 * unsupported before checking would be an accusation the app cannot back.
 *
 * ── And excludes claims the writer already cited ───────────────────────────
 * Owner, 2026-08-19, over a sentence carrying "(Lähteenmäki, 2006)" and
 * reported as **"Unsupported claim · 0/100 evidence — no supporting source
 * yet"**: *"if that claim came from the website, you don't need to flag it
 * anymore because it works — unless the citation is wrong... no need to check
 * more websites if the one already cited matches."*
 *
 * That is right, and the sentence this produced was not merely unhelpful, it
 * was false: there IS a supporting source, named in the sentence. What the app
 * actually established is that a topical search of four scholarly indexes
 * returned nothing — and nothing in the retrieval path ever opens the work the
 * writer named, so it is not a finding about their citation at all.
 *
 * This is the SAME rule `problemKindsFor` has applied to the underline since
 * 2026-08-16, where `nothingFound` gates `cited-unverified` for exactly this
 * reason. The two surfaces were reading the same claim and disagreeing: the
 * mark stayed quiet and the report called it unsupported.
 *
 * The cost, stated as plainly as it is stated there: a genuinely miscited claim
 * now says nothing HERE until the critique runs on it. That is the right way
 * round, and it is not a gap — `citedEvidence.ts` puts the writer's own
 * resolved source in slot 1 and `CRITIQUE_SYSTEM_PROMPT`'s Pass 2 and 2.5 are
 * built to judge the citation itself, which is the only path in this app that
 * ever reads it. A malformed reference comes back `citationFix`, an invented
 * one `fabricated`. Retrieval cannot reach either verdict and should stop
 * implying it has.
 */
export function claimsWithoutEvidence(claims: Claim[], documentText?: string): string[] {
  const isCited = citationLookup(claims, documentText)
  return claims
    .filter(
      (claim) =>
        isResolved(claim) &&
        !hasRelevantSource(claim) &&
        !isOutsideIndexes(claim) &&
        !isCited(claim)
    )
    .map((claim) => claim.id)
}
