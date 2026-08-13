/**
 * Whether a document read over UI Automation is worth running structure
 * analysis on at all.
 *
 * The in-app editor owns its own text, so `splitParagraphs` there sees exactly
 * the newlines the user typed. Screen Watch does not: paragraph boundaries are
 * `/[\r\n]+/` applied to whatever `TextPattern.DocumentRange.GetText(-1)` — or,
 * for controls with no TextPattern, `ValuePattern.Current.Value` — happens to
 * return, and newline fidelity varies by application. Two opposite failures,
 * both silent, and neither is detectable from inside the structure engine:
 *
 *  - **Unsplit.** A whole essay arrives as one string with no newlines. Every
 *    paragraph-level signal collapses into a single mega-paragraph and the
 *    score lands somewhere near zero for reasons that have nothing to do with
 *    the writing.
 *  - **Line-wrapped.** Wrapped visual lines are reported as separate runs, so a
 *    six-paragraph essay becomes forty "paragraphs" of sixty characters each.
 *
 * `findWeaknesses` suppresses its whole-draft findings behind `allLabelled`,
 * which covers some of this — but `warrant-gap` and `evidence-stacking` are
 * per-paragraph and are NOT gated that way, so a bad split turns directly into
 * a list of confident accusations about paragraphs that do not exist.
 *
 * There is also an honest third case that has nothing to do with UIA: a draft
 * genuinely two paragraphs long. `scoreDraft` computes `body = roles.slice(1,
 * -1)`, which is empty at that length, so governing claims, counterargument,
 * significance and conclusion are all structurally 0. Scoring someone 9/100 for
 * being two paragraphs into an essay is not a measurement, and pinning it to
 * the corner of their screen is worse.
 *
 * This gate therefore **fails to silence rather than to noise**, which is the
 * right direction for a surface the user never asked for. When it does not
 * return 'ok' the widget shows no structure at all, and the reason goes to the
 * Screen Watch debug log so a missing score is explicable.
 */

export type StructureFit = 'ok' | 'too-short' | 'unsplit' | 'line-wrapped'

/**
 * Below this many paragraphs the rubric cannot express an opinion, because
 * most of its components are only defined over the body.
 */
const MIN_PARAGRAPHS = 3

/**
 * A single paragraph longer than this is not a paragraph. Set well above a
 * genuinely long one (a dense academic paragraph runs 800-1200 characters) so
 * that a real single-paragraph answer is judged 'too-short' — which it is —
 * rather than misreported as an extraction failure.
 */
const UNSPLIT_CHARS = 1500

/**
 * Line-wrap detection. A prose paragraph averages several hundred characters;
 * a wrapped visual line in a typical document window is 60-100. The paragraph
 * count floor matters as much as the mean: three short paragraphs is a plausible
 * note, thirty is a rendering artefact.
 */
const WRAPPED_MIN_PARAGRAPHS = 9
const WRAPPED_MAX_MEAN_CHARS = 120

export interface StructureFitInput {
  /** Paragraph texts as produced by splitParagraphs, in order. */
  paragraphs: string[]
  /** Length of the whole document text the paragraphs came from. */
  textLength: number
}

export function structureFit({ paragraphs, textLength }: StructureFitInput): StructureFit {
  if (paragraphs.length === 0) return 'too-short'

  // Checked before the length floor, because one very long paragraph is an
  // extraction failure rather than a short draft, and saying so is what makes
  // the debug log useful.
  if (paragraphs.length === 1 && textLength > UNSPLIT_CHARS) return 'unsplit'

  if (paragraphs.length < MIN_PARAGRAPHS) return 'too-short'

  const meanChars =
    paragraphs.reduce((sum, paragraph) => sum + paragraph.trim().length, 0) / paragraphs.length
  if (paragraphs.length >= WRAPPED_MIN_PARAGRAPHS && meanChars < WRAPPED_MAX_MEAN_CHARS) {
    return 'line-wrapped'
  }

  return 'ok'
}

/** Log line for why the structure panel is showing nothing. */
export function describeFit(fit: StructureFit): string {
  switch (fit) {
    case 'too-short':
      return 'draft too short to score'
    case 'unsplit':
      return 'no paragraph breaks in the extracted text — this app does not expose them'
    case 'line-wrapped':
      return 'extracted text appears to break on visual lines rather than paragraphs'
    case 'ok':
      return 'ok'
  }
}
