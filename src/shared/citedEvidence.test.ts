import { strictEqual, ok } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildEvidenceSummary,
  CITED_SOURCE_MARKER,
  FALLBACK_HEADING,
  NO_EVIDENCE_SUMMARY,
  FALLBACK_SLOTS_WHEN_CITED_READABLE,
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
    // The searched papers sit UNDER a heading saying the writer did not cite
    // them. That is what stops "7 of 10 other articles do not support this"
    // being written about a sentence whose own source checks out.
    strictEqual(lines[1], FALLBACK_HEADING)
    strictEqual(lines[2], '2. Sleep and adolescent performance — A cohort study.')
  })

  // The whole cost argument: reading the citation must not buy a fifth item.
  it('shares the slots rather than adding one', () => {
    const withCited = buildEvidenceSummary({ title: 'Cited', year: null, abstract: null }, searched, OPTS)
    const without = buildEvidenceSummary(null, searched, OPTS)
    const items = (out: string): number => out.split('\n').filter((l) => /^\d+\./.test(l)).length
    // Four SOURCES either way. The heading is a line, not an item.
    strictEqual(items(withCited), 4)
    strictEqual(items(without), 4)
  })

  it('numbers contiguously with no year and no abstract', () => {
    const out = buildEvidenceSummary({ title: 'Cited', year: null, abstract: null }, searched.slice(0, 1), OPTS)
    strictEqual(
      out,
      `1. ${CITED_SOURCE_MARKER} Cited\n${FALLBACK_HEADING}\n2. Sleep and adolescent performance — A cohort study.`
    )
  })

  it('marks nothing when no reference resolved', () => {
    const out = buildEvidenceSummary(null, searched, OPTS)
    ok(!out.includes(CITED_SOURCE_MARKER))
    // And no fallback heading either: with nothing cited, these ARE the
    // evidence, and demoting them would tell the model to ignore its input.
    ok(!out.includes(FALLBACK_HEADING))
    ok(out.startsWith('1. Sleep and adolescent performance'))
  })

  // A resolved citation is still evidence even when the search returned none —
  // this is the case the whole change exists for.
  it('sends the cited source alone when the search found nothing', () => {
    const out = buildEvidenceSummary({ title: 'Cited', year: 2016, abstract: null }, [], OPTS)
    // No dangling heading over an empty list.
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

  /**
   * The evidence summary is ~40% of a warm critique — the largest fresh input —
   * and for a cited claim the prompt says most of it goes unread: Pass 2.5
   * tells the model to stop at slot 1 when the cited source answers. These
   * assert we stop SENDING it in exactly the case the prompt says to skip it,
   * and keep sending it in the case Pass 2.5 falls through on.
   */
  it('sends one fallback when the cited source has an abstract to read', () => {
    strictEqual(searchedSlots(true, 4, true), FALLBACK_SLOTS_WHEN_CITED_READABLE)
  })

  it('sends the full fallback set when the cited source has no abstract', () => {
    // Pass 2.5's own fall-through condition ("it has no abstract") is already
    // met before the call is made, so the extras are not dead weight here.
    strictEqual(searchedSlots(true, 4, false), 3)
  })

  it('changes nothing for an uncited claim — that list is the evidence', () => {
    strictEqual(searchedSlots(false, 4, true), 4)
    strictEqual(searchedSlots(false, 4, false), 4)
  })

  it('never exceeds the overall budget', () => {
    strictEqual(searchedSlots(true, 1, true), 0)
    strictEqual(searchedSlots(true, 0, true), 0)
  })

  it('defaults to the old behaviour when the flag is not passed', () => {
    strictEqual(searchedSlots(true, 4), searchedSlots(true, 4, false))
  })
})

describe('truncateAtWordBoundary', () => {
  it('leaves short text alone', () => {
    strictEqual(truncateAtWordBoundary('short', 20), 'short')
  })
})
