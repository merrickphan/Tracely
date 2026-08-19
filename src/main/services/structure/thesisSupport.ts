import { cosineSimilarity, embedCached } from '../ml'
import { belowThreshold, thesisComparisons, type ThesisComparisonInput } from './thesisSupportRules'

/**
 * Which body paragraphs are not about what the draft says it is arguing.
 *
 * Two rubric lines, one measurement:
 *
 *   THESIS      "Flag if the body paragraphs do not actually support the thesis."
 *   RELEVANCE   "Flag tangents."
 *
 * Both had zero implementation, and neither is reachable by a rule — "is this
 * paragraph about the thesis?" is a question about MEANING, and no word list
 * answers it. `cohesion.ts` gets closest with `topic-jump`, but that compares a
 * paragraph to its NEIGHBOUR, so an essay that drifts smoothly away from its
 * thesis over five paragraphs passes it at every step.
 *
 * The instrument is the one already shipped for evidence relevance: the local
 * MiniLM embedder in `services/ml`. It runs in-process, costs nothing, and
 * needs no network — the same reason evidence search may run automatically.
 *
 * ── Precision over recall, deliberately ────────────────────────────────────
 * A false positive tells a student to delete a paragraph that was doing its
 * job, which is the most destructive advice this product could give. So:
 *
 *   - The floor is far below `MIN_COUNTABLE_RELEVANCE.dense` (0.42, calibrated
 *     for "does this SOURCE speak to this claim"). That threshold separates
 *     related from unrelated; this one has to separate unrelated from
 *     *actively off-topic*, because two paragraphs of one essay are related by
 *     construction. Measured against that calibration: genuinely relevant pairs
 *     sat at 0.43+ and irrelevant ones at 0.03-0.23, so 0.15 sits inside the
 *     irrelevant band rather than at its edge.
 *   - A paragraph too short to embed meaningfully is never flagged.
 *   - No thesis, no finding. There is nothing to be off-topic FROM.
 *   - The ML worker being unavailable returns null, and null means silence
 *     rather than a guess.
 */

// The threshold and the selection rules live in the leaf beside this file, so
// `npm test` can load them — see thesisSupportRules.ts. Re-exported here so a
// caller has one import.
export {
  MIN_EMBEDDABLE_CHARS,
  MIN_THESIS_SIMILARITY,
  type ThesisComparisonInput
} from './thesisSupportRules'

/**
 * 1-based paragraph indices that do not speak to the thesis.
 *
 * Null — not an empty array — when no judgement was possible: no thesis, no
 * embedder, too little text. The caller must be able to tell "nothing is
 * off-topic" from "nothing was measured", because only the first is a finding.
 *
 * Everything decidable lives in `thesisSupportRules.ts`; what is here is the
 * embedding call, which is also what makes this file untestable.
 */
export async function offThesisParagraphs(
  input: ThesisComparisonInput
): Promise<number[] | null> {
  const plan = thesisComparisons(input)
  if (!plan) return null

  const vectors = await embedCached([plan.thesisText, ...plan.candidates.map((p) => p.text)])
  // Null is the ML worker being unavailable — a packaging failure, a cold
  // start, an unsupported platform. Silence, not a guess: the same way
  // scoring.ts degrades rather than fails.
  if (!vectors || vectors.length !== plan.candidates.length + 1) return null

  const [thesisVector, ...rest] = vectors
  return belowThreshold(
    plan.candidates,
    rest.map((v) => cosineSimilarity(thesisVector, v))
  )
}
