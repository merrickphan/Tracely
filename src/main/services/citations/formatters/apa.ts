import type { Source } from '@shared/types'
import { formatAuthorsAPA } from '../authorUtils'
import { citationLocator } from '@shared/citationLocator'
import { containerPrefix, endTitle } from '@shared/citationTitle'

export function format(source: Source): string {
  const authors = formatAuthorsAPA(source.authors)
  const year = source.year ?? 'n.d.'
  // Carries its own terminal period, so nothing below appends one — a title
  // ending in "?" keeps the question mark instead of gaining `?.`.
  const title = endTitle(source.title)
  // "In" for a chapter, so the book's title cannot be read as a journal name.
  const venue = source.venue ? ` ${containerPrefix(source.venueType)}${source.venue}.` : ''
  // By source TYPE, not "DOI if there is one" — see shared/citationLocator.ts.
  // A book has no locator in any style, and 95% of retrieved sources carry a
  // DOI, so the old rule ended every line of every reference list in doi.org.
  const locator = citationLocator(source)
  const url = locator ? ` ${locator}` : ''

  // No named author: the TITLE takes the author position, which is what APA
  // prescribes for an unattributed work. Never a placeholder — see authorUtils.
  if (authors === null) return `${title} (${year}).${venue}${url}`.trim()

  return `${authors} (${year}). ${title}${venue}${url}`.trim()
}
