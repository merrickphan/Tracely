import type { VenueType } from './types.ts'

/**
 * How a reader is told where to FIND a source — and when they are told nothing.
 *
 * All three formatters used to end the same way: `source.doi ? doi.org link :
 * source.url`. With 494 of 518 retrieved sources carrying a DOI, that meant
 * every line of every reference list ended in `https://doi.org/10.…`, whatever
 * the work was. Owner, 2026-08-19: *"can you make it so the citations at the
 * bottom of paragraphs when you insert citation is not all Doi?"*
 *
 * They are right, and it is a style error rather than a preference. A DOI is
 * the locator for an ARTICLE. A book is located by its publisher, and no style
 * asks for a DOI on one — Chicago and MLA both end a book at publisher and
 * year. A works cited page for a history essay in which every entry ends in a
 * doi.org URL is a page that announces it was generated.
 *
 * ── What the styles actually ask for ───────────────────────────────────────
 * APA 7, MLA 9 and Chicago agree on the article case: give the DOI, as an
 * https://doi.org/ link. They agree a web source needs its URL, and that a book
 * needs neither. So one rule serves all three, and the styles differ only in
 * punctuation — which is where they already differed.
 *
 * ── Precision over decoration ──────────────────────────────────────────────
 * `other` and a null venue type fall through to the URL rather than to nothing.
 * A source Tracely could not classify is one a reader may well need a link to,
 * and a missing locator is the harder problem: an unfamiliar title with no link
 * cannot be checked at all.
 *
 * A leaf with a type-only import.
 */

/** Venue types whose canonical locator is the DOI. */
const ARTICLE: ReadonlySet<VenueType> = new Set<VenueType>([
  'journal',
  'preprint',
  'conference',
  // A statistical series is published at a stable identifier and cited like an
  // article rather than like a book.
  'dataset'
])

/**
 * Venue types that carry no locator at all.
 *
 * A book is found by author, title and publisher; that is what a reference list
 * entry for one is FOR, and no style asks for a DOI on one.
 *
 * `reference` is deliberately NOT here. A tertiary work is usually read online
 * — MLA and Chicago both want the publisher's page for one — so it takes its
 * URL. What it must never take is the DOI: the identifier a database mints for
 * a single dictionary entry is an artifact of that database, not the address a
 * reader would look up. An Oxford DNB entry ends at oxforddnb.com or at
 * nothing.
 */
const UNLOCATED: ReadonlySet<VenueType> = new Set<VenueType>(['book'])

export interface LocatableSource {
  doi: string | null
  url: string | null
  venueType: VenueType | null
}

/**
 * A DOI as the bare `10.xxxx/yyyy` registrant string.
 *
 * Providers return it three ways — bare, `doi:`-prefixed, and as a full
 * resolver URL — and the formatters concatenated whatever arrived onto
 * `https://doi.org/`, which yields `https://doi.org/https://doi.org/10.1044/…`
 * for any provider using the third form.
 */
export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
}

/**
 * The locator to print, or null for none.
 *
 * A bare string — no leading space, no trailing period — because the three
 * styles punctuate it differently and each formatter already owns its own
 * punctuation.
 */
export function citationLocator(source: LocatableSource): string | null {
  const venueType = source.venueType
  const doi = source.doi?.trim() ? `https://doi.org/${normalizeDoi(source.doi)}` : null
  const url = source.url?.trim() || null

  if (venueType !== null && UNLOCATED.has(venueType)) return null
  if (venueType !== null && ARTICLE.has(venueType)) return doi ?? url
  // A reference work takes its publisher page or nothing — never a DOI. See
  // UNLOCATED above for why the identifier is the wrong thing here.
  if (venueType === 'reference') return url

  // 'other', or a type nothing established. A link is what makes an unfamiliar
  // title checkable, so prefer the page a reader can open over an identifier
  // they would have to resolve first — but an identifier beats no locator.
  return url ?? doi
}
