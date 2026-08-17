import type { CitationStyle } from '@shared/types'

/**
 * What the citation flow's popover says, at each of its steps.
 *
 * Shared for the same reason `problemCopy.ts` is: the flow now runs on BOTH
 * surfaces — over Tracely's own document editor and over whatever window Screen
 * Watch is watching — from the same four Figma frames ("Find a Source
 * (Searching)", "Find a Source (Results)", "Add Citation (Choose Source)", "Add
 * Citation (Inserted)"). Two copies of these strings would be two products: the
 * same step would read one way in the app and another over Word, and whichever
 * copy was edited second would drift.
 *
 * Pure text — no JSX and no colours. The two surfaces render very differently
 * (the overlay is inline styles in its own window, the editor is `.docmark-*`
 * classes from index.css), so they share the wording and not the markup.
 */

/** The design labels a style with its edition, not just its name. */
export const CITATION_STYLE_LABEL: Record<CitationStyle, string> = {
  APA: 'APA 7',
  MLA: 'MLA 9',
  Chicago: 'Chicago 17'
}

/**
 * Enough of the claim to recognise it, cut on a word boundary.
 *
 * Trailing sentence punctuation always comes off, because every use here nests
 * the result inside quotes in a sentence of our own — leaving it produces
 * `supports "the claim.".`, which is what the first version rendered.
 */
export function truncateClaim(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '')
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, '')}…`
}

/** "Find a Source (Searching)" — 294:343. */
export function searchingBody(claimText: string): string {
  return `Scanning open-access journals and databases for a source that supports “${truncateClaim(claimText)}.”`
}

/** "Find a Source (Results)" — 295:349. Titled with the count, not the action. */
export function resultsTitle(count: number): string {
  return `${count} source${count === 1 ? '' : 's'} found`
}

/**
 * "supports", never "proves".
 *
 * The percentage beside each row is `relevanceScore` — how directly a source
 * bears on the sentence. It is not a probability that the source establishes
 * it, and a word that implied it would be the card overstating its own search.
 */
export function resultsBody(claimText: string): string {
  return `Ranked by how directly each source supports “${truncateClaim(claimText)}.”`
}

export function emptyResultsBody(claimText: string): string {
  return (
    `Nothing in the open-access databases came back for “${truncateClaim(claimText)}.” ` +
    'That does not make the claim wrong — it means there is nothing here to cite for it yet.'
  )
}

/**
 * "Add Citation (Inserted)" — 298:130.
 *
 * Names the STYLE, not the marker: the marker is already visible in the
 * sentence behind the card, so printing it says nothing the document does not,
 * while the style is the one decision the writer made whose result they cannot
 * see from where they are standing.
 */
export function insertedBody(style: CitationStyle): string {
  return `This claim is now backed by a source in your document. ${CITATION_STYLE_LABEL[style]} in-text citation inserted.`
}

/**
 * The label over the entry in the confirmation card — Figma 298:136 reads
 * "ADDED TO WORKS CITED", and until the editor grew a real works-cited section
 * that was the card asserting something the document could not back up.
 *
 * Three answers rather than one, because there are three outcomes and the frame
 * only drew the happy one. Citing a source for a second sentence is ordinary —
 * every style lists a work once — and saying "added" there would report a
 * second entry that is deliberately not written. `failed` is the honest read of
 * a document whose text moved on between the search and the insert: the marker
 * went in, the list did not, and a card claiming otherwise sends the writer to
 * hand in an essay whose references are short by one.
 *
 * Only the editor uses this. Screen Watch writes into another application's
 * window through UIA, owns no document, and cannot add anything to a list.
 */
export function worksCitedLabel(status: 'added' | 'already-listed' | 'failed'): string {
  if (status === 'added') return 'ADDED TO WORKS CITED'
  if (status === 'already-listed') return 'ALREADY IN WORKS CITED'
  return 'NOT ADDED TO WORKS CITED'
}

/** Said under the entry only when it could not be written — never silently. */
export const WORKS_CITED_FAILED_NOTE =
  'The in-text citation went in, but the reference list could not be updated — add this line to it yourself.'

/**
 * The same confirmation, said by Screen Watch, where half of it is not true.
 *
 * The editor owns its document and now really does append the reference, so
 * `insertedBody` + `worksCitedLabel` describe two writes that happened. Over
 * another application the overlay writes the in-text marker through UIA and
 * nothing else: it has no document, keeps no state between polls, and cannot
 * see — let alone edit — whatever reference list that window may or may not
 * have. It said "ADDED TO WORKS CITED" over an entry it had added to nothing,
 * which is the most quietly damaging thing this card could do: a student who
 * believes it hands in an essay whose references are short by one, and finds
 * out from a marker.
 *
 * So the marker is reported as inserted, because it was, and the entry is
 * handed over as work still to do rather than as work already done.
 */
export function insertedBodyExternal(style: CitationStyle): string {
  return (
    `${CITATION_STYLE_LABEL[style]} in-text citation inserted. Tracely cannot edit that document's reference ` +
    'list, so the entry below is not in it yet.'
  )
}

/** Reads as an instruction, not a receipt. See `insertedBodyExternal`. */
export const EXTERNAL_REFERENCE_LABEL = 'ADD THIS TO YOUR REFERENCE LIST'

/**
 * The monogram tile's letters: an acronym for a multi-word venue, else the
 * first two letters of whatever name there is.
 *
 * A tile rather than a favicon, and only on this surface. The overlay can show
 * the real site icon because main fetches one (search/favicon.ts) and hands it
 * over as a data: URI; nothing on the persisted `Source` the editor holds
 * carries one, and adding a fetch here would widen this window's network
 * surface for decoration.
 */
export function sourceInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
  }
  return (words[0] ?? name).slice(0, 2).toUpperCase()
}

/** The "Claim resolved · N flags left" line's second half. */
export function flagsLeft(count: number): string {
  return `${count} flag${count === 1 ? '' : 's'} left in this document`
}
