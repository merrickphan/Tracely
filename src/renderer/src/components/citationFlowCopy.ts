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

/** The "Claim resolved · N flags left" line's second half. */
export function flagsLeft(count: number): string {
  return `${count} flag${count === 1 ? '' : 's'} left in this document`
}
