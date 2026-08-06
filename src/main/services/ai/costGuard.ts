export const MAX_CLAIM_DETECTION_INPUT_CHARS = 6000
export const MAX_CLAIMS_PER_ANALYSIS = 8
export const MAX_CRITIQUE_EVIDENCE_ITEMS = 5
export const MAX_CRITIQUE_ABSTRACT_CHARS = 200

// Below this, the model itself said it wasn't sure this is even a real,
// citation-worthy claim (see the prompt's calibration instructions) — no
// reason to spend a relay call's worth of detection on it and then show the
// user something they'd have to second-guess anyway.
export const MIN_CLAIM_CONFIDENCE = 0.4

export function truncateForClaimDetection(text: string): string {
  return text.length > MAX_CLAIM_DETECTION_INPUT_CHARS
    ? text.slice(0, MAX_CLAIM_DETECTION_INPUT_CHARS)
    : text
}
