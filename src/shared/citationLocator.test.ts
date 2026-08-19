import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { citationLocator, normalizeDoi, type LocatableSource } from './citationLocator.ts'
import type { VenueType } from './types.ts'

const source = (over: Partial<LocatableSource> = {}): LocatableSource => ({
  doi: '10.1044/leader.ftr3.19022014.58',
  url: 'https://pubs.asha.org/doi/10.1044/leader.ftr3.19022014.58',
  venueType: 'journal',
  ...over
})

describe('citationLocator', () => {
  it('gives the DOI for an article, which is what every style asks for', () => {
    strictEqual(
      citationLocator(source()),
      'https://doi.org/10.1044/leader.ftr3.19022014.58'
    )
  })

  // The complaint. 494 of 518 retrieved sources carry a DOI, so a reference
  // list for a history essay ended every line in doi.org — including its books.
  it('gives a BOOK no locator at all, DOI or not', () => {
    strictEqual(citationLocator(source({ venueType: 'book' })), null)
    strictEqual(citationLocator(source({ venueType: 'book', doi: null })), null)
  })

  // An Oxford DNB entry is read online, and MLA and Chicago both want the
  // publisher's page for one. What it must never take is the DOI a database
  // minted for a single entry, which is an artifact of that database.
  it('gives a REFERENCE work its publisher page, never its DOI', () => {
    strictEqual(
      citationLocator(source({ venueType: 'reference', url: 'https://www.oxforddnb.com/view/x' })),
      'https://www.oxforddnb.com/view/x'
    )
    strictEqual(citationLocator(source({ venueType: 'reference', url: null })), null)
  })

  it('prefers the readable URL for a web source over an identifier', () => {
    strictEqual(
      citationLocator(source({ venueType: 'other' })),
      'https://pubs.asha.org/doi/10.1044/leader.ftr3.19022014.58'
    )
  })

  // A missing locator is the harder problem for a reader than a redundant one.
  it('falls back rather than printing nothing for an unclassified source', () => {
    strictEqual(citationLocator(source({ venueType: null, url: null })), 'https://doi.org/10.1044/leader.ftr3.19022014.58')
    strictEqual(citationLocator(source({ venueType: 'journal', doi: null })), 'https://pubs.asha.org/doi/10.1044/leader.ftr3.19022014.58')
    strictEqual(citationLocator(source({ venueType: 'journal', doi: null, url: null })), null)
  })

  it('treats a blank string as absent', () => {
    strictEqual(citationLocator(source({ doi: '   ', venueType: 'journal' })), 'https://pubs.asha.org/doi/10.1044/leader.ftr3.19022014.58')
    strictEqual(citationLocator(source({ doi: '  ', url: '  ', venueType: 'journal' })), null)
  })

  it('covers every venue type, so a new one cannot fall through unnoticed', () => {
    const all: VenueType[] = [
      'journal',
      'dataset',
      'conference',
      'preprint',
      'book',
      'reference',
      'other'
    ]
    for (const venueType of all) {
      const out = citationLocator(source({ venueType }))
      strictEqual(
        out === null || out.startsWith('http'),
        true,
        `${venueType} produced ${String(out)}`
      )
    }
  })
})

describe('normalizeDoi', () => {
  // The formatters concatenated whatever the provider returned onto
  // "https://doi.org/", so a provider using the resolver form produced
  // https://doi.org/https://doi.org/10.1044/... in a student's reference list.
  it('strips a resolver prefix rather than doubling it', () => {
    for (const raw of [
      '10.1044/leader',
      'doi:10.1044/leader',
      'DOI: 10.1044/leader',
      'https://doi.org/10.1044/leader',
      'http://dx.doi.org/10.1044/leader',
      '  10.1044/leader  '
    ]) {
      strictEqual(normalizeDoi(raw), '10.1044/leader', raw)
    }
  })
})
