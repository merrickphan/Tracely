import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lowerSubject, paragraphNames, paragraphSubject } from './paragraphNames.ts'

type Role = Parameters<typeof paragraphNames>[0][number]['role']

const of = (...roles: Role[]) => roles.map((role) => ({ role }))

describe('paragraphNames', () => {
  it('drops the title and numbers the body from one', () => {
    // The shape that prompted this: the report listed the essay's heading as
    // "P1 · Unlabelled", a paragraph of the argument it plainly is not.
    deepStrictEqual(
      paragraphNames(of('unknown', 'thesis', 'claim', 'evidence', 'conclusion'), true),
      [null, 'Introduction', 'Paragraph 1', 'Paragraph 2', 'Conclusion']
    )
  })

  it('names an untitled essay from its first paragraph', () => {
    deepStrictEqual(
      paragraphNames(of('thesis', 'claim', 'conclusion'), false),
      ['Introduction', 'Paragraph 1', 'Conclusion']
    )
  })

  it('does not invent a conclusion for a draft that stops', () => {
    // The last paragraph is only "Conclusion" when it was labelled one. A draft
    // abandoned mid-argument gets a number, not a name for a section it has not
    // written.
    deepStrictEqual(
      paragraphNames(of('thesis', 'claim', 'claim'), false),
      ['Introduction', 'Paragraph 1', 'Paragraph 2']
    )
  })

  it('does not call a lone paragraph an introduction', () => {
    // A one-paragraph draft introduces nothing.
    deepStrictEqual(paragraphNames(of('claim'), false), ['Paragraph 1'])
  })

  it('numbers the body the same whether or not there is a title', () => {
    const titled = paragraphNames(of('unknown', 'thesis', 'claim', 'conclusion'), true)
    const untitled = paragraphNames(of('thesis', 'claim', 'conclusion'), false)
    deepStrictEqual(titled.filter((n) => n !== null), untitled)
  })

  it('treats a leading unknown as a paragraph when it is not a title', () => {
    deepStrictEqual(
      paragraphNames(of('unknown', 'thesis', 'conclusion'), false),
      ['Introduction', 'Paragraph 1', 'Conclusion']
    )
  })
})

/**
 * The naming bug this function exists to close: a titled essay shifts every
 * array position by one, and `weaknesses.ts` numbered the array while the card
 * above it numbered the body. Owner, 2026-08-19: a card headed "Paragraph 11"
 * carrying a finding about "the 12th paragraph".
 */
describe('paragraphSubject', () => {
  const TITLED = of('unknown', 'thesis', 'claim', 'claim', 'conclusion')

  it('agrees with the heading the panels draw, index for index', () => {
    const names = paragraphNames(TITLED, true)
    for (let index = 2; index <= TITLED.length; index++) {
      const name = names[index - 1]!
      const subject = paragraphSubject(TITLED, true, index)
      strictEqual(subject.toLowerCase().endsWith(name.toLowerCase()), true, `${subject} vs ${name}`)
    }
  })

  it('numbers the body, not the array', () => {
    // Array position 4 is the second body paragraph of a titled essay.
    strictEqual(paragraphSubject(TITLED, true, 4), 'Paragraph 2')
  })

  it('names the introduction and the conclusion rather than numbering them', () => {
    strictEqual(paragraphSubject(TITLED, true, 2), 'The introduction')
    strictEqual(paragraphSubject(TITLED, true, 5), 'The conclusion')
  })

  it('refuses to invent a number for the title or for an index off the end', () => {
    strictEqual(paragraphSubject(TITLED, true, 1), 'This paragraph')
    strictEqual(paragraphSubject(TITLED, true, 99), 'This paragraph')
  })

  it('lowercases only the article, so mid-sentence reads', () => {
    strictEqual(lowerSubject('The conclusion'), 'the conclusion')
    strictEqual(lowerSubject('Paragraph 2'), 'Paragraph 2')
  })
})
