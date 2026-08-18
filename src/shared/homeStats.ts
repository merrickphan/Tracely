/**
 * The three numbers across the top of Home.
 *
 * All derived from the document list the page already loads — no new query, no
 * new IPC, and nothing denormalised onto `documents`. `listDocuments` already
 * joins each draft's cached score and the timestamp it was graded at, which is
 * everything these need.
 *
 * A leaf with one type-only import, so `npm test` can load it. That matters
 * more here than usual: a streak is a date calculation, date calculations are
 * wrong at boundaries, and "5 days" on someone's home screen is a claim about
 * their week that they will notice being wrong.
 */
import type { DocumentListItem } from './types'

export interface HomeStats {
  /** Documents graded since the 1st of the current month. */
  gradedThisMonth: number
  /** Mean score across every graded document, or null if none are. */
  averageScore: number | null
  /** Consecutive days, ending today or yesterday, with at least one grading. */
  streakDays: number
}

/**
 * `now` is a parameter rather than `Date.now()`.
 *
 * Two reasons, and the second is the real one. It makes this testable at
 * boundaries — the last day of a month, a streak crossing midnight — which is
 * exactly where a date calculation goes wrong. And it keeps the function pure,
 * so the same list and the same instant always produce the same three numbers;
 * a component that re-renders does not get a different streak.
 */
export function computeHomeStats(documents: DocumentListItem[], now: Date): HomeStats {
  const graded = documents.filter(
    (doc): doc is DocumentListItem & { score: number; gradedAt: string } =>
      typeof doc.score === 'number' && typeof doc.gradedAt === 'string'
  )

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const gradedThisMonth = graded.filter((doc) => {
    const at = new Date(doc.gradedAt).getTime()
    return Number.isFinite(at) && at >= monthStart
  }).length

  const averageScore =
    graded.length === 0
      ? null
      : Math.round(graded.reduce((sum, doc) => sum + doc.score, 0) / graded.length)

  return { gradedThisMonth, averageScore, streakDays: streak(graded, now) }
}

/** Local midnight for a timestamp, as a day number — the unit a streak counts. */
function dayNumber(value: Date): number {
  return Math.floor(
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 86_400_000
  )
}

/**
 * Consecutive days ending today, or ending yesterday.
 *
 * Yesterday counts as still-running, and that is a product decision rather than
 * an oversight: a streak that resets the instant the clock passes midnight
 * tells someone who worked last night and has not opened the app yet that they
 * have lost it. It ends the moment a whole day is skipped.
 *
 * Local midnights, not 24-hour windows. "Days" on a home screen means calendar
 * days — two gradings eight hours apart either side of midnight are two days,
 * and two gradings twenty hours apart on one afternoon and evening are one.
 */
function streak(graded: Array<{ gradedAt: string }>, now: Date): number {
  const days = new Set<number>()
  for (const doc of graded) {
    const at = new Date(doc.gradedAt)
    if (Number.isFinite(at.getTime())) days.add(dayNumber(at))
  }
  if (days.size === 0) return 0

  const today = dayNumber(now)
  // Start from today if it has a grading, else yesterday. Anything older means
  // the streak is already broken and the answer is 0 — not "the length of the
  // most recent run", which would report a streak that ended in March.
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null
  if (cursor === null) return 0

  let count = 0
  while (days.has(cursor)) {
    count++
    cursor--
  }
  return count
}
