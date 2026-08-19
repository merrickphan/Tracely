import type { Source } from '@shared/types'
import { formatAuthorsMLA } from '../authorUtils'

export function format(source: Source): string {
  const authors = formatAuthorsMLA(source.authors)
  const title = source.title.replace(/\.$/, '')
  const venue = source.venue ? `${source.venue}, ` : ''
  const year = source.year ?? 'n.d.'
  const url = source.doi ? `https://doi.org/${source.doi}` : (source.url ?? '')
  const tail = `${venue}${year}${url ? `, ${url}` : ''}.`

  // MLA begins an unattributed work with its title. See authorUtils.
  if (authors === null) return `"${title}." ${tail}`.trim()

  const authorsClause = authors.endsWith('.') ? authors : `${authors}.`
  return `${authorsClause} "${title}." ${tail}`.trim()
}
