import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { containerPrefix, endTitle } from './citationTitle.ts'

describe('endTitle', () => {
  it('adds the period an ordinary title needs', () => {
    strictEqual(endTitle('Dutch Girl'), 'Dutch Girl.')
  })

  /**
   * The reported line, 2026-08-20. Every formatter stripped a trailing PERIOD
   * and then appended its own, which guards exactly one of the three marks a
   * title can end with.
   */
  it('keeps a question mark instead of printing "Wrong?."', () => {
    strictEqual(
      endTitle('The Scientific Consensus on Climate Change: How Do We Know We’re Not Wrong?'),
      'The Scientific Consensus on Climate Change: How Do We Know We’re Not Wrong?'
    )
  })

  it('keeps an exclamation mark for the same reason', () => {
    strictEqual(endTitle('Stop Making Sense!'), 'Stop Making Sense!')
  })

  it('does not double a period the title already carries', () => {
    strictEqual(endTitle('A Study of J. R. R. Tolkien.'), 'A Study of J. R. R. Tolkien.')
  })

  // An abbreviation at the end is indistinguishable from a sentence period and
  // is left alone — printing "et al.." is the failure being avoided.
  it('leaves a title ending in an abbreviation alone', () => {
    strictEqual(endTitle('Evidence from the U.S.'), 'Evidence from the U.S.')
  })

  it('trims, and survives an empty title', () => {
    strictEqual(endTitle('  Dutch Girl  '), 'Dutch Girl.')
    strictEqual(endTitle(''), '')
    strictEqual(endTitle('   '), '')
  })
})

describe('containerPrefix', () => {
  /**
   * `…Not Wrong?. Climate Change.` names a journal called Climate Change, which
   * does not exist — the work is a chapter of a book by that name.
   */
  it('marks a chapter’s container, so a book cannot read as a journal', () => {
    strictEqual(containerPrefix('book-chapter'), 'In ')
  })

  it('says nothing for anything else', () => {
    for (const venueType of ['journal', 'book', 'reference', 'dataset', 'other', null] as const) {
      strictEqual(containerPrefix(venueType), '', String(venueType))
    }
  })
})
