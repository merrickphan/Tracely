import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  corroborate,
  crossrefReferenceQueries,
  isCheckable,
  parseReferences
} from './citedReference.ts'

const first = (sentence: string) => parseReferences(sentence)[0]

describe('parseReferences — pulling the named work out of a sentence', () => {
  it('reads a narrative pair, which is the shape a fabrication takes', () => {
    const ref = first('Ramirez and Doyle (2024) found that students improved by 23 percent.')
    deepStrictEqual(ref.surnames, ['Ramirez', 'Doyle'])
    strictEqual(ref.year, 2024)
    strictEqual(ref.kind, 'author-year')
    strictEqual(ref.raw, 'Ramirez and Doyle (2024)')
  })

  it('reads the parenthetical forms, ampersand and comma alike', () => {
    deepStrictEqual(first('a national sample (Minges & Redeker, 2016).').surnames, ['Minges', 'Redeker'])
    deepStrictEqual(first('this is biological (Carskadon, 2011).').surnames, ['Carskadon'])
    deepStrictEqual(first('three of them (Smith, Jones, & Lee, 2020).').surnames, ['Smith', 'Jones', 'Lee'])
  })

  it('keeps a particle with its surname, since the index carries it', () => {
    deepStrictEqual(first('see (van Dijk, 2019).').surnames, ['van Dijk'])
  })

  it('drops a given name, because an index is queried on the family name', () => {
    deepStrictEqual(first('as (Tyche Hendricks, 2024) reports.').surnames, ['Hendricks'])
  })

  it('records et al. rather than inventing the authors it hides', () => {
    const ref = first('modest once income is controlled (Dunster et al., 2018).')
    deepStrictEqual(ref.surnames, ['Dunster'])
    strictEqual(ref.etAl, true)
  })

  it('survives a page locator after the year', () => {
    const ref = first('the effect was small (Jacob & Rockoff, 2011: 14).')
    deepStrictEqual(ref.surnames, ['Jacob', 'Rockoff'])
    strictEqual(ref.year, 2011)
  })

  it('does not read a bare parenthesised year as a citation', () => {
    // "the rate rose (2019)" is a date far more often than a reference — the
    // same judgement inlineCitation.ts makes, for the same reason.
    deepStrictEqual(parseReferences('the rate rose sharply (2019) before falling.'), [])
  })

  it('separates an organisation from a person', () => {
    strictEqual(first('renewables grew (IEA, 2024).').kind, 'institutional')
    strictEqual(first('reported by (World Health Organization, 2021).').kind, 'institutional')
    strictEqual(first('as (Orben & Przybylski, 2019) showed.').kind, 'author-year')
  })

  it('reads a quoted title with no author as its own kind', () => {
    const ref = first('crash rates fell ("Later School Start Times and Crash Rates", 2018).')
    strictEqual(ref.kind, 'title-year')
    strictEqual(ref.title, 'Later School Start Times and Crash Rates')
    deepStrictEqual(ref.surnames, [])
  })

  it('finds every work a sentence names, once each', () => {
    const refs = parseReferences(
      'Both (Smith & Jones, 2019) and Brown and Green (2021) report this, as does (Smith & Jones, 2019).'
    )
    strictEqual(refs.length, 2)
  })
})

describe('isCheckable — refusing to answer where the check has no power', () => {
  it('checks a named pair, which is where fabrications live', () => {
    ok(isCheckable(first('Ramirez and Doyle (2024) found this.')))
  })

  it('declines a single author, because any surname corroborates', () => {
    // Measured 2026-08-16: "Dunster 2018" returns a blood coagulation paper and
    // "Barrero 2023" a Spanish public-procurement article. A single-surname
    // query corroborates on a coincidence — and would corroborate an INVENTED
    // single-author reference exactly as readily.
    strictEqual(isCheckable(first('this is biological (Carskadon, 2011).')), false)
    strictEqual(isCheckable(first('modest once controlled (Dunster et al., 2018).')), false)
  })

  it('declines an institution, which a scholarly index answers badly', () => {
    // A WHO report lives on WHO's site with no Crossref record. "Not found"
    // there carries no information, and acting on it would accuse a writer who
    // cited it properly.
    strictEqual(isCheckable(first('renewables grew (IEA, 2024).')), false)
    strictEqual(isCheckable(first('per (World Bank, 2024).')), false)
  })

  it('declines a title with no author', () => {
    strictEqual(isCheckable(first('crash rates fell ("Later School Start Times", 2018).')), false)
  })
})

describe('corroborate — did the index return the work that was named?', () => {
  const ref = first('Ramirez and Doyle (2024) found this.')

  it('needs EVERY cited surname on one work, not one of them', () => {
    // The whole basis of the check. Twenty works by a Ramirez in 2024 say
    // nothing; one work by both Ramirez and Doyle settles it.
    const near = [
      { title: 'Feedback sources in essay writing', authorSurnames: ['Banihashem', 'Noroozi'], year: 2024 },
      { title: 'Something by a Ramirez', authorSurnames: ['Ramirez', 'Lopez'], year: 2024 },
      { title: 'Something by a Doyle', authorSurnames: ['Doyle', 'Murphy'], year: 2024 }
    ]
    strictEqual(corroborate(ref, near).found, false)
  })

  it('corroborates when one work carries both, in any author order', () => {
    const hit = [{ title: 'A real paper', authorSurnames: ['Doyle', 'Okafor', 'Ramirez'], year: 2024 }]
    const result = corroborate(ref, hit)
    strictEqual(result.found, true)
    strictEqual(result.match?.title, 'A real paper')
  })

  it('allows a year to be one out, because online-first dates differ', () => {
    // An article carries one year in Crossref and another on the printed issue
    // a student cites from. Wheaton & Ferro was cited as 2016 and indexed as
    // 2015; without the tolerance a real citation reads as invented.
    const wheaton = first('Wheaton and Ferro (2016) found this.')
    const works = [{ title: 'School Start Times', authorSurnames: ['Wheaton', 'Ferro', 'Croft'], year: 2015 }]
    strictEqual(corroborate(wheaton, works).found, true)
  })

  it('does not allow a year to be two out', () => {
    const wheaton = first('Wheaton and Ferro (2016) found this.')
    const works = [{ title: 'School Start Times', authorSurnames: ['Wheaton', 'Ferro'], year: 2013 }]
    strictEqual(corroborate(wheaton, works).found, false)
  })

  it('matches a shortened surname against a compound one', () => {
    const dijk = first('(van Dijk & Poell, 2013) argue this.')
    const works = [{ title: 'Understanding Social Media Logic', authorSurnames: ['van Dijck', 'Poell'], year: 2013 }]
    // 'Dijk' is not 'Dijck' — a near miss must NOT corroborate, or the check
    // would confirm a reference to a work that does not exist under that name.
    strictEqual(corroborate(dijk, works).found, false)
  })

  it('folds diacritics, so an index spelling meets a typed one', () => {
    const angel = first('(Ángel & Moreau, 2020) report this.')
    const works = [{ title: 'A paper', authorSurnames: ['Angel', 'Moreau'], year: 2020 }]
    strictEqual(corroborate(angel, works).found, true)
  })

  it('is deliberately blind to topic', () => {
    // A reference that resolves to a real paper saying something ELSE is a
    // different problem — the writer misread their source — with its own
    // verdicts and its own repair. Reporting that as an invented citation would
    // be both wrong and the more serious of the two accusations.
    const works = [{ title: 'Something else entirely', authorSurnames: ['Ramirez', 'Doyle'], year: 2024 }]
    strictEqual(corroborate(ref, works).found, true)
  })

  it('finds nothing in an empty result set without throwing', () => {
    strictEqual(corroborate(ref, []).found, false)
    strictEqual(corroborate(ref, []).candidatesConsidered, 0)
  })
})

describe('crossrefReferenceQueries — two queries that fail in opposite directions', () => {
  const ref = first('Mueller and Oppenheimer (2014) found this.')

  it('asks twice when there is a sentence to anchor on', () => {
    const urls = crossrefReferenceQueries(ref, { context: 'students who typed notes on laptops' })
    strictEqual(urls.length, 2)
    // With context first: it rescues a common surname the index has thousands
    // of. Without context second: it rescues a sentence whose words the index
    // reads as terms of art — "typed" turned the most cited note-taking study
    // in psychology into twenty papers on typed lambda calculus.
    ok(urls[0].includes('laptops'))
    ok(!urls[1].includes('laptops'))
  })

  it('asks once when there is no context to add', () => {
    strictEqual(crossrefReferenceQueries(ref).length, 1)
  })

  it('bounds the year filter to the tolerance, not to the exact year', () => {
    const url = crossrefReferenceQueries(ref)[0]
    ok(url.includes('from-pub-date%3A2013-01-01'))
    ok(url.includes('until-pub-date%3A2015-12-31'))
  })

  it('does not leave the citation itself in the context terms', () => {
    const url = crossrefReferenceQueries(ref, { context: 'Mueller and Oppenheimer (2014) found this' })[0]
    // The surnames belong in the query once, as names. Twice is not better.
    strictEqual(url.split('Mueller').length - 1, 1)
  })

  it('returns nothing at all for a reference it declines to check', () => {
    deepStrictEqual(crossrefReferenceQueries(first('renewables grew (IEA, 2024).')), [])
    deepStrictEqual(crossrefReferenceQueries(first('this is biological (Carskadon, 2011).')), [])
  })
})
