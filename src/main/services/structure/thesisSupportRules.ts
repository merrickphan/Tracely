/**
 * Which paragraphs to compare against the thesis, and how far is too far.
 *
 * Split from `thesisSupport.ts` because that file value-imports the ML worker,
 * and `npm test` cannot load anything that does — the leaf rule this codebase
 * runs on. What is left there is the embedding call; everything with a wrong
 * answer available is here.
 *
 * A leaf: no imports at all.
 */

/**
 * Cosine similarity below which a body paragraph is reported as off-thesis.
 *
 * NOT `MIN_COUNTABLE_RELEVANCE.dense` (0.42), and the difference matters. That
 * number was calibrated to separate "this SOURCE speaks to this claim" from "it
 * does not". Two paragraphs of ONE essay are related by construction, and a
 * body paragraph developing one strand of an argument routinely sits at
 * 0.25-0.40 from the thesis sentence — which is exactly what a body paragraph
 * should look like. Borrowing 0.42 would flag half of every draft.
 *
 * On the same labelled pairs, genuinely relevant sources sat at 0.43+ and
 * irrelevant ones at 0.03-0.23. 0.15 sits INSIDE that irrelevant band rather
 * than at its edge, because a false positive here tells a student to delete a
 * paragraph that was doing its job.
 */
export const MIN_THESIS_SIMILARITY = 0.15

/** Below this many characters an embedding is dominated by noise. */
export const MIN_EMBEDDABLE_CHARS = 200

export interface ThesisComparisonInput {
  /** 1-based index and text of every paragraph of the argument. */
  paragraphs: Array<{ index: number; text: string }>
  /** 0-based position of the thesis paragraph, or null when none was found. */
  thesisIndex: number | null
  /** Paragraph 1 is the title — never compared, and never a tangent. */
  titleParagraph?: boolean
  /** 1-based indices to leave out: the conclusion restates rather than develops. */
  skip?: number[]
}

export interface ThesisComparison {
  thesisText: string
  /** The paragraphs worth embedding, in document order. */
  candidates: Array<{ index: number; text: string }>
}

/**
 * What to embed, or null when there is nothing to measure.
 *
 * Null — not an empty list — because the caller must be able to tell "nothing
 * is off-topic" from "nothing was measured". Only the first is a finding.
 */
export function thesisComparisons(input: ThesisComparisonInput): ThesisComparison | null {
  const { paragraphs, thesisIndex, titleParagraph = false, skip = [] } = input
  if (thesisIndex === null || thesisIndex < 0 || thesisIndex >= paragraphs.length) return null

  const thesisText = paragraphs[thesisIndex].text
  if (thesisText.trim().length < MIN_EMBEDDABLE_CHARS) return null

  const skipped = new Set(skip)
  const first = titleParagraph ? 1 : 0
  const candidates = paragraphs.filter(
    (p, i) =>
      i !== thesisIndex &&
      i >= first &&
      !skipped.has(p.index) &&
      p.text.trim().length >= MIN_EMBEDDABLE_CHARS
  )
  return candidates.length === 0 ? null : { thesisText, candidates }
}

/** The 1-based indices whose similarity fell below the floor. */
export function belowThreshold(
  candidates: Array<{ index: number }>,
  similarities: number[]
): number[] {
  return candidates
    .filter((_, i) => similarities[i] < MIN_THESIS_SIMILARITY)
    .map((p) => p.index)
}
