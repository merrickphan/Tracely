import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GRADE_LEVELS, REFERENCE_LEVEL, adjustedScore, isGradeLevel } from './gradeLevel.ts'

describe('adjustedScore', () => {
  it('leaves the reference level untouched', () => {
    strictEqual(adjustedScore(82, 12), 82)
    strictEqual(REFERENCE_LEVEL, 12)
  })

  it('credits four points per year below the reference', () => {
    strictEqual(adjustedScore(50, 11), 54)
    strictEqual(adjustedScore(50, 8), 66)
    strictEqual(adjustedScore(50, 3), 86)
  })

  it('is the owner\'s example: an A+ for a third-grader is a D for a senior', () => {
    // 61 bands as D against final-year expectations and as A (97) at grade 3.
    strictEqual(adjustedScore(61, 3), 97)
    strictEqual(adjustedScore(61, 12), 61)
  })

  it('clamps rather than leaving the band table', () => {
    strictEqual(adjustedScore(80, 3), 100)
    strictEqual(adjustedScore(0, 12), 0)
  })

  it('falls back to the reference level for a junk setting', () => {
    // A stored value from a future build, or a hand-edited settings row.
    strictEqual(adjustedScore(70, 99), 70)
    strictEqual(adjustedScore(70, Number.NaN), 70)
  })

  it('offers grades 3 to 12', () => {
    strictEqual(GRADE_LEVELS.length, 10)
    strictEqual(GRADE_LEVELS[0], 3)
    strictEqual(GRADE_LEVELS[GRADE_LEVELS.length - 1], 12)
    strictEqual(isGradeLevel(3), true)
    strictEqual(isGradeLevel(2), false)
    strictEqual(isGradeLevel('7'), false)
  })
})
