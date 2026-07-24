import type { Author } from '@shared/types'

const ET_AL_THRESHOLD = 3

function initials(given: string | undefined): string {
  if (!given) return ''
  return given
    .trim()
    .split(/\s+/)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(' ')
}

/** "Family, F. M." */
function apaSingle(author: Author): string {
  const init = initials(author.given)
  return init ? `${author.family}, ${init}` : author.family
}

export function formatAuthorsAPA(authors: Author[]): string {
  if (authors.length === 0) return 'Unknown Author'
  if (authors.length === 1) return apaSingle(authors[0])

  if (authors.length > ET_AL_THRESHOLD) {
    return `${apaSingle(authors[0])}, et al.`
  }

  const formatted = authors.map(apaSingle)
  const last = formatted.pop()
  return `${formatted.join(', ')}, & ${last}`
}

/** "Family, First" for the lead author, "First Family" for the rest. */
function mlaFull(author: Author, isFirst: boolean): string {
  if (!author.given) return author.family
  return isFirst ? `${author.family}, ${author.given}` : `${author.given} ${author.family}`
}

export function formatAuthorsMLA(authors: Author[]): string {
  if (authors.length === 0) return 'Unknown Author'
  if (authors.length === 1) return mlaFull(authors[0], true)
  if (authors.length === 2) return `${mlaFull(authors[0], true)}, and ${mlaFull(authors[1], false)}`
  return `${mlaFull(authors[0], true)}, et al.`
}

export function formatAuthorsChicago(authors: Author[]): string {
  if (authors.length === 0) return 'Unknown Author'
  if (authors.length === 1) return mlaFull(authors[0], true)
  if (authors.length > ET_AL_THRESHOLD) return `${mlaFull(authors[0], true)}, et al.`

  const formatted = authors.map((a, i) => mlaFull(a, i === 0))
  const last = formatted.pop()
  return `${formatted.join(', ')}, and ${last}`
}
