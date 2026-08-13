import type { ParagraphRole } from '@shared/types'
import type { ParagraphSpan } from '@shared/paragraphSplit'

/**
 * Local, zero-cost role labelling. This is the fallback the panel runs on
 * before (and whenever) the relay classifier is unavailable.
 *
 * The governing rule: **label only what a marker or a detected claim
 * justifies, and return 'unknown' for everything else.** A heuristic that
 * guesses produces a confident-looking score computed from nothing, which is
 * strictly worse than admitting the paragraph wasn't read — `complete: false`
 * and a "provisional" badge are the honest output, and the score rubric is
 * built to degrade that way on purpose.
 */

// Openers that reliably signal the writer is entertaining an objection. Matched
// only at the START of a paragraph: "however" mid-paragraph is an ordinary
// contrast between two of the writer's own points, not a counterargument, and
// matching it anywhere labelled roughly every paragraph in a real essay.
const COUNTERARGUMENT_MARKERS = [
  'however',
  'critics argue',
  'critics contend',
  'critics of',
  'skeptics',
  'some argue',
  'some have argued',
  'some might argue',
  'one might argue',
  'one might object',
  'it could be argued',
  'it might be objected',
  'opponents',
  'detractors',
  'on the other hand',
  'admittedly',
  'granted',
  'to be fair',
  'conversely',
  'that said'
]

const CONCLUSION_MARKERS = [
  'in conclusion',
  'to conclude',
  'in summary',
  'in sum',
  'to sum up',
  'ultimately',
  'overall',
  'taken together',
  'in the end',
  'all told'
]

/**
 * Phrases that answer "so what?" rather than restating. Exported because
 * scoreDraft awards partial significance credit when one of these appears in a
 * conclusion that has no dedicated significance paragraph.
 */
export const SIGNIFICANCE_MARKERS = [
  'matters because',
  'why this matters',
  'the implication',
  'the implications',
  'implications of',
  'at stake',
  'the stakes',
  'the significance',
  'significant because',
  'what this means for',
  'the consequence',
  'the consequences',
  'this suggests that policy',
  'going forward',
  'the broader'
]

// Connectives that introduce a warrant — the sentence explaining how the
// evidence just given bears on the claim. This is a MARKER heuristic, and the
// component it feeds is labelled "reasoning markers" for exactly that reason:
// it detects that the writer reached for an explanatory connective, not that
// the explanation is any good. "Sales rose. Therefore the moon is cheese."
// passes. The relay classifier's `hasWarrant` replaces this.
const WARRANT_MARKERS = [
  'because',
  'therefore',
  'thus',
  'hence',
  'consequently',
  'as a result',
  'which suggests',
  'this suggests',
  'which shows',
  'this shows',
  'which means',
  'this means',
  'which indicates',
  'this indicates',
  'demonstrates that',
  'implies that',
  'in other words',
  'the reason',
  'this is why',
  'follows that'
]

/** The paragraph's first sentence, or the whole text if it has only one. */
function firstSentence(text: string): string {
  const match = /[.!?]+["'’”)\]]*\s/.exec(text)
  return match ? text.slice(0, match.index + match[0].length) : text
}

function startsWithMarker(text: string, markers: string[]): boolean {
  // Anchored at the OPENING of the first sentence, which is what the name says
  // and what the markers are: sentence-openers announcing a turn in the
  // argument. It used to be `includes` over the first 60 characters, and the
  // difference is not academic — "The results were positive overall, and the
  // trend held" was labelled a conclusion, and "The evidence, however, is not
  // decisive" a counterargument. Both are the writer carrying on, not
  // signposting.
  //
  // Two things still have to be allowed through, because both are ordinary
  // prose rather than edge cases: an opening quotation mark or bracket, and a
  // short coordinating conjunction ("But in conclusion, ...").
  const opening = firstSentence(text).slice(0, 60).toLowerCase()
  return markers.some((marker) => OPENER.get(marker)!.test(opening))
}

/**
 * One anchored matcher per marker, built once at module load.
 *
 * No escaping: every marker is plain lowercase words and spaces. If one ever
 * needs a regex metacharacter, escape it here rather than at the call site.
 *
 * The trailing word boundary matters — without it "in sum" also matches "in
 * summary" and "granted" matches "grantedly", so the label would depend on
 * whichever list entry happened to be reached first.
 */
const OPENER = new Map<string, RegExp>()
function openerFor(marker: string): RegExp {
  return new RegExp(String.raw`^["'‘“(\[]?\s*(?:and|but|so|yet)?\s*${marker}\b`)
}

function containsMarker(text: string, markers: string[]): boolean {
  const lower = text.toLowerCase()
  return markers.some((marker) => lower.includes(marker))
}

for (const marker of [...CONCLUSION_MARKERS, ...COUNTERARGUMENT_MARKERS]) {
  OPENER.set(marker, openerFor(marker))
}

export function hasSignificanceMarker(text: string): boolean {
  return containsMarker(text, SIGNIFICANCE_MARKERS)
}

/**
 * Everything after the paragraph's first sentence, or '' if it has only one.
 *
 * `firstSentence`/`afterFirstSentence` are deliberately NOT `splitSentences`
 * from `ai/sentenceSplit`, even though that is the better splitter. `npm test` runs these files through Node's type
 * stripping, whose ESM resolver rejects the extensionless relative imports this
 * codebase uses everywhere — so a module with a relative VALUE import cannot be
 * unit tested, which is why every existing tested module (`markdown.ts`,
 * `clipRects.ts`, `insertPoint.ts`) is a self-contained leaf. Keeping this one
 * a leaf is worth three lines of duplication; the alternative is that the role
 * heuristics ship untested. Do not "tidy" this into an import without checking
 * `npm test` still runs.
 *
 * The precision `splitSentences` adds — curly quotes, newline boundaries — buys
 * nothing here: paragraphs contain no newlines by construction, and this only
 * needs to know where to start looking for a lowercase connective, not to
 * produce exact spans.
 */
function afterFirstSentence(text: string): string {
  const rest = text.slice(firstSentence(text).length)
  // firstSentence() returns the whole text when there is no boundary, which
  // correctly yields '' here — a one-sentence paragraph has no warrant.
  return rest
}

/**
 * Whether a paragraph appears to explain its own evidence.
 *
 * The connective must appear outside the paragraph's FIRST sentence. A warrant
 * follows the thing it warrants, so "Because turnout fell, the result was
 * close." — a first-sentence connective — is the writer stating a claim, not
 * explaining evidence they have just presented. Without this rule every
 * paragraph opening with "Because" or "As a result" scored full marks for
 * reasoning it never did.
 */
export function hasWarrantMarker(paragraphText: string): boolean {
  return containsMarker(afterFirstSentence(paragraphText), WARRANT_MARKERS)
}

export interface HeuristicRoleInput {
  paragraphs: ParagraphSpan[]
  /** Detected claim ids per 1-based paragraph index. */
  claimsByParagraph: Map<number, string[]>
}

export interface HeuristicRoles {
  roles: ParagraphRole[]
  warranted: boolean[]
}

/**
 * Precedence is deliberate and worth reading in order. Explicit markers beat
 * position, because a writer who wrote "In conclusion" in paragraph 4 meant it,
 * and position beats claim presence, because the opening claim of an essay is
 * its thesis rather than one body claim among many.
 */
export function heuristicRoles({ paragraphs, claimsByParagraph }: HeuristicRoleInput): HeuristicRoles {
  const roles: ParagraphRole[] = []
  const warranted: boolean[] = []
  const lastIndex = paragraphs.length

  for (const paragraph of paragraphs) {
    const hasClaim = (claimsByParagraph.get(paragraph.index) ?? []).length > 0
    roles.push(roleFor(paragraph, hasClaim, lastIndex))
    warranted.push(hasWarrantMarker(paragraph.text))
  }

  return { roles, warranted }
}

function roleFor(paragraph: ParagraphSpan, hasClaim: boolean, lastIndex: number): ParagraphRole {
  const { text, index } = paragraph

  if (startsWithMarker(text, CONCLUSION_MARKERS)) return 'conclusion'
  if (startsWithMarker(text, COUNTERARGUMENT_MARKERS)) return 'counterargument'
  if (hasSignificanceMarker(text)) return 'significance'

  // An opening paragraph that asserts something is stating the essay's thesis.
  // An opening paragraph that asserts nothing is a hook or scene-setting, and
  // this heuristic cannot tell those apart from a missing thesis — so it says
  // 'unknown' rather than inventing either answer.
  if (index === 1) return hasClaim ? 'thesis' : 'unknown'

  // Deliberately NOT "the last paragraph is the conclusion". A draft that stops
  // mid-argument would score a free 10 points for a conclusion it doesn't have.
  // A real conclusion almost always announces itself, and the marker branch
  // above catches that.
  if (index === lastIndex && !hasClaim) return 'unknown'

  return hasClaim ? 'claim' : 'unknown'
}
