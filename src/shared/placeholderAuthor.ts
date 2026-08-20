import type { Author } from './types.ts'

/**
 * An "author" that is a placeholder rather than a person.
 *
 * `formatAuthors*` returns null for an EMPTY author list, and every formatter
 * moves the title into the author slot when it does — which is what APA, MLA
 * and Chicago all prescribe for an unattributed work. That fix assumed the
 * placeholder case arrives as an empty array.
 *
 * It does not. Measured on the owner's database, 2026-08-19, the providers
 * return the placeholder AS AN AUTHOR:
 *
 *     [{"family":"Unknown"}]
 *     [{"given":"Unknown","family":"Author"}]
 *     [{"given":"David","family":"Griffiths"},{"family":"Unknown"}]
 *
 * So the list was non-empty, the formatters treated it as a real name, and
 * "Unknown Author (2025)" went into a student's reference list — which reads to
 * a marker exactly like an invented source. Owner: *"Please never cite 'unknown
 * author' again."*
 *
 * ── Anonymous is NOT a placeholder ─────────────────────────────────────────
 * "Anonymous" is a real, deliberate attribution with a defined meaning in every
 * style guide, and `citationShape.ts` has excluded it from its own placeholder
 * list since it was written. It stays excluded here for the same reason: a work
 * published anonymously is attributed to Anonymous, not to its title.
 *
 * A leaf with a type-only import.
 */

/**
 * The same vocabulary `citationShape.ts` matches in a reference's TEXT, applied
 * to a structured author record.
 *
 * Duplicated deliberately rather than shared: that one is anchored with `\b`
 * and hunts inside a whole reference line, this one tests a single field for
 * being wholly a placeholder. A field reading "Unknown" is one; a real author
 * named in a paper about "unknown pathogens" is not, and a shared pattern
 * would have to serve both.
 */
const PLACEHOLDER =
  /^(?:unknown(?:\s+author)?|no\s+author|author(?:\s*name)?|authorname|firstname|lastname|full\s*name|your\s*name|insert(?:\s+author)?|tbd|todo|x{3,}|n\/?a|none|null|undefined|placeholder|et\s+al\.?)$/i

function isPlaceholderPart(value: string | undefined): boolean {
  const trimmed = (value ?? '').trim()
  return trimmed === '' || PLACEHOLDER.test(trimmed)
}

/**
 * Is this whole record a placeholder?
 *
 * Both parts must be placeholder-or-absent. `{ given: 'David', family:
 * 'Unknown' }` is left alone — a real given name means something was actually
 * parsed, and dropping it would lose an attribution rather than clean one up.
 */
export function isPlaceholderAuthor(author: Author): boolean {
  return isPlaceholderPart(author.family) && isPlaceholderPart(author.given)
}

/**
 * The real authors, in order.
 *
 * Returning an EMPTY array is the point: every formatter already handles that
 * by moving the title into the author slot, so a source whose only "author" was
 * a placeholder formats correctly with no further change.
 */
export function realAuthors(authors: Author[]): Author[] {
  return authors.filter((author) => !isPlaceholderAuthor(author))
}
