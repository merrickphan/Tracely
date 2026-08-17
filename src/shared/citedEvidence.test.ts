import { strictEqual, ok } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildEvidenceSummary,
  CITED_SOURCE_MARKER,
  NO_EVIDENCE_SUMMARY,
  searchedSlots,
  truncateAtWordBoundary,
  type CritiqueSource
} from './citedEvidence.ts'

const OPTS = { maxItems: 4, maxAbstractChars: 900 }

const searched: CritiqueSource[] = [
  { title: 'Sleep and adolescent performance', abstract: 'A cohort study.' },
  { title: 'Chronotype and school start times', abstract: null },
  { title: 'Melatonin onset in teenagers', abstract: 'A review.' },
  { title: 'Attendance after a start-time change', abstract: 'A quasi-experiment.' },
  { title: 'One paper too many', abstract: null }
]

describe('buildEvidenceSummary', () => {
  it('puts the cited source at slot 1 and marks it', () => {
    const out = buildEvidenceSummary(
      { title: 'Later school start times', year: 2016, abstract: 'The cited abstract.' },
      searched,
      OPTS
    )
    const lines = out.split('\n')
    strictEqual(lines[0], `1. ${CITED_SOURCE_MARKER} Later school start times (2016) — The cited abstract.`)
    strictEqual(lines[1], '2. Sleep and adolescent performance — A cohort study.')
  })

  // The whole cost argument: reading the citation must not buy a fifth item.
  it('shares the slots rather than adding one', () => {
    const withCited = buildEvidenceSummary({ title: 'Cited', year: null, abstract: null }, searched, OPTS)
    const without = buildEvidenceSummary(null, searched, OPTS)
    strictEqual(withCited.split('\n').length, 4)
    strictEqual(without.split('\n').length, 4)
  })

  it('numbers contiguously with no year and no abstract', () => {
    const out = buildEvidenceSummary({ title: 'Cited', year: null, abstract: null }, searched.slice(0, 1), OPTS)
    strictEqual(out, `1. ${CITED_SOURCE_MARKER} Cited\n2. Sleep and adolescent performance — A cohort study.`)
  })

  it('marks nothing when no reference resolved', () => {
    const out = buildEvidenceSummary(null, searched, OPTS)
    ok(!out.includes(CITED_SOURCE_MARKER))
    ok(out.startsWith('1. Sleep and adolescent performance'))
  })

  // A resolved citation is still evidence even when the search returned none —
  // this is the case the whole change exists for.
  it('sends the cited source alone when the search found nothing', () => {
    const out = buildEvidenceSummary({ title: 'Cited', year: 2016, abstract: null }, [], OPTS)
    strictEqual(out, `1. ${CITED_SOURCE_MARKER} Cited (2016)`)
  })

  it('says so when there is nothing at all', () => {
    strictEqual(buildEvidenceSummary(null, [], OPTS), NO_EVIDENCE_SUMMARY)
  })

  it('truncates abstracts at a word boundary', () => {
    const out = buildEvidenceSummary(null, [{ title: 'T', abstract: 'mortality fell by 47 percent' }], {
      maxItems: 1,
      maxAbstractChars: 16
    })
    ok(out.endsWith('…'))
    // The number must never be severed — that is what the boundary is for.
    ok(!/\b4…$/.test(out))
  })
})

describe('searchedSlots', () => {
  it('reserves one slot for the cited source', () => {
    strictEqual(searchedSlots(true, 4), 3)
    strictEqual(searchedSlots(false, 4), 4)
    strictEqual(searchedSlots(true, 0), 0)
  })
})

describe('truncateAtWordBoundary', () => {
  it('leaves short text alone', () => {
    strictEqual(truncateAtWordBoundary('short', 20), 'short')
  })
})
