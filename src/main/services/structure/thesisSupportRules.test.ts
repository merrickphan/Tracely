import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual, ok } from 'node:assert'
import { MIN_THESIS_SIMILARITY, belowThreshold, thesisComparisons } from './thesisSupportRules.ts'

/**
 * The threshold is the whole design, so it is what gets pinned.
 *
 * `offThesisParagraphs` itself value-imports the ML worker and cannot be loaded
 * by the type-stripping runner — the same constraint that keeps analyzeStructure
 * untested. What CAN be tested is the number that decides whether a student is
 * told to cut a paragraph, and the reasoning behind it is the part that would
 * be silently wrong if someone "tidied" it to reuse the retrieval constant.
 */
describe('MIN_THESIS_SIMILARITY', () => {
  it('sits inside the irrelevant band, not at its edge', () => {
    // Calibrated against eval/retrieval's labelled pairs: genuinely relevant
    // sources sat at 0.43+, irrelevant ones at 0.03-0.23.
    ok(MIN_THESIS_SIMILARITY > 0.03, 'below the floor of the irrelevant band')
    ok(MIN_THESIS_SIMILARITY < 0.23, 'inside the irrelevant band, not above it')
  })

  it('is far below the retrieval floor, which answers a different question', () => {
    // MIN_COUNTABLE_RELEVANCE.dense is 0.42 and separates "this source speaks
    // to this claim" from "it does not". Two paragraphs of ONE essay are
    // related by construction, and a body paragraph developing one strand sits
    // at 0.25-0.40 from the thesis — exactly what a body paragraph should look
    // like. Borrowing 0.42 would flag half of every draft.
    ok(MIN_THESIS_SIMILARITY < 0.42 / 2)
  })

  it('is a number, not a fraction someone can drift', () => {
    strictEqual(typeof MIN_THESIS_SIMILARITY, 'number')
    strictEqual(MIN_THESIS_SIMILARITY, 0.15)
  })
})

const para = (index: number, chars: number, word = 'argument') => ({
  index,
  text: `${word} `.repeat(Math.ceil(chars / (word.length + 1)))
})

describe('thesisComparisons — what gets measured', () => {
  const draft = [para(1, 40, 'Title'), para(2, 400, 'thesis'), para(3, 400, 'body'), para(4, 400, 'more')]

  it('compares every body paragraph against the thesis', () => {
    const plan = thesisComparisons({ paragraphs: draft, thesisIndex: 1 })
    ok(plan)
    deepStrictEqual(plan.candidates.map((c) => c.index), [3, 4])
  })

  it('never compares the thesis with itself', () => {
    const plan = thesisComparisons({ paragraphs: draft, thesisIndex: 1 })
    ok(!plan!.candidates.some((c) => c.index === 2))
  })

  // Null, not [], for every "could not measure" case. The caller has to be able
  // to tell "nothing is off-topic" from "nothing was measured" — only the first
  // is a finding, and the second must stay silent.
  it('returns null when there is no thesis to be off-topic from', () => {
    strictEqual(thesisComparisons({ paragraphs: draft, thesisIndex: null }), null)
    strictEqual(thesisComparisons({ paragraphs: draft, thesisIndex: 9 }), null)
    strictEqual(thesisComparisons({ paragraphs: draft, thesisIndex: -1 }), null)
  })

  it('returns null when the thesis paragraph is too short to embed', () => {
    strictEqual(thesisComparisons({ paragraphs: [para(1, 40), para(2, 400)], thesisIndex: 0 }), null)
  })

  it('returns null when nothing is left to compare', () => {
    strictEqual(
      thesisComparisons({ paragraphs: [para(1, 400), para(2, 40)], thesisIndex: 0 }),
      null
    )
  })

  it('skips the title and the conclusion', () => {
    const plan = thesisComparisons({
      paragraphs: [para(1, 400, 'Title'), para(2, 400, 'thesis'), para(3, 400, 'body'), para(4, 400, 'close')],
      thesisIndex: 1,
      titleParagraph: true,
      skip: [4]
    })
    deepStrictEqual(plan!.candidates.map((c) => c.index), [3])
  })

  it('never flags a paragraph too short to embed', () => {
    const plan = thesisComparisons({
      paragraphs: [para(1, 400, 'thesis'), para(2, 30, 'brief'), para(3, 400, 'body')],
      thesisIndex: 0
    })
    deepStrictEqual(plan!.candidates.map((c) => c.index), [3])
  })
})

describe('belowThreshold', () => {
  const candidates = [{ index: 2 }, { index: 3 }, { index: 4 }]

  it('reports only what falls under the floor', () => {
    deepStrictEqual(belowThreshold(candidates, [0.40, 0.02, 0.31]), [3])
  })

  // The band a real body paragraph lives in. If this starts failing, the
  // threshold has drifted toward the retrieval constant and the report will
  // start telling students to delete working paragraphs.
  it('leaves an ordinary body paragraph alone', () => {
    deepStrictEqual(belowThreshold(candidates, [0.25, 0.33, 0.40]), [])
  })

  it('reports nothing when nothing was measured', () => {
    deepStrictEqual(belowThreshold([], []), [])
  })
})
