/**
 * The evidence list a critique reasons over, with the writer's OWN source first.
 *
 * Why this exists
 * ---------------
 * Until now the critique judged a claim against whatever a topical search
 * returned. For an uncited sentence that is the only thing available and it is
 * the right list. For a sentence that CITES something it is the wrong list, and
 * wrong in a way that reads as incompetence: the writer named a source, and
 * Tracely answered by weighing their sentence against eight other papers that
 * happen to be about the subject — never once looking at the one they pointed
 * at. A student who cited correctly and got "not supported by the evidence"
 * learns that the tool does not read citations.
 *
 * So when a reference resolves (see referenceCheck.ts, which already goes and
 * finds the work), that work goes in at slot 1 under `CITED_SOURCE_MARKER`, and
 * the relay's Pass 3 is instructed to check the claim against it FIRST and only
 * fall through to the searched sources when it cannot answer.
 *
 * What this can and cannot do
 * ---------------------------
 * Tracely cannot read a source's full text — nothing in the app can. What an
 * index returns is metadata and, usually, an abstract. So "check it against the
 * source they cited" honestly means *does this work exist, and does its abstract
 * bear the claim out*; it does not and cannot mean *does page 14 say this*. That
 * limit is already stated to users in problemCopy.ts ("Tracely cannot read the
 * source you cited") and it is not softened here — the relay prompt says the
 * same thing to the model, because a model shown an abstract and asked to
 * confirm a page-level figure will confabulate the confirmation.
 *
 * Cost is deliberately FLAT. The cited source takes one of the existing
 * `MAX_CRITIQUE_EVIDENCE_ITEMS` slots rather than being added on top, so a
 * critique over a cited claim sends the same number of items — and roughly the
 * same input length — as one over an uncited claim. The most expensive call in
 * the product does not get more expensive for reading the citation.
 *
 * A leaf, with no value imports, so `npm test` can load it: the numbering and
 * the slot arithmetic are exactly the kind of thing that is wrong by one and
 * silently changes which sources the model sees.
 */

export interface CritiqueSource {
  title: string
  abstract: string | null
  /**
   * Only rendered for the cited source. The searched ones are identified by
   * their number, and a year on each would spend abstract budget on nothing;
   * on the cited one it is how the model tells the work the writer named from
   * a same-titled other edition.
   */
  year?: number | null
}

/**
 * What marks slot 1 as the writer's own source.
 *
 * The relay's Pass 3 keys on this exact string, so it is defined once, here,
 * and mirrored in a comment in the relay's prompt rather than retyped. Written
 * as a label rather than as an instruction: everything in `evidenceSummary` is
 * data the model is shown, and prose telling it what to do belongs in the
 * system prompt where a future change can find it.
 */
export const CITED_SOURCE_MARKER = '[CITED BY THE WRITER]'

export const NO_EVIDENCE_SUMMARY = 'No supporting evidence was found.'

/**
 * A hard slice(0, N) can land mid-word or mid-fact ("...reduced mortality by 4"
 * instead of "...by 47%"), feeding the model a truncated number right before
 * asking it to fact-check numbers — cutting at the last whitespace before the
 * limit costs a few characters but never severs a word.
 */
export function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…'
}

function line(index: number, source: CritiqueSource, marker: string | null, maxAbstractChars: number): string {
  const year = source.year == null ? '' : ` (${source.year})`
  const abstract = source.abstract ? ` — ${truncateAtWordBoundary(source.abstract, maxAbstractChars)}` : ''
  return `${index}. ${marker ? `${marker} ` : ''}${source.title}${year}${abstract}`
}

/**
 * The numbered evidence list, cited source first when there is one.
 *
 * `cited` is null whenever the sentence named no source, named one the check
 * cannot cover, or named one no index could find. All three are different facts
 * about the citation and none of them is "the writer cited this work" — which
 * is the only thing that earns slot 1. The reference lookup reports those cases
 * separately, in its own section; this function stays silent about them so a
 * failed lookup can never arrive as evidence.
 *
 * Slots are shared, not added to: `maxItems` bounds the whole list.
 */
export function buildEvidenceSummary(
  cited: CritiqueSource | null,
  searched: CritiqueSource[],
  { maxItems, maxAbstractChars }: { maxItems: number; maxAbstractChars: number }
): string {
  if (maxItems <= 0) return NO_EVIDENCE_SUMMARY

  const lines: string[] = []
  if (cited) lines.push(line(1, cited, CITED_SOURCE_MARKER, maxAbstractChars))

  for (const source of searched.slice(0, maxItems - lines.length)) {
    lines.push(line(lines.length + 1, source, null, maxAbstractChars))
  }

  return lines.length === 0 ? NO_EVIDENCE_SUMMARY : lines.join('\n')
}

/**
 * How many searched sources may still be sent once the cited one has its slot.
 *
 * Exported because the CACHE KEY is built from the sources actually sent, not
 * from the raw list — see critique.ts. Two claims whose search returned the
 * same first four papers, one of which also cited a resolvable work, are
 * different requests, and deriving the cut in two places is how they would
 * come to share one cached critique.
 */
export function searchedSlots(hasCited: boolean, maxItems: number): number {
  return Math.max(0, maxItems - (hasCited ? 1 : 0))
}
