import type { Source } from '@shared/types'
import { formatAuthorsAPA } from '../authorUtils'

export function format(source: Source): string {
  const authors = formatAuthorsAPA(source.authors)
  const year = source.year ?? 'n.d.'
  const title = source.title.replace(/\.$/, '')
  const venue = source.venue ? ` ${source.venue}.` : ''
  const url = source.doi ? ` https://doi.org/${source.doi}` : source.url ? ` ${source.url}` : ''

  // No named author: the TITLE takes the author position, which is what APA
  // prescribes for an unattributed work. Never a placeholder — see authorUtils.
  if (authors === null) return `${title}. (${year}).${venue}${url}`.trim()

  return `${authors} (${year}). ${title}.${venue}${url}`.trim()
}
