/**
 * The denominators the coverage line is allowed to use.
 *
 * Two lines of arithmetic, in a leaf module rather than inline in
 * ArgumentScoreModal.tsx, for the reason the rest of this codebase gives for
 * the same move: it is a decision with a wrong answer available, and it is
 * shown to a student as a judgement about their essay. `npm test` cannot load
 * a .tsx file, so anything left in there is a rule nothing checks.
 *
 * A leaf: no imports at all.
 */

/**
 * Claims Tracely could meaningfully search — the honest denominator for
 * "found supporting evidence for N of M".
 *
 * @param checked          claims whose search has actually run
 * @param outsideIndexes   of those, the ones four scholarly indexes were never
 *                         going to hold (see retrievalScope.ts)
 * @param withRelevantSource claims a relevant source was found for
 *
 * Leaving out-of-scope claims in the denominator makes retrieval look worse
 * than it is, and — much worse — tells the writer their sentence failed a check
 * that was never really run.
 *
 * The floor is the subtle half. `outsideIndexes` is decided from the claim's
 * TEXT, before and independently of whether anything came back, so a claim can
 * be both out of scope and sourced: a novel with criticism written about it is
 * searchable after all. Subtracting those anyway can drive the denominator
 * below the numerator and print "3 of the 2 it could search". The numerator is
 * a count of real sources found, so it is the thing that cannot be wrong.
 */
export function searchableClaims(
  checked: number,
  outsideIndexes: number,
  withRelevantSource: number
): number {
  return Math.max(withRelevantSource, checked - outsideIndexes)
}
