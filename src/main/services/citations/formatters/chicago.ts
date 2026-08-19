import type { Source } from '@shared/types'
import { formatAuthorsChicago } from '../authorUtils'

export function format(source: Source): string {
  const authors = formatAuthorsChicago(source.authors)
  const year = source.year ?? 'n.d.'
  const title = source.title.replace(/\.$/, '')
  const venue = source.venue ? ` ${source.venue}.` : ''
  const url = source.doi ? ` https://doi.org/${source.doi}.` : source.url ? ` ${source.url}.` : ''

  // Chicago begins an unattributed work with its title. See authorUtils.
  if (authors === null) return `"${title}." ${year}.${venue}${url}`.trim()

  const authorsClause = authors.endsWith('.') ? authors : `${authors}.`
  return `${authorsClause} ${year}. "${title}."${venue}${url}`.trim()
}
