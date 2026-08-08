export const MAX_CLAIM_DETECTION_INPUT_CHARS = 6000
export const MAX_CLAIMS_PER_ANALYSIS = 8
export const MAX_CRITIQUE_EVIDENCE_ITEMS = 5
// ~200 chars of an abstract is one sentence, and in a structured abstract
// that sentence is the background ("Adolescent sleep has been widely
// studied...") — the findings, effect sizes and populations all sit past
// the cut. The critique prompt asks the model whether the evidence supports
// the claim and then faults it for being vague, while showing it the part
// of each paper that contains no evidence. 1200 covers most of a real
// abstract; at 5 items that's ~1.5k tokens of extra input per critique,
// which is a rounding error next to being able to answer the question.
export const MAX_CRITIQUE_ABSTRACT_CHARS = 1200

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
export const MAX_TRACER_MESSAGE_CHARS = 2000
export const MAX_TRACER_HISTORY_MESSAGES = 12
export const MAX_TRACER_DOCUMENT_CHARS = 4000
export const MAX_TRACER_CLAIMS_IN_CONTEXT = 8

export function truncateForClaimDetection(text: string): string {
  return text.length > MAX_CLAIM_DETECTION_INPUT_CHARS
    ? text.slice(0, MAX_CLAIM_DETECTION_INPUT_CHARS)
    : text
}
