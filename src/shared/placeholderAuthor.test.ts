import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { isPlaceholderAuthor, realAuthors } from './placeholderAuthor.ts'

describe('isPlaceholderAuthor', () => {
  // The exact records the providers returned, from the owner's database.
  it('catches the shapes that actually appear', () => {
    strictEqual(isPlaceholderAuthor({ family: 'Unknown' }), true)
    strictEqual(isPlaceholderAuthor({ given: 'Unknown', family: 'Author' }), true)
    strictEqual(isPlaceholderAuthor({ family: 'Unknown Author' }), true)
    strictEqual(isPlaceholderAuthor({ family: 'N/A' }), true)
    strictEqual(isPlaceholderAuthor({ family: '' }), true)
  })

  // "Anonymous" is a real, deliberate attribution with a defined meaning in
  // every style guide — citationShape.ts has excluded it since it was written.
  it('does NOT treat Anonymous as a placeholder', () => {
    strictEqual(isPlaceholderAuthor({ family: 'Anonymous' }), false)
  })

  it('leaves real names alone', () => {
    strictEqual(isPlaceholderAuthor({ given: 'Audrey', family: 'Hepburn' }), false)
    strictEqual(isPlaceholderAuthor({ family: 'Lähteenmäki' }), false)
    strictEqual(isPlaceholderAuthor({ given: 'A.', family: 'Walker' }), false)
  })

  // A real given name means something was actually parsed. Dropping the record
  // would lose an attribution rather than clean one up.
  it('keeps a record with a real given name and an unknown surname', () => {
    strictEqual(isPlaceholderAuthor({ given: 'David', family: 'Unknown' }), false)
  })
})

describe('realAuthors', () => {
  it('empties a list that is nothing but placeholders, so the title takes the slot', () => {
    deepStrictEqual(realAuthors([{ family: 'Unknown' }]), [])
    deepStrictEqual(realAuthors([{ family: 'Unknown' }, { family: 'Unknown' }]), [])
  })

  it('drops a placeholder from a list that also has real authors', () => {
    deepStrictEqual(
      realAuthors([{ given: 'David', family: 'Griffiths' }, { family: 'Unknown' }]),
      [{ given: 'David', family: 'Griffiths' }]
    )
  })

  it('preserves order', () => {
    const authors = [{ family: 'Okonkwo' }, { family: 'Unknown' }, { family: 'Zhang' }]
    deepStrictEqual(realAuthors(authors), [{ family: 'Okonkwo' }, { family: 'Zhang' }])
  })
})
