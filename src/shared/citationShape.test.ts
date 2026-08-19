import { describe, it } from 'node:test'
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { findCitationDefects, type CitationDefectKind } from './citationShape.ts'

/**
 * A wrong flag here tells a student their correct reference is broken, and a
 * student told that once stops reading citation warnings entirely. So the
 * negative cases carry the weight: real references in three styles, ordinary
 * parenthetical asides, and the two shapes that LOOK like defects and are not
 * ("Anonymous" is a real attribution; the same work cited twice in a paragraph
 * is normal).
 */

// Pinned rather than derived from the clock — a rule that changes answer on
// 1 January is a rule whose suite starts failing on 1 January.
const YEAR = 2026

const kinds = (text: string): CitationDefectKind[] =>
  findCitationDefects(text, YEAR).map((d) => d.kind)

describe('findCitationDefects — leaves real citations alone', () => {
  it('accepts the ordinary styles', () => {
    for (const text of [
      'Malnutrition produced lasting anaemia (Lähteenmäki, 2006).',
      'The ration fell to four hundred calories (Walker 2010).',
      'She described it in her own words (Spoto, 2006, p. 84).',
      'Two accounts agree on the figure (Paris, 1996; Walker, 2010).',
      'The revised edition carries a new preface (Shelley, 1831).',
      'Relief arrived in May (Hitchcock 2008, 112).'
    ]) {
      deepStrictEqual(findCitationDefects(text, YEAR), [], text)
    }
  })

  it('leaves ordinary parenthetical asides alone', () => {
    for (const text of [
      'She travelled to twenty countries in five years (an itinerary few would attempt).',
      'The tour raised more than the mailings had (see the figures below).',
      'Two biographers disagree (Walker and Paris).',
      'The claim rests on one account (Smith).'
    ]) {
      deepStrictEqual(findCitationDefects(text, YEAR), [], text)
    }
  })

  it('does not flag "Anonymous", which is a real attribution', () => {
    deepStrictEqual(findCitationDefects('The pamphlet circulated widely (Anonymous, 1789).', YEAR), [])
  })

  it('does not flag the same work cited twice in one paragraph', () => {
    const text =
      'The ration fell that winter (Walker, 2010). Relief convoys arrived only in May (Walker, 2010).'
    deepStrictEqual(findCitationDefects(text, YEAR), [])
  })
})

describe('findCitationDefects — placeholders', () => {
  it('flags an author that was never filled in', () => {
    for (const text of [
      'Hepburn raised money via silent dance performances (Unknown Author, 2025).',
      'The figure is disputed (Author Name, 2019).',
      'A later account says otherwise (TBD, 2020).'
    ]) {
      ok(kinds(text).includes('placeholder-author'), text)
    }
  })

  it('flags a note to self where a reference should be', () => {
    for (const text of [
      'The ration fell to four hundred calories [citation needed].',
      'Two accounts agree on this (citation).',
      'She said as much in an interview (add citation).'
    ]) {
      ok(kinds(text).includes('placeholder-citation'), text)
    }
  })

  it('flags a bare link standing in for a reference', () => {
    ok(kinds('The archive holds the letters (https://example.org/archive/1944).').includes('bare-url'))
  })
})

describe('findCitationDefects — dates', () => {
  it('flags a year that has not happened yet', () => {
    const [defect] = findCitationDefects('A recent study confirms it (Walker, 2029).', YEAR)
    strictEqual(defect.kind, 'future-year')
    ok(defect.message.includes('2029'))
  })

  it('accepts the current year', () => {
    deepStrictEqual(findCitationDefects('A recent study confirms it (Walker, 2026).', YEAR), [])
  })

  it('names an undated source without calling it an error', () => {
    const [defect] = findCitationDefects('The page gives no date (Walker, n.d.).', YEAR)
    strictEqual(defect.kind, 'undated')
    // Correct APA style, so the message has to say "check", not "fix".
    ok(defect.message.includes('correct style'))
  })
})

describe('findCitationDefects — duplicates', () => {
  // The owner's own draft, 2026-08-19: the report quoted the sentence back
  // with its reference pasted twice.
  it('flags the same reference twice in a row', () => {
    const text =
      'She delivered newspapers and took messages to downed Allied flyers (Lähteenmäki, 2006) (Lähteenmäki, 2006).'
    const [defect] = findCitationDefects(text, YEAR).filter((d) => d.kind === 'duplicated')
    ok(defect)
    ok(defect.text.includes('(Lähteenmäki, 2006) (Lähteenmäki, 2006)'))
  })

  it('does not flag two real citations separated by prose', () => {
    const text = 'One account (Walker, 2010) and, writing later, another (Walker, 2010) agree.'
    strictEqual(kinds(text).includes('duplicated'), false)
  })
})

describe('findCitationDefects — shape', () => {
  it('returns nothing for text with no citations', () => {
    deepStrictEqual(findCitationDefects('She delivered newspapers for the resistance.', YEAR), [])
    deepStrictEqual(findCitationDefects('', YEAR), [])
  })

  it('offsets slice back to the reference, and results are in document order', () => {
    const text = 'First (Unknown Author, 2025) and then (Walker, 2029) and finally [citation needed].'
    const defects = findCitationDefects(text, YEAR)
    strictEqual(defects.length, 3)
    for (const defect of defects) {
      strictEqual(text.slice(defect.start, defect.end), defect.text)
      ok(defect.message.trim().length > 0, defect.kind)
    }
    for (let i = 1; i < defects.length; i++) ok(defects[i].start >= defects[i - 1].start)
  })
})
