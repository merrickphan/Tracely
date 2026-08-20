import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { describeCitedWork, NOT_INDEXED_NOTE } from './citedComparison.ts'
import type { ResolvedCitedWork } from './ipc-contract.ts'

const base: ResolvedCitedWork = {
  raw: '(Walker, 2010)',
  surnames: ['Walker'],
  year: 2010,
  citedTitle: null,
  found: false,
  title: null,
  matchedYear: null,
  doi: null,
  url: null,
  index: null
}

describe('describeCitedWork — the half of the card that was missing', () => {
  it('says nothing when the sentence cites nothing checkable', () => {
    strictEqual(describeCitedWork(null), null)
  })

  it('names the work, the index and the year when one was found', () => {
    const out = describeCitedWork({
      ...base,
      found: true,
      title: 'Audrey: Her Real Story',
      matchedYear: 2010,
      doi: '10.1000/x',
      url: 'https://doi.org/10.1000/x',
      index: 'crossref'
    })
    strictEqual(out?.title, 'Audrey: Her Real Story')
    strictEqual(out?.detail, 'Found in Crossref · 2010')
    strictEqual(out?.url, 'https://doi.org/10.1000/x')
    strictEqual(out?.found, true)
    // Nothing to caveat: a work was found.
    strictEqual(out?.note, null)
  })

  it('distinguishes a book match from a journal match', () => {
    const out = describeCitedWork({
      ...base,
      found: true,
      title: 'Freakonomics',
      matchedYear: 2005,
      index: 'openlibrary'
    })
    strictEqual(out?.detail, 'Found in Open Library · 2005')
    // No DOI, so no link. An openlibrary.org search URL would hand the reader a
    // results page dressed as the work.
    strictEqual(out?.url, null)
  })

  /**
   * A year either way is routine — a preprint and its journal version, an
   * edition reprinted — which is why YEAR_TOLERANCE allows it. Printing the
   * record's year silently over the writer's would look like a different work.
   */
  it('says so when the record is dated differently from the citation', () => {
    const out = describeCitedWork({
      ...base,
      found: true,
      title: 'A Work',
      matchedYear: 2011,
      index: 'crossref'
    })
    strictEqual(out?.note, 'You cited 2010; the record is dated 2011. A year either way is normal.')
  })

  /**
   * The rule this module exists to hold. `found: false` is not "your source is
   * fake" — measured on eval/fabrication, the lookup missed 2 of 8 REAL books,
   * and holds no web pages, news or government reports at all.
   */
  it('reports an empty lookup as an empty lookup, never as a verdict', () => {
    const out = describeCitedWork(base)
    strictEqual(out?.detail, 'Not found in Crossref or Open Library')
    strictEqual(out?.note, NOT_INDEXED_NOTE)
    strictEqual(out?.found, false)
    // Always shown, whatever happened: the writer has to be able to see WHICH
    // reference the card is talking about.
    strictEqual(out?.reference, '(Walker, 2010)')
  })

  it('shows the title the writer named, and never invents one', () => {
    strictEqual(describeCitedWork({ ...base, citedTitle: 'Audrey Hepburn' })?.title, 'Audrey Hepburn')
    // A surname and a year with no matching record is exactly that. Filling the
    // line would be writing their citation for them.
    strictEqual(describeCitedWork(base)?.title, null)
  })

  it('falls back to the cited year when the record carries none', () => {
    const out = describeCitedWork({ ...base, found: true, title: 'A Work', index: 'crossref' })
    strictEqual(out?.detail, 'Found in Crossref · 2010')
  })

  // `found` and a title are both required: a corroborated check with no title
  // is not something to draw a comparison from.
  it('treats a found flag with no title as not found', () => {
    strictEqual(describeCitedWork({ ...base, found: true })?.found, false)
  })
})
