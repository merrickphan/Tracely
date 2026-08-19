import type { CritiqueResult } from './critique'
// A value import, with the extension so Node's type-stripping resolver can
// follow it — the same thing `shared/citationScope.ts` does. `isNarrowing`
// lived here as a private function until Tracer needed the identical rule for
// the rewrites it proposes; one copy, enforced in both places.
import { isNarrowing } from '../../../shared/narrowing.ts'

/*
 * A leaf module on purpose, like roles.ts and inlineCitation.ts.
 *
 * This lives apart from critique.ts because that file value-imports
 * cacheRepo and client, and Node's type-stripping resolver cannot follow
 * this codebase's extensionless relative imports — so anything sharing a
 * file with them cannot be unit tested. The import above is type-only and
 * erases at runtime, which is what keeps this loadable.
 *
 * Worth the extra file: this function decides whether a student is shown a
 * rewrite of their own sentence, and that is not logic to ship untested.
 */
/**
 * Fill the fields a relay that predates them cannot send.
 *
 * The relay is a separate repository on its own deploy cadence — see
 * AGENTS.md — so a desktop build always has to assume it may be talking to an
 * older one. Without this, `suggestedRevision` arrives as `undefined` and the
 * card's `!== null` checks render an empty revision block.
 *
 * `overstated` is downgraded rather than passed through when the revision that
 * gives it its meaning is missing: the verdict's whole content is "here is the
 * narrower sentence", and printing "Overstated" with nothing after it is the
 * complaint without the fix. An old relay cannot emit it anyway; this is for
 * the malformed-response case.
 */
/**
 * What Tracely established locally, independent of what the model said.
 *
 * One field so far, and it exists because the model does not honour the guard
 * that was supposed to make `fabricated` unreachable without evidence — see
 * `referenceLookupRan`.
 */
export interface CritiqueFacts {
  /**
   * A reference lookup actually ran for this sentence.
   *
   * `checkReferences` returns nothing at all unless the sentence names a
   * reference it can search — `isCheckable` requires two surnames and a year —
   * so for a single-author citation, an "et al.", or a placeholder author NO
   * LOOKUP HAPPENS and no reference section is sent to the relay.
   *
   * `CRITIQUE_SYSTEM_PROMPT` Pass 2 is explicit about what that means: "If the
   * section is absent, no lookup was possible … and (c) is unavailable." The
   * model returns `fabricated` anyway.
   *
   * Measured on the owner's own database, 2026-08-19: **15 of 89 stored
   * verdicts are `fabricated`** — 17% — and on one five-paragraph biographical
   * essay three of eight claims were, including "Audrey Hepburn was born to an
   * English father and a Dutch mother in Brussels", which is true, ordinary and
   * correctly attributed. Every one of those sentences cited
   * `(Unknown Author, 2025)`, which parses to a single surname, so
   * `isCheckable` refused it and nothing was ever searched.
   *
   * The prompt's guard is advisory; this one is not. The rule it enforces is
   * the prompt's own: a fabrication verdict with nothing searched is an
   * accusation rather than a finding, and it is the most damaging thing this
   * product can say to a writer.
   */
  referenceLookupRan: boolean
}

/**
 * What the writer is told when a fabrication verdict is withdrawn.
 *
 * A local template REPLACING the model's prose rather than sitting beside it,
 * because that prose asserts a search that never happened — the prompt requires
 * a `fabricated` verdict to "state what was searched for and what came back",
 * so the paragraph is unusable the moment the verdict is. Keeping it and
 * quietly recolouring the badge would leave the accusation on screen under a
 * softer label, which is worse than either alone.
 *
 * It says the thing that is actually true, and that is a real finding: the
 * citation does not carry enough to look up.
 */
export const UNCHECKABLE_REFERENCE_CRITIQUE =
  'Tracely could not check the source this sentence names. A reference needs at least two author surnames and a year before it can be looked up, and this one gives less — so nothing was searched, and nothing here is a judgement about whether the source is real. Check that the reference is complete; if the work genuinely has no named author, cite it by title and publisher instead.'

/**
 * @param claimText The sentence being critiqued. Omitted, the revision is taken
 *   on trust, which is the pre-2026-08-16 behaviour and is retained only so a
 *   caller without the claim to hand is not forced to invent one.
 * @param facts What Tracely established locally. Omitted, `referenceLookupRan`
 *   is assumed TRUE — the pre-2026-08-19 behaviour — so an existing caller is
 *   unchanged by this parameter arriving. Every real caller should pass it.
 */
export function normalizeCritique(
  raw: CritiqueResult,
  claimText?: string,
  facts?: CritiqueFacts
): CritiqueResult {
  const trimmed = typeof raw.suggestedRevision === 'string' && raw.suggestedRevision.trim()
    ? raw.suggestedRevision.trim()
    : null

  // A revision that introduces a name the claim never made is not a narrowing,
  // and dropping it is not merely defensive: `overstated` without a revision
  // falls through to `weak` below, which is the honest verdict for a sentence
  // whose evidence is about something else.
  const suggestedRevision =
    trimmed && claimText && !isNarrowing(trimmed, claimText) ? null : trimmed
  const citationFix =
    typeof raw.citationFix === 'string' && raw.citationFix.trim() ? raw.citationFix.trim() : null

  // A fabrication verdict reached with nothing searched. See CritiqueFacts.
  //
  // Downgraded to `unsupported` rather than to `weak`: the sentence may be
  // perfectly well reasoned, and what is actually established is only that
  // Tracely could not confirm the source. `unsupported` is also the verdict
  // `isRetrievalMiss` already knows how to keep quiet about when nothing
  // relevant came back, so a claim in this state stops shouting on both
  // surfaces rather than swapping one accusation for another.
  const withdrawnFabrication =
    raw.verdict === 'fabricated' && facts !== undefined && !facts.referenceLookupRan

  return {
    critique: withdrawnFabrication ? UNCHECKABLE_REFERENCE_CRITIQUE : raw.critique,
    verdict: withdrawnFabrication
      ? 'unsupported'
      : raw.verdict === 'overstated' && !suggestedRevision
        ? 'weak'
        : raw.verdict,
    suggestedRevision: withdrawnFabrication ? null : suggestedRevision,
    // A fabricated verdict and a citation fix are mutually exclusive by
    // construction: one says the source does not exist, the other corrects how
    // it was written down. If both arrive, the fix is the safer of the two to
    // keep — but the verdict is what the UI colours, so drop the fix and let
    // the critique text carry it rather than showing a corrected reference for
    // a source we have just called invented.
    citationFix: raw.verdict === 'fabricated' ? null : citationFix
  }
}
