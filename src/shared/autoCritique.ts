import { computeClaimSpans } from './claimSpans.ts'
import { isCitedInScope } from './citationScope.ts'
import { hasInlineCitation } from './inlineCitation.ts'
import type { Claim, ClaimType } from './types.ts'

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
 * So a number, a date or a quantity makes an uncited claim eligible. What
 * decides eligibility now is `isCheckableClaim` below — this test survives as
 * the RANKING signal, deciding which claims get the six slots when more are
 * eligible than the cap allows.
 *
 * ── It is ANY digit, and it was five branches that only ever matched a year ──
 * The test used to enumerate: a four-digit year, a percentage, a number
 * followed by a magnitude word, a run of four-plus digits, a calendar date.
 * Measured 2026-08-20, that list admitted almost nothing:
 *
 *   skipped   Lamine Yamal is 22 years old
 *   skipped   The Eiffel Tower is 90 metres tall
 *   skipped   Mount Everest is 5,000 feet high      <- the comma beat \d{4,}
 *   skipped   Barack Obama was the 43rd president
 *   CHECKED   World War II ended in 1943
 *
 * Owner, 2026-08-20, on the first of those: *"it didnt flag it."* An age IS a
 * quantity, which this docstring already promised. The branches were not a
 * policy, they were an incomplete enumeration of one — so the test is now the
 * thing they were enumerating, and there is no list left to be missing from.
 */
const CHECKABLE_ASSERTION = /\d/

/** Whether Pass 1 has something specific enough to be confident about. */
export function hasCheckableAssertion(text: string): boolean {
  return CHECKABLE_ASSERTION.test(text)
}

/**
 * Claim types a fact-check has nothing to bite on.
 *
 * Requiring a DIGIT caught "Lamine Yamal is 22 years old" and still missed
 * "Lamine Yamal plays for Real Madrid" — wrong, uncited, and exactly what a
 * reader expects a checker to catch. A gate that can only see numbers can only
 * ever catch the arithmetic half of being wrong.
 *
 * So the test is the claim's TYPE, which the relay already returns on every
 * claim and which nothing here was reading. `opinion` is the interpretive
 * sentence this module keeps describing in prose, and `prediction` is not yet
 * false — those are the two where Pass 1 has nothing to be confident about, and
 * naming them beats inferring them from punctuation. Everything else —
 * `factual`, `statistic`, `causal` — is checkable, digits or not.
 *
 * ── This SPENDS more, deliberately, and the cap is what bounds it ─────────
 * Before this, a draft with no numbers in it critiqued nothing at all; now
 * almost any analysis will use its full MAX_AUTO_CRITIQUE_CLAIMS. That is the
 * point rather than a side effect — owner, 2026-08-20, on being shown the
 * trade: *"do the claimType gate too."* The ceiling is unchanged: six per
 * analysis, once per analysis id, and `ai/critique.ts` caches on the claim's
 * TEXT, so re-opening an unedited document is still free.
 *
 * A digit still matters — it decides WHICH claims get the six slots when there
 * are more eligible than the cap. See the partition in autoCritiqueTargets.
 */
const UNCHECKABLE_TYPES: ReadonlySet<ClaimType> = new Set<ClaimType>(['opinion', 'prediction'])

/**
 * Whether Pass 1 has anything it could be confident about.
 *
 * An `opinion` or `prediction` carrying a hard number is still checkable — the
 * number is the part that can be wrong ("the best side in Europe, unbeaten in
 * 30 matches"), which is also the behaviour a year used to buy.
 */
export function isCheckableClaim(claim: Pick<Claim, 'text' | 'claimType'>): boolean {
  return !UNCHECKABLE_TYPES.has(claim.claimType) || hasCheckableAssertion(claim.text)
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

  const eligible = claims
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
      if (!cited && !isCheckableClaim(claim)) return false
      // The critique reasons over an evidence list. Handing it an empty one
      // produces a verdict about the search rather than about the sentence —
      // see isRetrievalMiss in problemKind.ts.
      if (claim.strengthScore === null) return false
      // Already answered. Re-critiquing is a second charge for a verdict that
      // is sitting on the claim.
      if (claim.critiqueVerdict !== null) return false
      return true
    })

  // Document order, EXCEPT that a claim carrying a hard number goes ahead of
  // one that does not when the cap has to cut.
  //
  // Document order alone was the rule, on the stated reasoning that a long
  // draft should check the top of itself rather than an arbitrary subset. That
  // still holds and is why this is a stable partition rather than a re-rank —
  // but the two ways in do not produce equally checkable claims. A CITED claim
  // qualifies on its citation alone and may carry no assertion at all, so six
  // vague cited sentences at the top of a draft could take every slot from
  // "Lamine Yamal is 22 years old" further down. The slots are money, and Pass
  // 1 has the most to say about the ones with a hard number in them.
  const concrete = eligible.filter((claim) => hasCheckableAssertion(claim.text))
  const rest = eligible.filter((claim) => !hasCheckableAssertion(claim.text))
  return [...concrete, ...rest].slice(0, MAX_AUTO_CRITIQUE_CLAIMS).map((claim) => claim.id)
}
