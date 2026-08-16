import type { CritiqueResult } from './critique'

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
 * Named things: proper nouns, model numbers, figures, years.
 *
 * The first word is dropped because it is capitalised by sentence position
 * rather than by being a name — "Recent large language models…" must not count
 * "Recent" as an entity the claim failed to mention.
 */
function namedEntities(sentence: string): Set<string> {
  const words = sentence.trim().split(/\s+/).slice(1)
  const found = new Set<string>()
  for (const word of words) {
    for (const token of word.match(/\b[A-Z][A-Za-z]*(?:[-–][A-Za-z0-9]+)*\d*\b|\b\d+(?:[.,]\d+)?\b/g) ?? []) {
      found.add(token.toLowerCase().replace(/[–]/g, '-'))
    }
  }
  return found
}

/**
 * Is this revision a NARROWING of the claim, or a different claim?
 *
 * A suggested revision is the one place Tracely puts words inside a student's
 * sentence, and the relay prompt's rule for it is that only the quantifier,
 * scope or hedge may change. Enforced here as well as asked for there, because
 * the model broke it in production on 2026-08-16:
 *
 *   claim     GPT-5 class models now score above the median human rater on the
 *             AP English Language essay rubric, according to the vendor's own
 *             published evaluation.
 *   revision  Recent large language models, such as GPT-4, have demonstrated
 *             scoring performance comparable to or sometimes exceeding the
 *             average human rater on academic English essay rubrics...
 *
 * The evidence was about GPT-4, so the revision quietly rewrote the SUBJECT to
 * match the evidence — and dropped the AP rubric and the vendor citation with
 * it. A student who accepts that is asserting something they never claimed,
 * about a different model, with the attribution removed.
 *
 * The test is one-directional on purpose. A narrowing may DROP named things
 * ("in three US states" becoming "in some states"); it may never INTRODUCE one,
 * because a name the original sentence does not contain is a fact the student
 * did not assert. Hedges add words like "some" and "may", never entities.
 */
function isNarrowing(revision: string, claimText: string): boolean {
  const claimed = namedEntities(claimText)
  for (const entity of namedEntities(revision)) {
    if (!claimed.has(entity)) return false
  }
  return true
}

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
