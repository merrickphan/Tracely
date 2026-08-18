import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { documentSort, gradedOn, type DocumentSort } from './documentSort.ts'

type Doc = Parameters<typeof documentSort>[0][number]

function doc(id: string, over: Partial<Doc> = {}): Doc {
  return {
    id,
    title: id,
    bodyHtml: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    score: null,
    gradedAt: null,
    ...over
  }
}

const ids = (sort: DocumentSort, docs: Doc[]): string[] => documentSort(docs, sort).map((d) => d.id)

describe('documentSort', () => {
  it('does not mutate the array it is given', () => {
    const docs = [doc('b'), doc('a')]
    documentSort(docs, 'title')
    deepStrictEqual(docs.map((d) => d.id), ['b', 'a'])
  })

  it('sorts titles case-insensitively', () => {
    // A plain `<` puts every lowercase title after every uppercase one.
    const docs = [doc('z', { title: 'Zebra' }), doc('a', { title: 'apple' })]
    deepStrictEqual(ids('title', docs), ['a', 'z'])
  })

  it('sorts by score, highest first', () => {
    const docs = [doc('low', { score: 40 }), doc('high', { score: 91 }), doc('mid', { score: 72 })]
    deepStrictEqual(ids('score', docs), ['high', 'mid', 'low'])
  })

  // The line that keeps a real draft reachable. An ungraded document is not an
  // error and must not be dropped or floated to the top.
  it('puts ungraded documents last, never drops them', () => {
    const docs = [doc('none'), doc('graded', { score: 50 })]
    deepStrictEqual(ids('score', docs), ['graded', 'none'])
    deepStrictEqual(ids('graded', [doc('none'), doc('g', { gradedAt: '2026-05-01T00:00:00.000Z' })]), [
      'g',
      'none'
    ])
    strictEqual(documentSort(docs, 'score').length, 2)
  })

  it('sorts by graded date, newest first', () => {
    const docs = [
      doc('old', { gradedAt: '2026-03-29T00:00:00.000Z' }),
      doc('new', { gradedAt: '2026-05-19T00:00:00.000Z' })
    ]
    deepStrictEqual(ids('graded', docs), ['new', 'old'])
  })

  it('restores recency order when switched back to it', () => {
    const docs = [
      doc('older', { updatedAt: '2026-01-01T00:00:00.000Z', title: 'a' }),
      doc('newer', { updatedAt: '2026-06-01T00:00:00.000Z', title: 'z' })
    ]
    deepStrictEqual(ids('title', docs), ['older', 'newer'])
    deepStrictEqual(ids('recent', docs), ['newer', 'older'])
  })
})

describe('gradedOn', () => {
  it('formats the way the frame writes it', () => {
    strictEqual(gradedOn('2026-05-19T12:00:00.000Z'), 'May 19, 2026')
    strictEqual(gradedOn('2026-03-29T12:00:00.000Z'), 'Mar 29, 2026')
  })

  // The off-by-one nobody reports and everybody notices: read as local time in
  // a negative-offset zone, this is the 18th.
  it('reads the timestamp as UTC, so the day does not slip', () => {
    strictEqual(gradedOn('2026-05-19T00:30:00.000Z'), 'May 19, 2026')
  })

  it('returns empty for a value it cannot parse, rather than "Invalid Date"', () => {
    strictEqual(gradedOn('not a date'), '')
  })
})
