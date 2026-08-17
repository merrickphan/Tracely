import type { ClaimType } from '@shared/types'

/**
 * What a claim's type is called on screen.
 *
 * One copy, imported by the three surfaces that print it — ClaimCard, the
 * Screen Watch overlay and the Argument check card — because they were three
 * identical literals and "Causal claim · 93% confidence" is a line the design
 * draws the same way in each. A pure module, so the overlay's own entry (which
 * loads no stylesheet and shares no component tree) can use it too.
 */
export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}
