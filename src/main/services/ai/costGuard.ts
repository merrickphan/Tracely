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

// Tracer is a free-text chat, so it has no natural cost ceiling the way a
// one-shot detection/critique call does — these are that ceiling. History
// is capped by turn count (not just characters) because every prior turn is
// re-sent on every message, so an uncapped conversation grows quadratically
// in tokens. Trimming the OLDEST turns keeps the exchange the user is
// actually in the middle of intact.
// Structure classification. Mirrored in the relay's lib/limits.ts.
//
// The order these are applied in is load-bearing: cap each paragraph to
// MAX_STRUCTURE_PARAGRAPH_CHARS first, then the assembled text to
// MAX_STRUCTURE_INPUT_CHARS. Slicing the assembled string instead lets a long
// introduction eat the whole budget, so the conclusion is never labelled and
// two of the six score components silently read as absent rather than as
// unassessed — a wrong score with no visible cause.
export const MAX_STRUCTURE_PARAGRAPHS = 24
export const MAX_STRUCTURE_PARAGRAPH_CHARS = 320
export const MAX_STRUCTURE_INPUT_CHARS = 8000

export const MAX_TRACER_MESSAGE_CHARS = 2000
export const MAX_TRACER_HISTORY_MESSAGES = 12
export const MAX_TRACER_DOCUMENT_CHARS = 4000
export const MAX_TRACER_CLAIMS_IN_CONTEXT = 8

export function truncateForClaimDetection(text: string): string {
  return text.length > MAX_CLAIM_DETECTION_INPUT_CHARS
    ? text.slice(0, MAX_CLAIM_DETECTION_INPUT_CHARS)
    : text
}
