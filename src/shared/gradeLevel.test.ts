import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GRADE_LEVELS, REFERENCE_LEVEL, adjustedScore, gradeFor, isGradeLevel } from './gradeLevel.ts'

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

describe('gradeFor', () => {
  it('bands on the standard scale: 90 A, 80 B, 70 C, 60 D', () => {
    strictEqual(gradeFor(90).letter, 'A-')
    strictEqual(gradeFor(89).letter, 'B+')
    strictEqual(gradeFor(80).letter, 'B-')
    strictEqual(gradeFor(79).letter, 'C+')
    strictEqual(gradeFor(70).letter, 'C-')
    strictEqual(gradeFor(69).letter, 'D+')
    strictEqual(gradeFor(60).letter, 'D-')
    strictEqual(gradeFor(59).letter, 'F')
    strictEqual(gradeFor(48).letter, 'F')
  })

  it('every decade is one letter', () => {
    for (const [from, letter] of [[90, 'A'], [80, 'B'], [70, 'C'], [60, 'D']] as const) {
      for (let score = from; score < from + 10; score++) {
        strictEqual(gradeFor(score).letter[0], letter, `${score} should be a ${letter}`)
      }
    }
  })

  it('has a top of the scale', () => {
    // A+ did not exist, so "A" was a ceiling: a draft that met every
    // expectation of its level could not be told it had.
    strictEqual(gradeFor(97).letter, 'A+')
    strictEqual(gradeFor(100).letter, 'A+')
    strictEqual(gradeFor(96).letter, 'A')
    strictEqual(gradeFor(93).letter, 'A')
  })

  it('is the Hepburn essay: A+ for a third-grader, B for a senior', () => {
    // 78 is what the rubric scores that draft (see scoreDraft.test.ts). At
    // grade 3 the shift takes it past the top of the scale; at 12 it does not
    // move at all.
    strictEqual(gradeFor(78, 3).letter, 'A+')
    strictEqual(gradeFor(78, 12).letter, 'C+')
  })

  it('still has somewhere to fall at a low level', () => {
    // The shift is credit, not a floor: a draft with nothing the rubric can
    // find is still failing it, in year 3 as in year 12.
    strictEqual(gradeFor(0, 3).letter, 'F')
    strictEqual(gradeFor(20, 3).letter, 'F')
  })
})
