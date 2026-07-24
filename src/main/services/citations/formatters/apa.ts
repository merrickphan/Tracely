import type { Source } from '@shared/types'
import { formatAuthorsAPA } from '../authorUtils'

export function format(source: Source): string {
  const authors = formatAuthorsAPA(source.authors)
  const year = source.year ?? 'n.d.'
  const title = source.title.replace(/\.$/, '')
  const venue = source.venue ? ` ${source.venue}.` : ''
  const url = source.doi ? ` https://doi.org/${source.doi}` : source.url ? ` ${source.url}` : ''

  return `${authors} (${year}). ${title}.${venue}${url}`.trim()
}
