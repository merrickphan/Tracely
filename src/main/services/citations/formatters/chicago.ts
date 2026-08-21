import type { Source } from '@shared/types'
import { formatAuthorsChicago } from '../authorUtils'
import { citationLocator } from '@shared/citationLocator'
import { containerPrefix, endTitle } from '@shared/citationTitle'

export function format(source: Source): string {
  const authors = formatAuthorsChicago(source.authors)
  // "n.d." already ends in a period, and Chicago follows the year with one —
  // so an undated source printed `"Title." n.d.. Venue.` Seen on a real
  // reference list. The same doubling is guarded for authors two lines down.
  const rawYear = source.year === null || source.year === undefined ? 'n.d.' : String(source.year)
  const year = rawYear.endsWith('.') ? rawYear.slice(0, -1) : rawYear
  // Same doubling the `n.d.` guard above exists for, one field over: the
  // period goes inside the quotes, so a title ending in "?" must not gain one.
  const title = endTitle(source.title)
  // "In" for a chapter — Chicago marks the container, and without it an edited
  // book's title sits in the slot a journal name occupies.
  const venue = source.venue ? ` ${containerPrefix(source.venueType)}${source.venue}.` : ''
  // See shared/citationLocator.ts. Chicago ends a book at publisher and year.
  const locator = citationLocator(source)
  const url = locator ? ` ${locator}.` : ''

  // Chicago begins an unattributed work with its title. See authorUtils.
  if (authors === null) return `"${title}" ${year}.${venue}${url}`.trim()

  const authorsClause = authors.endsWith('.') ? authors : `${authors}.`
  return `${authorsClause} ${year}. "${title}"${venue}${url}`.trim()
}
