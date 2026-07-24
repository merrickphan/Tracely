import type { Source } from '@shared/types'
import { formatAuthorsMLA } from '../authorUtils'

export function format(source: Source): string {
  const authors = formatAuthorsMLA(source.authors)
  const title = source.title.replace(/\.$/, '')
  const venue = source.venue ? `${source.venue}, ` : ''
  const year = source.year ?? 'n.d.'
  const url = source.doi ? `https://doi.org/${source.doi}` : (source.url ?? '')

  const authorsClause = authors.endsWith('.') ? authors : `${authors}.`
  return `${authorsClause} "${title}." ${venue}${year}${url ? `, ${url}` : ''}.`.trim()
}
