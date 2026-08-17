import { deepStrictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { paragraphNames } from './paragraphNames.ts'

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
