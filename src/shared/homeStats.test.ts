import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeHomeStats } from './homeStats.ts'

const NOW = new Date(2026, 7, 18, 14, 0, 0) // 18 Aug 2026, local

function doc(gradedAt: string | null, score: number | null) {
  return {
    id: gradedAt ?? 'ungraded',
    title: 't',
    bodyHtml: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    score,
    gradedAt
  }
}

/** Local midnight on a given day of August 2026, as an ISO string. */
function aug(day: number, hour = 12): string {
  return new Date(2026, 7, day, hour).toISOString()
}

describe('computeHomeStats — counts and average', () => {
  it('counts only documents graded since the 1st of this month', () => {
    const stats = computeHomeStats(
      [doc(aug(2), 80), doc(aug(17), 70), doc(new Date(2026, 6, 30, 12).toISOString(), 90)],
      NOW
    )
    strictEqual(stats.gradedThisMonth, 2)
  })

  it('averages every graded document, not just this month’s', () => {
    // The card says "Average grade", not "average this month" — a number that
    // silently changed meaning on the 1st would be worse than either.
    const stats = computeHomeStats([doc(aug(2), 80), doc(new Date(2026, 5, 1, 12).toISOString(), 60)], NOW)
    strictEqual(stats.averageScore, 70)
  })

  it('ignores documents nothing has graded', () => {
    const stats = computeHomeStats([doc(null, null), doc(aug(3), 84)], NOW)
    strictEqual(stats.gradedThisMonth, 1)
    strictEqual(stats.averageScore, 84)
  })

  it('reports a null average rather than a zero for an empty library', () => {
    // 0 would render as "F", which is a grade nobody earned.
    const stats = computeHomeStats([], NOW)
    strictEqual(stats.averageScore, null)
    strictEqual(stats.gradedThisMonth, 0)
    strictEqual(stats.streakDays, 0)
  })
})

describe('computeHomeStats — streak', () => {
  it('counts consecutive days ending today', () => {
    strictEqual(computeHomeStats([doc(aug(18), 1), doc(aug(17), 1), doc(aug(16), 1)], NOW).streakDays, 3)
  })

  it('stops at the first skipped day', () => {
    strictEqual(
      computeHomeStats([doc(aug(18), 1), doc(aug(17), 1), doc(aug(15), 1)], NOW).streakDays,
      2
    )
  })

  /**
   * Yesterday still counts. A streak that resets the moment the clock passes
   * midnight tells someone who worked last night and has not opened the app yet
   * that they have lost it.
   */
  it('keeps a streak alive on the morning after', () => {
    strictEqual(computeHomeStats([doc(aug(17), 1), doc(aug(16), 1)], NOW).streakDays, 2)
  })

  it('is zero once a whole day has been missed', () => {
    strictEqual(computeHomeStats([doc(aug(16), 1), doc(aug(15), 1)], NOW).streakDays, 0)
  })

  it('counts a day once however many documents were graded on it', () => {
    strictEqual(
      computeHomeStats([doc(aug(18, 9), 1), doc(aug(18, 14), 1), doc(aug(18, 22), 1)], NOW).streakDays,
      1
    )
  })

  /**
   * Calendar days, not 24-hour windows. Two gradings eight hours apart either
   * side of midnight are two days.
   */
  it('splits on local midnight rather than on elapsed hours', () => {
    strictEqual(computeHomeStats([doc(aug(18, 2), 1), doc(aug(17, 22), 1)], NOW).streakDays, 2)
  })

  it('survives a run crossing a month boundary', () => {
    const now = new Date(2026, 8, 2, 10) // 2 Sep
    const stats = computeHomeStats(
      [doc(new Date(2026, 8, 2, 9).toISOString(), 1), doc(new Date(2026, 8, 1, 9).toISOString(), 1), doc(aug(31, 9), 1)],
      now
    )
    strictEqual(stats.streakDays, 3)
    strictEqual(stats.gradedThisMonth, 2, 'the August grading must not count toward September')
  })

  it('ignores an unparseable timestamp instead of throwing', () => {
    strictEqual(computeHomeStats([doc('not a date', 50), doc(aug(18), 90)], NOW).streakDays, 1)
  })
})
