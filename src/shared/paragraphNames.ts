import type { ParagraphOutline } from './types.ts'

/**
 * What to call each paragraph in a breakdown of the argument.
 *
 * The panels used to head every row with its index and its ROLE — "P1 ·
 * Unlabelled", "P2 · Thesis", "P3 · Claim". Two problems with that, and the
 * first is the one a writer notices: P1 was the essay's TITLE, listed as a
 * paragraph of the argument and labelled "Unlabelled", which reads as the tool
 * failing to understand a heading. `splitParagraphs` breaks on any newline run,
 * so a titled essay always arrives that way.
 *
 * The second is that a role vocabulary is the rubric's, not the writer's. Told
 * a paragraph is "Evidence", a student has to work out which paragraph that is
 * before the label means anything; told it is "Paragraph 2", they already know.
 * Position is how people refer to their own drafts.
 *
 * So the row is named by position and the role stays beside it, quieter. The
 * role is not decoration: `scoreDraft` computes the whole /100 from the role
 * vector, and showing it is what makes a wrong label visibly wrong instead of
 * mysteriously costly. Dropping it would leave a number nobody can argue with,
 * which is the property this rubric exists to have.
 *
 * Pure and surface-agnostic, so the Screen Watch overlay — which loads no
 * stylesheet and cannot import a component — names paragraphs identically. The
 * same rule as problemCopy.ts and citationFlowCopy.ts.
 */

/** `null` for the title, which is not part of the argument and is not listed. */
export type ParagraphName = string | null

export function paragraphNames(
  paragraphs: Pick<ParagraphOutline, 'role'>[],
  titleParagraph = false
): ParagraphName[] {
  const names: ParagraphName[] = []
  // Numbered across the BODY only, so the first body paragraph is "Paragraph 1"
  // whether or not the essay has a title and whether or not it has an
  // introduction. Numbering by array position would make it "Paragraph 3" in a
  // titled essay, which is the index leaking through the label.
  let bodyNumber = 0

  const lastIndex = paragraphs.length - 1
  const conclusionAt =
    paragraphs.length > 0 && paragraphs[lastIndex]?.role === 'conclusion' ? lastIndex : -1

  paragraphs.forEach((paragraph, i) => {
    if (titleParagraph && i === 0) {
      names.push(null)
      return
    }

    const isFirstOfArgument = i === (titleParagraph ? 1 : 0)
    if (isFirstOfArgument) {
      // "Introduction" only when it actually opens: a one-paragraph draft is
      // not an introduction to anything, and calling it one would describe a
      // structure that is not there.
      names.push(paragraphs.length > 1 ? 'Introduction' : 'Paragraph 1')
      return
    }

    if (i === conclusionAt) {
      names.push('Conclusion')
      return
    }

    bodyNumber += 1
    names.push(`Paragraph ${bodyNumber}`)
  })

  return names
}

/**
 * The same name, shaped to be the SUBJECT of a sentence.
 *
 * `weaknesses.ts` used to build its prose from an ordinal over the raw array
 * position — "The 12th paragraph states something absolutely" — while every
 * heading above it was named by `paragraphNames`, which drops the title and
 * numbers the body. On a titled essay the two disagreed by one, so a card
 * headed "Paragraph 11" carried a finding about "the 12th paragraph" and read
 * as a report on a paragraph the writer was not looking at. Owner, 2026-08-19.
 *
 * One name per paragraph, everywhere, is the fix; this is the form that reads
 * in a sentence, since "The Introduction paragraph" does not.
 *
 * `index` is 1-based over the FULL paragraph array — the same number
 * `ParagraphOutline.index` and `StructureWeakness.paragraphIndex` carry.
 */
export function paragraphSubject(
  paragraphs: Pick<ParagraphOutline, 'role'>[],
  titleParagraph: boolean | undefined,
  index: number
): string {
  const name = paragraphNames(paragraphs, titleParagraph)[index - 1]
  // Null is the title and undefined is an index off the end. Neither has a
  // name a reader would recognise, and inventing a number for it is the exact
  // failure this function exists to remove.
  if (!name) return 'This paragraph'
  return name === 'Introduction' || name === 'Conclusion' ? `The ${name.toLowerCase()}` : name
}

/** The same subject mid-sentence: "two sentences in the conclusion". */
export function lowerSubject(subject: string): string {
  return subject.startsWith('The ') ? `t${subject.slice(1)}` : subject
}

/**
 * The same name, short enough for a seam label: "P3", "Intro", "Concl".
 *
 * The flow views drew `¶12 → ¶13` off the raw array while every heading beside
 * them numbered the body, so the two halves of one report pointed at different
 * paragraphs. A tag rather than the full name because these sit in a chip and
 * "Introduction → Paragraph 1" does not fit one.
 */
export function paragraphTag(
  paragraphs: Pick<ParagraphOutline, 'role'>[],
  titleParagraph: boolean | undefined,
  index: number
): string {
  const name = paragraphNames(paragraphs, titleParagraph)[index - 1]
  if (!name) return `P${index}`
  if (name === 'Introduction') return 'Intro'
  if (name === 'Conclusion') return 'Concl'
  return name.replace(/^Paragraph /, 'P')
}
