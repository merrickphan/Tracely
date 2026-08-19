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
 * @param claimText The sentence being critiqued. Omitted, the revision is taken
 *   on trust, which is the pre-2026-08-16 behaviour and is retained only so a
 *   caller without the claim to hand is not forced to invent one.
 */
export function normalizeCritique(raw: CritiqueResult, claimText?: string): CritiqueResult {
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

  return {
    critique: raw.critique,
    verdict: raw.verdict === 'overstated' && !suggestedRevision ? 'weak' : raw.verdict,
    suggestedRevision,
    // A fabricated verdict and a citation fix are mutually exclusive by
    // construction: one says the source does not exist, the other corrects how
    // it was written down. If both arrive, the fix is the safer of the two to
    // keep — but the verdict is what the UI colours, so drop the fix and let
    // the critique text carry it rather than showing a corrected reference for
    // a source we have just called invented.
    citationFix: raw.verdict === 'fabricated' ? null : citationFix
  }
}
