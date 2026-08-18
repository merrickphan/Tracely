import type { DocumentListItem } from '@shared/types'

/**
 * Ordering and date formatting for the Documents page — Figma 58:172.
 *
 * A leaf with tests because both have a wrong answer available that looks
 * right. Sorting on a nullable field silently buries every ungraded document at
 * one end or throws it to the top depending on how the comparator treats null,
 * and a date formatter that reads the string as local time shows "Graded May
 * 18" for a document graded at 00:30 on the 19th in a negative-offset zone —
 * which is the kind of off-by-one nobody reports and everybody notices.
 */

export type DocumentSort = 'recent' | 'graded' | 'score' | 'title'

/**
 * "May 19, 2026" from an ISO timestamp.
 *
 * Formatted in UTC deliberately. These timestamps are written by the main
 * process with `toISOString()`, so the calendar day they name is a UTC day;
 * rendering it in the viewer's zone moves it backwards for anyone west of
 * Greenwich whenever the analysis ran in the early hours. The date on this card
 * is a label, not an appointment — being consistent with the stored value
 * matters more than being local.
 */
export function gradedOn(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

/**
 * Sorted copy, never in place — the caller holds the array in React state.
 *
 * Ungraded documents sort LAST under 'graded' and 'score' rather than being
 * dropped. They are real drafts and the grid is the only list of them; hiding a
 * document because nothing has read it yet would make it unreachable from the
 * one page that exists to reach documents from.
 */
export function documentSort(documents: DocumentListItem[], sort: DocumentSort): DocumentListItem[] {
  const items = [...documents]

  switch (sort) {
    case 'title':
      // Locale-aware and case-insensitive: a plain `<` puts every lowercase
      // title after every uppercase one, so "apple" lands below "Zebra".
      return items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))

    case 'score':
      return items.sort((a, b) => {
        if (a.score === null && b.score === null) return 0
        if (a.score === null) return 1
        if (b.score === null) return -1
        return b.score - a.score
      })

    case 'graded':
      return items.sort((a, b) => {
        if (!a.gradedAt && !b.gradedAt) return 0
        if (!a.gradedAt) return 1
        if (!b.gradedAt) return -1
        return b.gradedAt.localeCompare(a.gradedAt)
      })

    case 'recent':
    default:
      // Already the order main returns (updated_at DESC), and re-sorted anyway
      // so switching back to it from another option actually restores it rather
      // than leaving whatever the last comparator produced.
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
