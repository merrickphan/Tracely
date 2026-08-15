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
  'critics of',
  'skeptics',
  'opponents',
  'detractors',
  'on the other hand',
  'admittedly',
  'granted',
  'to be fair',
  'conversely',
  'that said'
]

/**
 * "<someone> argue/contend/object that …" with a noun allowed in between.
 *
 * A literal list ('some argue', 'critics argue', 'one might argue') misses the
 * way people actually write the move: "Some INSTRUCTORS argue", "Critics of the
 * POLICY contend", "Many RESEARCHERS have objected". Tested against a draft
 * whose one well-executed counterargument opened "Some instructors argue that
 * …" and was silently missed — which then made the panel assert the draft had
 * no counterargument at all. A false negative here becomes a false accusation,
 * so it is worth more than a substring match.
 *
 * `[^.]{0,30}` cannot cross a sentence boundary, keeping this inside the same
 * clause as the subject.
 */
// Anchored at the sentence opening for the same reason the literal markers
// are: "The data, some argue, is thin" is the writer conceding a detail in
// passing, not a paragraph that turns to face an objection.
const COUNTERARGUMENT_PATTERN =
  /^["'‘“(\[]?\s*(?:and|but|so|yet)?\s*(some|many|others|critics|opponents|skeptics|sceptics|detractors|one)\b[^.]{0,30}?\b(argue|argued|contend|contends|object|objected|maintain|counter|claim)\b/

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
  'follows that',
  // Causal connectives that carry a warrant without announcing it in the
  // register a rubric expects. The list above is the vocabulary of an essay
  // that has been taught to signpost; these are how the same move is made in
  // formal expository prose, which is what a position paper is written in.
  //
  // Added after a nine-sentence MUN paragraph that reasons causally in almost
  // every sentence — "fear speaking out ... DUE TO risks to their livelihood",
  // "quality of life has decreased AS approximately 20% avoid travelling" —
  // scored 0 of 20 for warrant, because it never once wrote "therefore".
  //
  // 'due to' and 'owing to' are safe where a bare 'as' or 'since' would not be:
  // both are unambiguously causal, while "as" is more often temporal or
  // comparative ("as migration rose", "as many as 20%") and would fire on
  // nearly every paragraph ever written.
  'due to',
  'owing to',
  'leads to',
  'leading to',
  'results in',
  'resulting in',
  'gives rise to',
  'stems from',
  'driven by',
  'contributes to',
  'accounts for',
  'so that'
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
  // Built on demand rather than read out of a prebuilt map with `!`. The map
  // was populated from two of the four marker lists, so passing a third to
  // this function threw a TypeError from inside the structure engine — a
  // latent crash gated only on nobody adding a call site.
  return markers.some((marker) => {
    let re = OPENER.get(marker)
    if (!re) {
      re = openerFor(marker)
      OPENER.set(marker, re)
    }
    return re.test(opening)
  })
}

/**
 * One anchored matcher per marker, memoised on first use.
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

/**
 * Word-bounded, not a substring match.
 *
 * `lower.includes(marker)` was finding "thus" inside "enthusiasm",
 * "enthusiastic" and "enthusiast" — ordinary essay words. Any paragraph
 * containing one scored full marks for a reasoning connective it never used
 * (warrant is 20 of the 100 points) and had its `warrant-gap` weakness
 * suppressed, so the draft was told its reasoning was fine on the strength of
 * the word "enthusiasm".
 *
 * The plural/singular pairs already in these lists ("the implication" and
 * "the implications") stay correct: `\b` after the singular fails against the
 * "s", and the plural entry matches it instead.
 */
const CONTAINS = new Map<string, RegExp>()
function containsMarker(text: string, markers: string[]): boolean {
  const lower = text.toLowerCase()
  return markers.some((marker) => {
    let re = CONTAINS.get(marker)
    if (!re) {
      re = new RegExp(String.raw`\b${marker}\b`)
      CONTAINS.set(marker, re)
    }
    return re.test(lower)
  })
}

/** Same anchored opening as startsWithMarker, for the pattern form. */
function startsWithCounterargument(text: string): boolean {
  const opening = firstSentence(text).slice(0, 60).toLowerCase()
  return startsWithMarker(text, COUNTERARGUMENT_MARKERS) || COUNTERARGUMENT_PATTERN.test(opening)
}

/**
 * Attributed-source markers: "Mueller and Oppenheimer (2014)", "Ravizza et al.".
 *
 * Two or more in one paragraph is the signal, not one. A body paragraph that
 * makes a claim and cites a paper for it is a `claim` paragraph and should stay
 * one; a paragraph that is a RUN of attributions is presenting evidence, which
 * is the thing `evidence-stacking` looks for two of in a row.
 */
/**
 * The FALLBACK only. `heuristicRoles` takes a `hasCitation` predicate and the
 * real caller passes `hasInlineCitation` from `@shared/inlineCitation`, which
 * knows APA, MLA author-page, MLA title, Chicago, numeric, DOI and URL forms.
 *
 * This pattern was the sole detector until it was traced on a real MUN position
 * paper and found **0 of 5** citations in it: it requires the year to sit alone
 * inside the bracket, so `(Tyche Hendricks, 2024)` fails, and it needs a year at
 * all, so the three MLA title citations — `("Background to the Convention")` —
 * fail too. With the count stuck at 0 the `evidence` role below could never be
 * returned, which in turn made `warrant` unearnable and left `evidence-stacking`
 * in weaknesses.ts unreachable.
 *
 * It survives only because this module must stay a leaf `npm test` can load
 * (see afterFirstSentence), so it cannot value-import the shared detector
 * itself. Injection keeps the good one in production and the tests running.
 */
const FALLBACK_CITATION_PATTERN = /\((?:[12]\d{3}[a-z]?)\)|\bet al\b/g

export type CitationPredicate = (sentence: string) => boolean

function fallbackHasCitation(sentence: string): boolean {
  FALLBACK_CITATION_PATTERN.lastIndex = 0
  return FALLBACK_CITATION_PATTERN.test(sentence)
}

/**
 * How many of the paragraph's sentences carry a citation.
 *
 * Per SENTENCE, not per regex match. The old count matched patterns anywhere in
 * the paragraph, so one sentence citing two papers looked like two pieces of
 * evidence; what `evidence-stacking` is actually looking for is a RUN of
 * attributed sentences.
 */
function citationCount(text: string, hasCitation: CitationPredicate): number {
  return text
    .split(/(?<=[.!?]["'’”)\]]*)\s+/)
    .filter((sentence) => sentence.trim().length > 0 && hasCitation(sentence)).length
}

const MIN_CITATIONS_FOR_EVIDENCE = 2

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
  /**
   * How to tell whether a sentence carries a citation. `analyzeStructure`
   * passes the shared detector; omitting it falls back to the weak local
   * pattern, which is why the fallback is documented as a liability.
   */
  hasCitation?: CitationPredicate
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
export function heuristicRoles({
  paragraphs,
  claimsByParagraph,
  hasCitation = fallbackHasCitation
}: HeuristicRoleInput): HeuristicRoles {
  const roles: ParagraphRole[] = []
  const warranted: boolean[] = []
  const lastIndex = paragraphs.length

  for (const paragraph of paragraphs) {
    const hasClaim = (claimsByParagraph.get(paragraph.index) ?? []).length > 0
    roles.push(roleFor(paragraph, hasClaim, lastIndex, hasCitation))
    warranted.push(hasWarrantMarker(paragraph.text))
  }

  return { roles, warranted }
}

function roleFor(
  paragraph: ParagraphSpan,
  hasClaim: boolean,
  lastIndex: number,
  hasCitation: CitationPredicate
): ParagraphRole {
  const { text, index } = paragraph

  if (startsWithMarker(text, CONCLUSION_MARKERS)) return 'conclusion'
  if (startsWithCounterargument(text)) return 'counterargument'
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

  // Before the claim branch, because a run of attributions is evidence even
  // when claim detection flags the findings inside it as assertions — which it
  // does, since "X found that Y" is a checkable statement.
  //
  // Without this branch `roleFor` could never return 'evidence' at all, and
  // `evidence-stacking` in weaknesses.ts was unreachable dead code on the
  // heuristic path. Found by tracing a draft written to trigger it.
  if (citationCount(text, hasCitation) >= MIN_CITATIONS_FOR_EVIDENCE) return 'evidence'

  return hasClaim ? 'claim' : 'unknown'
}
