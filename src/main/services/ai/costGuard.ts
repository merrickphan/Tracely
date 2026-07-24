export const MAX_CLAIM_DETECTION_INPUT_CHARS = 6000
export const MAX_CLAIMS_PER_ANALYSIS = 8
export const MAX_CRITIQUE_EVIDENCE_ITEMS = 5

export function truncateForClaimDetection(text: string): string {
  return text.length > MAX_CLAIM_DETECTION_INPUT_CHARS
    ? text.slice(0, MAX_CLAIM_DETECTION_INPUT_CHARS)
    : text
}
