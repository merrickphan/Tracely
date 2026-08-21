import type { Source } from '@shared/types'
import { formatAuthorsMLA } from '../authorUtils'
import { citationLocator } from '@shared/citationLocator'
import { endTitle } from '@shared/citationTitle'

export function format(source: Source): string {
  const authors = formatAuthorsMLA(source.authors)
  // The terminal mark belongs INSIDE the quotes in MLA, which is why the
  // period is part of the title rather than appended after the closing quote.
  // MLA 9 names a chapter's container without "In", unlike APA and Chicago.
  const title = endTitle(source.title)
  const venue = source.venue ? `${source.venue}, ` : ''
  const year = source.year ?? 'n.d.'
  // See shared/citationLocator.ts. MLA ends a book at publisher and year; it
  // does not ask for a DOI on one.
  const url = citationLocator(source) ?? ''
  const tail = `${venue}${year}${url ? `, ${url}` : ''}.`

  // MLA begins an unattributed work with its title. See authorUtils.
  if (authors === null) return `"${title}" ${tail}`.trim()

  const authorsClause = authors.endsWith('.') ? authors : `${authors}.`
  return `${authorsClause} "${title}" ${tail}`.trim()
}
