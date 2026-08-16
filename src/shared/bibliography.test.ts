import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bibliographyReferences, parseBibliography, resolveMarkers } from './bibliography.ts'
import { absenceIsInformative, corroborate, crossrefReferenceQueries, isCheckable } from './citedReference.ts'

const IEEE = `Sleep timing shapes adolescent performance [1], and later start times raise
attendance [2].

References

[1] M. A. Carskadon and W. Dement, "Normal human sleep: an overview," Sleep Medicine Reviews, vol. 4, no. 1, pp. 12-24, 2011.
[2] K. Wahlstrom and J. Dretzke, Examining the Impact of Later High School Start Times. Minneapolis: Univ. of Minnesota, 2014.
`

const MLA = `Free parking is not free (Shoup 45). Statistical methods carry the same problem
(Manning and Schütze 210).

Works Cited

Shoup, Donald. The High Cost of Free Parking. Planners Press, 2005.
Manning, Christopher, and Hinrich Schütze. Foundations of Statistical Natural
Language Processing. MIT Press, 1999.
`

const APA = `The effect held across sites [1].

References

1. Minges, K. E., & Redeker, N. S. (2016). Delayed school start times and adolescent sleep. Sleep Medicine Reviews, 28, 86-95.
`

describe('parseBibliography — reading the list a marker points into', () => {
  it('reads an IEEE numbered list, initials first', () => {
    const entries = parseBibliography(IEEE)
    strictEqual(entries.length, 2)
    strictEqual(entries[0].marker, '1')
    deepStrictEqual(entries[0].surnames, ['Carskadon', 'Dement'])
    strictEqual(entries[0].year, 2011)
    strictEqual(entries[0].title, 'Normal human sleep: an overview')
  })

  it('keeps an unquoted IEEE title out of the author list', () => {
    // "K. Wahlstrom and J. Dretzke, Examining the Impact of..." has no quote to
    // stop at, so the author segment runs into the title. The anchoring rule is
    // what keeps title words from becoming surnames.
    const entry = parseBibliography(IEEE)[1]
    deepStrictEqual(entry.surnames, ['Wahlstrom', 'Dretzke'])
    strictEqual(entry.year, 2014)
  })

  it('does not take a title word for a third author, however well anchored the list', () => {
    // Measured failure, 46/46 (eval/bibliography/FINDINGS.md finding 1): the
    // real pair anchors the entry and "Statistical Learning" walks in behind
    // them. An invented surname makes corroboration impossible, and on an entry
    // carrying a year that is reported as absence.
    const doc = `References\n\n[1] A. Kahneman and B. Tversky, Neural Networks and Statistical Learning. Cambridge: Academic Press, 1979.\n`
    deepStrictEqual(parseBibliography(doc)[0].surnames, ['Kahneman', 'Tversky'])
  })

  it('reads no title at all from an entry that does not mark where one starts', () => {
    // The title is INSIDE the author segment here, so anything past it is the
    // publisher's address — which then went into Open Library as a title filter
    // and lost a book the index holds.
    const doc = `References\n\n[1] R. Sedgewick and K. Wayne, Algorithms. Upper Saddle River, NJ: Addison-Wesley, 2011.\n`
    const entry = parseBibliography(doc)[0]
    deepStrictEqual(entry.surnames, ['Sedgewick', 'Wayne'])
    strictEqual(entry.year, 2011)
    strictEqual(entry.title, null)
  })

  it('reads an MLA list, first author inverted and the rest not', () => {
    const entries = parseBibliography(MLA)
    strictEqual(entries.length, 2)
    deepStrictEqual(entries[0].surnames, ['Shoup'])
    strictEqual(entries[0].year, 2005)
    strictEqual(entries[0].title, 'The High Cost of Free Parking')
    deepStrictEqual(entries[1].surnames, ['Manning', 'Schütze'])
    strictEqual(entries[1].year, 1999)
  })

  it('rejoins an entry that wrapped across lines', () => {
    // The MLA fixture breaks "Foundations of Statistical Natural / Language
    // Processing" mid-title; a split there would lose the year on the next line.
    ok(parseBibliography(MLA)[1].raw.includes('Language Processing'))
  })

  it('reads an APA list, taking the year from its parentheses', () => {
    const entry = parseBibliography(APA)[0]
    deepStrictEqual(entry.surnames, ['Minges', 'Redeker'])
    strictEqual(entry.year, 2016)
    strictEqual(entry.title, 'Delayed school start times and adolescent sleep')
  })

  it('finds nothing in a document with no reference list', () => {
    deepStrictEqual(parseBibliography('Sleep matters [1]. It really does [2].'), [])
  })

  it('does not mistake prose for a list because it says "references"', () => {
    deepStrictEqual(
      parseBibliography('Prior references disagree about this.\n\nSleep matters.'),
      []
    )
  })

  it('takes the LAST heading, so an early mention does not hijack the search', () => {
    const doc = `References to this work vary.\n\nBody text here.\n\nReferences\n\nShoup, Donald. The High Cost of Free Parking. Planners Press, 2005.\n`
    const entries = parseBibliography(doc)
    strictEqual(entries.length, 1)
    deepStrictEqual(entries[0].surnames, ['Shoup'])
  })

  it('ignores an access date when taking the publication year', () => {
    const doc = `Works Cited\n\nShoup, Donald. The High Cost of Free Parking. Planners Press, 2005. Accessed 12 Mar. 2021.\n`
    strictEqual(parseBibliography(doc)[0].year, 2005)
  })

  it('drops an entry with no identifiable author rather than inventing one', () => {
    const doc = `References\n\n"Later School Start Times." State Board of Education, 2018.\n`
    deepStrictEqual(parseBibliography(doc), [])
  })
})

describe('resolveMarkers — pointing a sentence at an entry', () => {
  it('resolves a numeric marker to its entry, with every author the entry names', () => {
    const [ref] = bibliographyReferences('Sleep timing shapes performance [1].', IEEE)
    strictEqual(ref.kind, 'bibliographic')
    strictEqual(ref.raw, '[1]')
    deepStrictEqual(ref.surnames, ['Carskadon', 'Dement'])
    strictEqual(ref.year, 2011)
    ok(ref.entry?.startsWith('M. A. Carskadon'))
  })

  it('resolves a list and a range', () => {
    const doc = IEEE.replace('[1], and', '[1, 2], and')
    strictEqual(bibliographyReferences('Sleep timing shapes performance [1, 2].', doc).length, 2)
    strictEqual(bibliographyReferences('Sleep timing shapes performance [1-2].', IEEE).length, 2)
  })

  it('resolves MLA author-page by surname', () => {
    const [ref] = bibliographyReferences('Free parking is not free (Shoup 45).', MLA)
    deepStrictEqual(ref.surnames, ['Shoup'])
    strictEqual(ref.year, 2005)
    strictEqual(ref.title, 'The High Cost of Free Parking')
  })

  it('resolves a two-author MLA citation, which the entry turns into a checkable pair', () => {
    const [ref] = bibliographyReferences('The same problem (Manning and Schütze 210).', MLA)
    deepStrictEqual(ref.surnames, ['Manning', 'Schütze'])
    strictEqual(absenceIsInformative(ref), true)
  })

  it('leaves an author-date citation alone, so it is not counted twice', () => {
    // "(Shoup 2005)" is citedReference.ts's shape; a year-shaped number is not
    // a page number.
    deepStrictEqual(bibliographyReferences('Parking is underpriced (Shoup 2005).', MLA), [])
  })

  it('refuses an ambiguous surname rather than guessing which work was cited', () => {
    const doc = `Works Cited\n\nShoup, Donald. The High Cost of Free Parking. Planners Press, 2005.\nShoup, Donald. Parking and the City. Routledge, 2018.\n`
    deepStrictEqual(bibliographyReferences('As argued (Shoup 45).', doc), [])
  })

  it('returns nothing for a marker with no list behind it', () => {
    deepStrictEqual(bibliographyReferences('Sleep matters [1].', 'Sleep matters [1].'), [])
    deepStrictEqual(resolveMarkers('Sleep matters [1].', []), [])
  })
})

describe('what a resolved marker is allowed to say', () => {
  it('may accuse only on two named authors and a year, exactly as author-date does', () => {
    const [pair] = bibliographyReferences('Sleep timing shapes performance [1].', IEEE)
    strictEqual(absenceIsInformative(pair), true)

    const [single] = bibliographyReferences('Free parking is not free (Shoup 45).', MLA)
    strictEqual(isCheckable(single), true)
    // One surname: corroboration only. A query for "Shoup 2005" returns a work
    // by SOMEONE of that name essentially always, so its absence would mean
    // nothing and its presence is only ever reassurance.
    strictEqual(absenceIsInformative(single), false)
  })

  it('will not accuse an entry whose own venue says neither index covers it', () => {
    // "Attention is all you need" is in neither Crossref nor Open Library. An
    // inline citation cannot know that; a reference list states the venue.
    const doc = `References\n\n[1] A. Vaswani and N. Shazeer, "Attention is all you need," Advances in Neural Information Processing Systems, 2017.\n`
    const [ref] = bibliographyReferences('Transformers changed the field [1].', doc)
    deepStrictEqual(ref.surnames, ['Vaswani', 'Shazeer'])
    strictEqual(isCheckable(ref), true)
    strictEqual(absenceIsInformative(ref), false)
  })

  it('searches the entry itself, which is what query.bibliographic is for', () => {
    const [ref] = bibliographyReferences('Sleep timing shapes performance [1].', IEEE)
    const [entryQuery, nameQuery] = crossrefReferenceQueries(ref, { context: 'Sleep timing shapes performance.' })
    const readable = (url: string) => decodeURIComponent(url.replace(/\+/g, ' '))
    ok(readable(entryQuery).includes('Sleep Medicine Reviews'))
    ok(readable(nameQuery).includes('Carskadon Dement 2011'))
    ok(entryQuery.includes('from-pub-date%3A2010'))
  })

  it('does not let the entry title veto a match the authors and year already made', () => {
    // The reference list says "Normal human sleep: an overview"; Crossref
    // carries it with a subtitle the two-thirds token test misses. Two surnames
    // and a year decided this case before titles existed, and they still do —
    // otherwise a real source would come back reported absent.
    const [ref] = bibliographyReferences('Sleep timing shapes performance [1].', IEEE)
    const result = corroborate(ref, [
      {
        title: 'Normal human sleep',
        authorSurnames: ['Carskadon', 'Dement'],
        year: 2011
      }
    ])
    strictEqual(result.found, true)
  })

  it('still requires the title when the title is all the discrimination there is', () => {
    const [ref] = bibliographyReferences('Free parking is not free (Shoup 45).', MLA)
    const result = corroborate(ref, [
      { title: 'HIV Disease and Work', authorSurnames: ['Shoup'], year: 2005 }
    ])
    strictEqual(result.found, false)
  })
})
