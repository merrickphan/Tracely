import type { Author } from '@shared/types'

/**
 * An author list with nobody in it returns null, and every formatter moves the
 * TITLE into the author slot instead.
 *
 * It used to return the literal string 'Unknown Author', which is not a
 * citation in any style — it is a placeholder that reads to a marker exactly
 * like an invented source. Owner, 2026-08-19: *"We should never put 'Unknown
 * Author' in a citation."* Right, and it had already cost real damage: the same
 * string in a draft's reference list made `referenceCheck` search Crossref for
 * an author called "Author", find nothing, and the critique called three true
 * sentences fabricated.
 *
 * Title-first rather than refusing to format, because that is what APA, MLA and
 * Chicago all actually prescribe for a work with no named author — an
 * unattributed report, a database entry, an anonymous pamphlet. The citation
 * that comes out is correct and usable, which is better than a skipped one.
 */

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

export function formatAuthorsAPA(authors: Author[]): string | null {
  if (authors.length === 0) return null
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

export function formatAuthorsMLA(authors: Author[]): string | null {
  if (authors.length === 0) return null
  if (authors.length === 1) return mlaFull(authors[0], true)
  if (authors.length === 2) return `${mlaFull(authors[0], true)}, and ${mlaFull(authors[1], false)}`
  return `${mlaFull(authors[0], true)}, et al.`
}

export function formatAuthorsChicago(authors: Author[]): string | null {
  if (authors.length === 0) return null
  if (authors.length === 1) return mlaFull(authors[0], true)
  if (authors.length > ET_AL_THRESHOLD) return `${mlaFull(authors[0], true)}, et al.`

  const formatted = authors.map((a, i) => mlaFull(a, i === 0))
  const last = formatted.pop()
  return `${formatted.join(', ')}, and ${last}`
}
