export const MAX_CLAIM_DETECTION_INPUT_CHARS = 6000
export const MAX_CLAIMS_PER_ANALYSIS = 8
export const MAX_CRITIQUE_EVIDENCE_ITEMS = 4
// A claim whose retrieval failed still needs a critique, so the relevance
// filter below only applies while at least this many items survive it.
export const MIN_CRITIQUE_EVIDENCE_ITEMS = 2
// Claim coverage below this and the source isn't about the claim — see
// selectCritiqueEvidence. Deliberately looser than scoring's
// MIN_COUNTABLE_RELEVANCE (0.2): that decides whether a source counts
// toward a score, this decides whether the model is even shown it, and
// wrongly hiding a real source costs more than wrongly including one.
export const MIN_CRITIQUE_RELEVANCE = 0.15
// ~200 chars of an abstract is one sentence, and in a structured abstract
// that sentence is the background ("Adolescent sleep has been widely
// studied...") — the findings, effect sizes and populations all sit past
// the cut, so the model was being asked whether the evidence supports the
// claim while shown the part of each paper containing no evidence.
//
// 900 rather than a full abstract: 4 relevant items at 900 is ~900 input
// tokens, against ~1500 for the 5-at-1200 this briefly was. Paired with
// the relevance filter that's roughly a 40% cut in critique input on the
// most expensive call in the app, with more of the surviving budget spent
// on papers that are actually about the claim.
export const MAX_CRITIQUE_ABSTRACT_CHARS = 900

// Below this, the model itself said it wasn't sure this is even a real,
// citation-worthy claim (see the prompt's calibration instructions) — no
// reason to spend a relay call's worth of detection on it and then show the
// user something they'd have to second-guess anyway.
export const MIN_CLAIM_CONFIDENCE = 0.4

// Structure classification. Mirrored in the relay's lib/limits.ts.
//
// The order these are applied in is load-bearing: cap each paragraph to
// MAX_STRUCTURE_PARAGRAPH_CHARS first, then the assembled text to
// MAX_STRUCTURE_INPUT_CHARS. Slicing the assembled string instead lets a long
// introduction eat the whole budget, so the conclusion is never labelled and
// two of the six score components silently read as absent rather than as
// unassessed — a wrong score with no visible cause.
export const MAX_STRUCTURE_PARAGRAPHS = 24
// Split between the paragraph's opening and its closing by `windowAtWord` —
// NOT a head truncation, which is what this was and what made the classifier
// worse than the regexes it replaced. A paragraph's role lives at its edges,
// and a real essay scored 18/100 because its thesis was the last sentence of a
// 1,524-character introduction the model saw the first 320 characters of.
//
// 420 rather than 320 because the budget now has to cover two ends and a
// closing move is routinely a 180-character sentence. The increase is ~100
// tokens on the cheapest call in the app — about four thousandths of a cent —
// against a rubric that was otherwise scoring drafts on text nobody showed it.
export const MAX_STRUCTURE_PARAGRAPH_CHARS = 420
export const MAX_STRUCTURE_INPUT_CHARS = 8000

// The auto-critique cap. Defined in `@shared/autoCritique.ts` beside the
// eligibility rule it bounds, because the sweep is driven from the renderer and
// the renderer must not import from `main/`. Re-exported here so this file
// stays the one place to look for an AI limit, as CLAUDE.md says it is.
export { MAX_AUTO_CRITIQUE_CLAIMS } from '@shared/autoCritique'

export function truncateForClaimDetection(text: string): string {
  return text.length > MAX_CLAIM_DETECTION_INPUT_CHARS
    ? text.slice(0, MAX_CLAIM_DETECTION_INPUT_CHARS)
    : text
}

// --- Tracer -----------------------------------------------------------
//
// The chat is the only AI feature here that re-sends its own past on every
// turn, so its cost grows quadratically in a long conversation unless the
// history is capped by TURN COUNT rather than characters. Trimming the
// OLDEST turns keeps the exchange the user is in the middle of intact.
export const MAX_TRACER_MESSAGE_CHARS = 2000
export const MAX_TRACER_HISTORY_MESSAGES = 12
export const MAX_TRACER_DOCUMENT_CHARS = 4000

// The graded read — one call per analysis, the whole draft in.
//
// Bigger on both axes than the classifier caps above, and deliberately. That
// call labels paragraphs, so windowing each one to its opening and closing
// moves is free: a role lives at the edges. This one judges whether the
// evidence in the MIDDLE supports the claim, and quotes the sentence it means —
// a quote from text that was never sent cannot be located in the draft and is
// discarded by verifyGrade, so a finding would be lost rather than merely
// imprecise. Paragraphs therefore go whole, and the budget is spent by dropping
// whole paragraphs off the end.
//
// Mirrors MAX_GRADE_* in the relay's lib/limits.ts, which is the enforced copy.
export const MAX_GRADE_PARAGRAPHS = 40
export const MAX_GRADE_INPUT_CHARS = 16000
