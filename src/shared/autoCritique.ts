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
 * A concrete assertion a fact-check can actually bite on.
 *
 * `CRITIQUE_SYSTEM_PROMPT` Pass 1 checks "the claim's specific assertions
 * (dates, numbers, names, statistics) against your own well-established
 * knowledge" — and it is the ONLY thing in Tracely that can say a sentence is
 * false. Retrieval cannot: it finds sources on the topic, and a topic is not a
 * fact.
 *
 * Owner, 2026-08-19: *"I typed 'World War II ended in 1943,' and it just gave
 * me a bunch of sources because it was uncited. But obviously, that's not a
 * true statement."* Exactly right, and the cause was this module: auto-critique
 * was cited-only, on the reasoning that "an uncited claim's verdict is already
 * readable from its evidence score". That sentence disproves it. The search
 * returns plenty of real WWII scholarship, the claim scores well on retrieval,
 * and nothing anywhere asks whether 1943 is the right year.
 *
 * So a year, a date, a percentage or a quantity makes an uncited claim eligible
 * too. These are the assertions Pass 1 can be confident about, and the ones a
 * reader would expect a checker to catch.
 *
 * Deliberately NOT "any uncited claim". An unfalsifiable or interpretive
 * sentence gives Pass 1 nothing to be confident about, so the call would buy a
 * verdict about the evidence — which the strength score already reports for
 * free.
 */
const CHECKABLE_ASSERTION = new RegExp(
  [
    // A year. The Hepburn and WWII cases both turn on one.
    '\\b(?:1[0-9]\\d{2}|20\\d{2})\\b',
    // A percentage, written either way.
    '\\d+(?:\\.\\d+)?\\s?(?:%|per ?cent)',
    // A quantity with a magnitude word, or any number of four digits or more.
    '\\b\\d[\\d,]*\\s?(?:million|billion|trillion|thousand)\\b',
    '\\b\\d{4,}\\b',
    // A calendar date.
    '\\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2}\\b'
  ].join('|'),
  'i'
)

/** Whether Pass 1 has something specific enough to be confident about. */
export function hasCheckableAssertion(text: string): boolean {
  return CHECKABLE_ASSERTION.test(text)
}

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
      // Two ways in, and they answer two different questions.
      //
      //   cited                  — is the source the writer named any good?
      //                            Only the critique opens it.
      //   checkable assertion    — is the sentence TRUE? Only Pass 1 asks.
      //
      // The second was missing until 2026-08-19 and "World War II ended in
      // 1943" is what exposed it: uncited, so no critique ran, so the app
      // answered a false sentence with a list of sources about the war.
      const cited = citedById?.get(claim.id) ?? hasInlineCitation(claim.text)
      if (!cited && !hasCheckableAssertion(claim.text)) return false
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
