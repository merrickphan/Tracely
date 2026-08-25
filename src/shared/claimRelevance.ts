/**
 * Is this sentence even about the essay?
 *
 * Everything else in Tracely asks whether a claim is TRUE or SUPPORTED. This
 * asks a third question nothing asked before: does it belong here at all.
 *
 * Owner, 2026-08-22, on pasting "Lamine Yamal is 22 years old" onto the end of
 * a screen-time essay — it should be flagged twice, "for being false" and "for
 * being completely irrelevant to the topic". The first is the critique's job
 * and already works. The second had no mechanism anywhere: a claim's relevance
 * was only ever measured against the SOURCES retrieved for it, never against
 * the document it sits in.
 *
 * ── Why this is worth having separately from the fact-check ────────────────
 * A tangent is not a lie. It can be perfectly true, well-cited and still wrong
 * to include — and it is the failure a marker comments on most and a tool
 * notices least, because every check in the product is scoped to one sentence
 * at a time. Only a whole-document comparison can see it.
 *
 * ── Local, free, and therefore allowed to run unasked ──────────────────────
 * This is a cosine distance between two MiniLM embeddings computed in-process.
 * No relay, no network, nothing billed — which is what lets it run on the same
 * automatic path the evidence sweep does, rather than waiting for a button.
 *
 * A leaf with no imports, so `npm test` can load it. The embedding itself lives
 * in `main/services/structure/claimRelevance.ts`, which cannot be tested for
 * the usual reason: it value-imports the ML worker.
 */

/**
 * How unlike the rest of the draft a claim has to be before it is called a
 * tangent.
 *
 * NOT `MIN_COUNTABLE_RELEVANCE.dense` (0.42). That constant separates "this
 * SOURCE speaks to this claim" — two documents that may share no vocabulary at
 * all — from "it does not". Two sentences of ONE essay are related by
 * construction: they share its subject, its register and usually its nouns, so
 * an ordinary body sentence sits far higher against its own draft than a
 * relevant paper sits against a claim. Borrowing 0.42 would flag most of every
 * essay.
 *
 * ── Measured, on the real model, and the signal was chosen by measuring ───
 * The obvious comparison — claim against the WHOLE draft minus itself — does
 * not separate. On a real screen-time essay it scored an on-topic significance
 * sentence at 0.098 against an off-topic footballer sentence at 0.060: a 0.038
 * band, with a real sentence at the bottom of it. Short, abstract sentences
 * score low against a long document whatever they are about, and length is the
 * confound rather than topic.
 *
 * MAX similarity to any single PARAGRAPH separates cleanly, because a tangent
 * is unlike every paragraph while an abstract on-topic sentence is still like
 * at least one:
 *
 *     on-topic    0.207 .. 0.343   (lowest: "The panic is louder than the
 *                                   finding." — short and metaphorical)
 *     off-topic   0.066 .. 0.151   (highest: "Napoleon was rather short.")
 *
 * 0.18 sits in that gap. The margin is 0.056 on one essay, which is real but
 * not generous — so the threshold is set nearer the off-topic end, and the
 * failure direction is deliberate: MISS a tangent rather than call a real
 * sentence one. Telling a student to delete something that belongs is the
 * worse error, and it is the error they cannot check.
 */
export const MAX_OFF_TOPIC_SIMILARITY = 0.18

/**
 * Shortest draft worth testing a claim against.
 *
 * Below this there is no "topic" yet — the first two sentences of a document
 * are not a subject a third can be off. Returning nothing is the honest answer.
 */
export const MIN_TOPIC_CHARS = 400

export interface ClaimSimilarity {
  claimId: string
  /**
   * The claim's HIGHEST cosine similarity to any one paragraph of the draft,
   * 0..1 — not its similarity to the draft as a whole. See the threshold note.
   */
  similarity: number
}

/**
 * The claims that do not belong in this draft.
 *
 * Takes similarities rather than computing them, so the rule is testable
 * without the model. Null in, null out: the caller must be able to tell "every
 * claim belongs" from "nothing could be measured", and only the first is a
 * finding. Every other check in this product draws that distinction and this
 * one is no different — an unmeasured claim must not be underlined as a
 * tangent because the ML worker failed to load.
 */
export function offTopicClaimIds(
  similarities: ClaimSimilarity[] | null,
  documentChars: number
): string[] | null {
  if (similarities === null) return null
  if (documentChars < MIN_TOPIC_CHARS) return null
  return similarities
    .filter((s) => Number.isFinite(s.similarity) && s.similarity < MAX_OFF_TOPIC_SIMILARITY)
    .map((s) => s.claimId)
}
