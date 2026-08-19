/**
 * What year the writer is in, and what that does to the letter.
 *
 * The rubric measures the same six things at every level — a thesis is a thesis
 * in year 3 and in year 12 — so the /100 does NOT move with this setting. What
 * moves is what the number is worth: the same essay that meets a nine-year-old's
 * expectations is thin for someone about to leave school.
 *
 * That distinction is the whole design. Scaling the score would break the
 * report, whose six components add to the number shown; and a score that
 * changed with a dropdown could not be argued with, which is the property
 * `structure/scoreDraft.ts` exists to protect. So this is a band shift and
 * nothing else, and the report says so beside the letter.
 *
 * A leaf with no imports, so `npm test` can load it.
 */

/** The school years offered in Settings → Preferences. */
export const GRADE_LEVELS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
export type GradeLevel = (typeof GRADE_LEVELS)[number]

/**
 * The level the bands were written against.
 *
 * `GRADE_BANDS` in `components/essayGrade.ts` was tuned so 82 reads "B+" as the
 * Figma frame draws it, and it was tuned against unqualified academic writing —
 * final-year work. So year 12 applies no shift at all, and every level below it
 * is easier by construction rather than by a second table of bands that could
 * disagree with the first.
 */
export const REFERENCE_LEVEL = 12

/**
 * Points of credit per year below the reference.
 *
 * 4 a year, so year 3 sits 36 points below year 12 — which is the owner's own
 * example: an essay that is an A+ for a third-grader lands around D+ against
 * final-year expectations (97 vs 61 on these bands).
 *
 * Deliberately linear. A curve fitted to something would need that something to
 * exist; there is no cohort here to norm against, and inventing a shape would
 * dress a guess up as a measurement.
 */
export const POINTS_PER_LEVEL = 4

export function isGradeLevel(value: unknown): value is GradeLevel {
  return typeof value === 'number' && (GRADE_LEVELS as readonly number[]).includes(value)
}

/**
 * The score to band, once the writer's year is taken into account.
 *
 * Clamped to 0-100 so a shifted score never leaves the table: the bands' floor
 * is 0 and their top is 90, and a year-3 draft scoring 80 would otherwise be
 * asked for a letter at 116.
 */
export function adjustedScore(score: number, level: number = REFERENCE_LEVEL): number {
  const safe = isGradeLevel(level) ? level : REFERENCE_LEVEL
  const shift = (REFERENCE_LEVEL - safe) * POINTS_PER_LEVEL
  return Math.max(0, Math.min(100, Math.round(score + shift)))
}

/** "Year 12" / "Grade 3" — the label the setting shows. */
export function gradeLevelLabel(level: number): string {
  return `Grade ${isGradeLevel(level) ? level : REFERENCE_LEVEL}`
}
