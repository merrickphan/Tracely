import { hasInlineCitation, sentenceAround } from './inlineCitation.ts'

/**
 * Is this sentence covered by a citation, even if it does not carry one itself?
 *
 * `hasInlineCitationNear` answers a narrower question — does THIS sentence
 * contain a citation — and stops hard at the sentence boundary so a neighbour's
 * citation cannot be borrowed. That is the right rule for "did the writer cite
 * here", and the wrong one for "does this sentence need a citation", which is
 * what the card actually asks. Real prose attributes once and then carries the
 * attribution:
 *
 *   Smith (2020) found that turnout fell nine points. Furthermore, she argues
 *   the effect concentrated among first-time voters.
 *
 * The second sentence has no citation and needs none; a reader knows exactly
 * whose finding it is. Told to "add a citation" there, a writer who has cited
 * properly learns the tool cannot read citations — and then discounts every
 * other thing it says.
 *
 * Scope is the PARAGRAPH, and it runs in both directions:
 *
 *  - **Backward**, but only with attributive continuity. A citation earlier in
 *    the paragraph covers a later sentence that carries the attribution
 *    forward — by naming the source again, or by a reporting verb whose subject
 *    points back at it ("she argues", "the study found", "it also notes").
 *    Without that link the sentence has left the source behind: "Meanwhile,
 *    global temperatures rose 1.2°C" is a new claim owing its own citation, and
 *    the fact that something three sentences ago was cited says nothing about
 *    it.
 *  - **Forward**, unconditionally. A citation at the END of a passage covers
 *    the sentences leading to it — writers routinely state an idea across two
 *    or three sentences and cite once at the close. Nothing in that pattern
 *    signals continuity in advance, so requiring a cue would defeat it.
 *
 * The asymmetry is deliberate and matches `inlineCitation`'s own stance: a
 * false positive here hides one card, while a false negative accuses a writer
 * of missing a citation they actually wrote. When scope is arguable, this
 * answers "covered".
 *
 * This changes what the CARD says, not what the mark means. `problemKindsFor`
 * takes the result as `hasInlineCitation`, so a sentence in scope moves from
 * 'missing-citation' to 'cited-unverified' — both amber, so the underline looks
 * identical and only the wording changes, which is the whole intent. A sentence
 * whose evidence is thin is still flagged; it is just no longer told to add a
 * citation it already has.
 */

/**
 * Attribution carried forward from an earlier sentence.
 *
 * A reporting verb is the signal — the writer is still reporting someone
 * else's finding rather than asserting their own. Anaphoric subjects ("she",
 * "they", "the study", "the report", "the authors") and additive connectives
 * ("furthermore", "moreover", "in addition") are what make it a continuation
 * rather than a fresh attribution.
 *
 * A bare pronoun with no reporting verb does NOT continue an attribution: "She
 * was born in 1929" is the writer's own assertion about the subject, not a
 * report of what a source said.
 */
const REPORTING_VERB =
  '(?:argues?|argued|claims?|claimed|contends?|found|finds?|notes?|noted|observes?|observed|reports?|reported|states?|stated|says?|said|writes?|wrote|shows?|showed|suggests?|suggested|concludes?|concluded|adds?|added|explains?|explained|maintains?|describes?|described|estimates?|estimated)'

const ANAPHOR = '(?:he|she|they|it|the (?:study|report|paper|article|author|authors|research|survey|data|findings?|work))'

const CONTINUATION_PATTERNS: RegExp[] = [
  // "Furthermore, she argues …" / "Moreover the study found …"
  new RegExp(
    `\\b(?:furthermore|moreover|additionally|in addition|also|further|similarly|likewise|again)\\b[^.]{0,40}?\\b${REPORTING_VERB}\\b`,
    'i'
  ),
  // "She argues …" / "The study found …" — the anaphor at the sentence opening.
  new RegExp(`^["'“‘(]?\\s*(?:and\\s+|but\\s+|yet\\s+)?${ANAPHOR}\\s+(?:\\w+\\s+){0,2}?${REPORTING_VERB}\\b`, 'i'),
  // "According to the same report …" — an attribution with no parenthetical.
  // Counts on its own, per the owner's call: it still tells the reader where
  // the material came from, which is what a citation is for.
  /\baccording to\b/i,
  // A named source with a reporting verb but no year: "Smith further argues".
  // The yearless shape `inlineCitation` deliberately refuses, because there it
  // would be a false CITATION; here it is only evidence of continuity.
  new RegExp(`\\b\\p{Lu}[\\p{L}'’-]+\\s+(?:\\w+\\s+){0,2}?${REPORTING_VERB}\\b`, 'u')
]

export function carriesAttribution(sentence: string): boolean {
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(sentence.trim()))
}

/** Paragraph bounds around `offset`. Paragraphs are separated by newline runs,
 *  the same boundary `shared/paragraphSplit.ts` uses. */
function paragraphAround(text: string, offset: number): { start: number; end: number } {
  const before = text.lastIndexOf('\n', Math.max(0, offset - 1))
  const after = text.indexOf('\n', offset)
  return { start: before === -1 ? 0 : before + 1, end: after === -1 ? text.length : after }
}

/**
 * Splits a paragraph into sentences with their offsets, so a caller can tell
 * which side of the claim each one falls on.
 *
 * Deliberately simple: the precision `sentenceAround` needs (URLs, footnote
 * marks, abbreviations) matters when the goal is to hand a pattern the exact
 * text of one sentence. Here the goal is only to order sentences relative to
 * the claim, and a split that occasionally cuts a URL in half changes nothing
 * about which side of the claim the pieces sit on.
 */
function sentencesWithOffsets(paragraph: string, base: number): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = []
  const re = /[^.!?]+[.!?]*["'’”)\]]*\s*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(paragraph)) !== null) {
    if (match[0].trim().length === 0) continue
    out.push({ text: match[0], start: base + match.index, end: base + match.index + match[0].length })
  }
  return out
}

/**
 * Whether the claim at [start, end) is covered by a citation in its paragraph.
 *
 * Pass the WHOLE document text — paragraph bounds are found from it.
 */
export function isCitedInScope(text: string, start: number, end: number): boolean {
  // Its own sentence first: the cheap, unambiguous case.
  if (hasInlineCitation(sentenceAround(text, start, end))) return true

  const paragraph = paragraphAround(text, start)
  const sentences = sentencesWithOffsets(text.slice(paragraph.start, paragraph.end), paragraph.start)

  let sawCitationBefore = false
  for (const sentence of sentences) {
    const isBefore = sentence.end <= start
    const isAfter = sentence.start >= end

    if (isBefore) {
      if (hasInlineCitation(sentence.text)) sawCitationBefore = true
      continue
    }

    // A citation anywhere later in the paragraph covers this sentence: the
    // writer stated the idea and cited at the close.
    if (isAfter && hasInlineCitation(sentence.text)) return true
  }

  // Backward scope needs the sentence to carry the attribution forward.
  if (sawCitationBefore && carriesAttribution(sentenceAround(text, start, end))) return true

  return false
}
