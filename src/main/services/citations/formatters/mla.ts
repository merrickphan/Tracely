import type { Source } from '@shared/types'
import { formatAuthorsMLA } from '../authorUtils'
import { citationLocator } from '@shared/citationLocator'

export function format(source: Source): string {
  const authors = formatAuthorsMLA(source.authors)
  const title = source.title.replace(/\.$/, '')
  const venue = source.venue ? `${source.venue}, ` : ''
  const year = source.year ?? 'n.d.'
  // See shared/citationLocator.ts. MLA ends a book at publisher and year; it
  // does not ask for a DOI on one.
  const url = citationLocator(source) ?? ''
  const tail = `${venue}${year}${url ? `, ${url}` : ''}.`

  // MLA begins an unattributed work with its title. See authorUtils.
  if (authors === null) return `"${title}." ${tail}`.trim()

  const authorsClause = authors.endsWith('.') ? authors : `${authors}.`
  return `${authorsClause} "${title}." ${tail}`.trim()
}
