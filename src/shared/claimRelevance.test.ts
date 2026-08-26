import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  MAX_OFF_TOPIC_SIMILARITY,
  MIN_TOPIC_CHARS,
  offTopicClaimIds
} from './claimRelevance.ts'

const LONG_ENOUGH = MIN_TOPIC_CHARS + 1

/**
 * The numbers below are MEASURED, not invented — MiniLM against a real
 * screen-time essay, each sentence scored on its highest similarity to any one
 * paragraph with its own text excluded:
 *
 *   on-topic   0.343  "Later work found the effect size to be very small…"
 *   on-topic   0.342  "Parents deserve a clearer account…"
 *   on-topic   0.337  "This matters because policy is being written now…"
 *   on-topic   0.207  "The panic is louder than the finding."   <- the floor
 *   off-topic  0.151  "Napoleon was rather short for his era."  <- the ceiling
 *   off-topic  0.115  "My grandmother makes an excellent lasagne on Sundays."
 *   off-topic  0.109  "Lamine Yamal is 22 years old."
 *   off-topic  0.066  "The Eiffel Tower was completed in 1889…"
 *
 * The threshold has to sit in the 0.151–0.207 gap. These tests pin both edges
 * of it, so a change to the constant that would start flagging real sentences
 * fails here rather than in someone's essay.
 */
describe('offTopicClaimIds', () => {
  it('flags the measured tangents and none of the real sentences', () => {
    const measured = [
      { claimId: 'effect-size', similarity: 0.343 },
      { claimId: 'parents', similarity: 0.342 },
      { claimId: 'policy', similarity: 0.337 },
      { claimId: 'panic', similarity: 0.207 },
      { claimId: 'napoleon', similarity: 0.151 },
      { claimId: 'lasagne', similarity: 0.115 },
      { claimId: 'yamal', similarity: 0.109 },
      { claimId: 'eiffel', similarity: 0.066 }
    ]
    deepStrictEqual(offTopicClaimIds(measured, LONG_ENOUGH), [
      'napoleon',
      'lasagne',
      'yamal',
      'eiffel'
    ])
  })

  // The two edges of the measured gap. If the constant moves outside it, one of
  // these fails — which is the point of writing them as separate cases.
  it('keeps the weakest real sentence and drops the strongest tangent', () => {
    strictEqual(MAX_OFF_TOPIC_SIMILARITY > 0.151, true, 'must catch the strongest tangent')
    strictEqual(MAX_OFF_TOPIC_SIMILARITY < 0.207, true, 'must not flag the weakest real sentence')
  })

  /**
   * Null in, null out. The caller has to be able to tell "every claim belongs"
   * from "nothing could be measured" — a failed embed must not underline a
   * document as one long tangent.
   */
  it('reports not-measured rather than nothing-found', () => {
    strictEqual(offTopicClaimIds(null, LONG_ENOUGH), null)
    deepStrictEqual(offTopicClaimIds([], LONG_ENOUGH), [])
  })

  // Two sentences are not a subject a third can be off.
  it('refuses to judge a draft too short to have a topic', () => {
    const clearlyOff = [{ claimId: 'x', similarity: 0.01 }]
    strictEqual(offTopicClaimIds(clearlyOff, MIN_TOPIC_CHARS - 1), null)
    deepStrictEqual(offTopicClaimIds(clearlyOff, MIN_TOPIC_CHARS), ['x'])
  })

  // A similarity that is not a number is not a finding. NaN < threshold is
  // false in JS, but relying on that is relying on a coincidence.
  it('ignores an unmeasurable similarity rather than flagging it', () => {
    deepStrictEqual(
      offTopicClaimIds([{ claimId: 'nan', similarity: Number.NaN }], LONG_ENOUGH),
      []
    )
  })
})
