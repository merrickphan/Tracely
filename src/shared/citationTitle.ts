/**
 * The two things all three formatters do to a title, in one place.
 *
 * ── `Wrong?.` ──────────────────────────────────────────────────────────────
 * Every formatter did `source.title.replace(/\.$/, '')` and then appended its
 * own period. That guards a title ending in a PERIOD and nothing else, so a
 * title ending in a question mark got both marks:
 *
 *   Oreskes, N. (2014). …How Do We Know We're Not Wrong?. Climate Change.
 *                                                     ^^
 *
 * MLA and Chicago put the period inside the quotes, so there it reads
 * `…Not Wrong?."` — worse, because it looks like a typo the writer made. APA 7,
 * MLA 9 and Chicago 17 agree: a title's own terminal `?` or `!` REPLACES the
 * period rather than sitting beside it.
 *
 * Chicago already carried a hand-written guard for exactly this shape one line
 * down (`n.d.` followed by Chicago's own period, printing `n.d..`), which is
 * how often this class of bug reaches a real reference list.
 *
 * ── `In` ───────────────────────────────────────────────────────────────────
 * The venue was printed bare, so an edited book's title sat in the slot a
 * journal name occupies. `…Not Wrong?. Climate Change.` names a journal called
 * Climate Change, which does not exist — the work is chapter six of a book. APA
 * and Chicago both mark the container with `In`; MLA 9 does not, and takes the
 * container title straight.
 *
 * A leaf with a type-only import.
 */
import type { VenueType } from './types.ts'

/** Marks that already end a sentence, so a style must not add a second one. */
const TERMINAL = /[.?!]$/

/**
 * The title with exactly one terminal mark.
 *
 * Its own `?` or `!` is kept and the period is not added; anything else gets
 * the period. Quote the RESULT for MLA and Chicago — the mark belongs inside.
 */
export function endTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return ''
  return TERMINAL.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * `'In '` when the venue is the book a chapter sits in, `''` otherwise.
 *
 * APA and Chicago only. MLA 9 names the container without it.
 */
export function containerPrefix(venueType: VenueType | null): string {
  return venueType === 'book-chapter' ? 'In ' : ''
}
