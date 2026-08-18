import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  absenceIsInformative,
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

  // Measured live 2026-08-17: the invented pair "Ramirez and Doyle, 2021" was
  // corroborated by Open Library's *Believe Me*, a thirty-contributor anthology
  // carrying a Mónica Ramírez and a Jude Ellison S. Doyle, with a 2020 edition
  // inside YEAR_TOLERANCE. Both real people; the cited study is not.
  it('refuses a multi-contributor volume, where carrying both names proves nothing', () => {
    const anthology = [
      {
        title: 'Believe Me',
        authorSurnames: [
          'Valenti', 'Friedman', 'Chemaly', 'Donegan', 'Pressley', 'Serano', 'Lithwick',
          'Irby', 'Doyle', 'Smith', 'Maslany', 'Deer', 'Clairmont', 'Cross', 'McDonald',
          'Horn', 'Patterdale', 'Lubchansky', 'Bhagwati', 'Malone', 'Ross', 'Pino-Silva',
          'Scott', 'Duckett', 'Ramirez', 'Susskind', 'Mohammed', 'Brigida', 'Issa', 'Ikeda'
        ],
        year: 2017,
        years: [2017, 2020]
      }
    ]
    strictEqual(corroborate(first('Ramirez and Doyle (2021) found this.'), anthology).found, false)
  })

  // The ceiling is double the largest author list on any of the 36 corroborated
  // real references in eval/fabrication — Banting & Best 1922 and Press &
  // Teukolsky 1986, at five. A five-author paper must keep corroborating.
  it('still corroborates a paper with a normal-sized author list', () => {
    const paper = [
      {
        title: 'The effects of insulin on experimental hyperglycemia',
        authorSurnames: ['Banting', 'Best', 'Collip', 'Campbell', 'Fletcher'],
        year: 1922
      }
    ]
    strictEqual(corroborate(first('Banting and Best (1922) found this.'), paper).found, true)
  })

  // A reference resolved from a bibliography entry carries every author of a
  // large paper, and there the long list is evidence FOR the match. The ceiling
  // scales so it cannot punish that.
  it('lets a many-named reference match a many-authored work', () => {
    const many = Array.from({ length: 14 }, (_, i) => `Author${i}`)
    const ref14 = {
      raw: 'entry',
      kind: 'bibliographic' as const,
      surnames: many,
      year: 2020,
      title: null,
      etAl: false,
      entry: 'a reference list entry'
    }
    strictEqual(corroborate(ref14, [{ title: 'A big collaboration', authorSurnames: many, year: 2020 }]).found, true)
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

describe('index quirks that produced a false accusation', () => {
  const strunk = first('as (Strunk & White, 2000) advise.')

  it('sees past a generational suffix on the surname', () => {
    // Open Library records The Elements of Style under "William Strunk, Jr.",
    // which normalises to `william strunk jr` — so a citation's "Strunk" matched
    // neither the whole name nor its ending, and the one book both indexes
    // actually hold came back uncorroborated. Applies to Crossref equally; the
    // book index only made it visible.
    const works = [
      { title: 'The Elements of Style', authorSurnames: ['William Strunk, Jr.', 'E. B. White'], year: 1920, years: [1999, 2000, 2001] }
    ]
    strictEqual(corroborate(strunk, works).found, true)
  })

  it('matches an edition year rather than the first printing', () => {
    // A book is cited by the edition in the student's hands. Testing the first
    // publication year alone rejected four of fourteen real books.
    const works = [
      { title: 'Algorithms', authorSurnames: ['Robert Sedgewick', 'Kevin Wayne'], year: 2016, years: [2011, 2016] }
    ]
    strictEqual(corroborate(first('per (Sedgewick & Wayne, 2011).'), works).found, true)
  })

  it('still rejects a real work by the same pair in the wrong decade', () => {
    // The near miss that makes the year test earn its place: Open Library has a
    // real 2017 book by a Ramirez and a Doyle, and the invented citation says
    // 2024. Without the year test that fabrication corroborates.
    const works = [
      { title: 'Believe Me', authorSurnames: ['Ramirez', 'Doyle'], year: 2017, years: [2017] }
    ]
    strictEqual(corroborate(first('Ramirez and Doyle (2024) found this.'), works).found, false)
  })

  it('does not let a suffix strip turn a one-word name into nothing', () => {
    const works = [{ title: 'A paper', authorSurnames: ['Jr'], year: 2020, years: [] }]
    strictEqual(corroborate(first('(Smith & Jones, 2020) report this.'), works).found, false)
  })
})

describe('the yearless shapes — corroboration only', () => {
  it('reads an author pair with no year, when the sentence reports a finding', () => {
    const ref = first('Reinhart and Rogoff found that public debt above ninety percent lowers growth.')
    strictEqual(ref.kind, 'author-noyear')
    deepStrictEqual(ref.surnames, ['Reinhart', 'Rogoff'])
    strictEqual(ref.year, null)
    ok(isCheckable(ref))
  })

  it('reads a possessive author and the work they wrote', () => {
    const ref = first("Nancy Hoffman's Schooling in the Workplace argues that vocational training is stigmatised.")
    strictEqual(ref.kind, 'author-title')
    deepStrictEqual(ref.surnames, ['Hoffman'])
    strictEqual(ref.title, 'Schooling in the Workplace')
    ok(isCheckable(ref))
  })

  it('needs a reporting verb, so a band is not an author pair', () => {
    // The verb is the only thing separating the two. Without it "Simon and
    // Garfunkel" has the identical shape to "Reinhart and Rogoff".
    deepStrictEqual(parseReferences('Simon and Garfunkel sang about it for years.'), [])
    deepStrictEqual(parseReferences('My uncle and my aunt argued about the cost.'), [])
  })

  it('NEVER reports the absence of a yearless reference', () => {
    // The load-bearing rule. Measured over 19 essays, the pair pattern also
    // matched "Romeo and Juliet describes a feud" and "Ben and Jerry report
    // record sales" — a play and a company. Telling the critique "no work by
    // Romeo and Juliet was found" would put a fabrication accusation on a
    // sentence that cited nothing at all.
    strictEqual(absenceIsInformative(first('Romeo and Juliet describes a feud.')), false)
    strictEqual(absenceIsInformative(first("Luther's Ninety-Five Theses circulated widely.")), false)
    // The shape that HAS been measured at 0/36 false alarms keeps its voice.
    strictEqual(absenceIsInformative(first('Ramirez and Doyle (2024) found this.')), true)
  })

  it('does not double-count a reference that has a year', () => {
    // "Smith and Jones (2020) found" matches both the narrative pattern and the
    // yearless one. The dated reading is the better one and must win.
    const refs = parseReferences('Smith and Jones (2020) found that it works.')
    strictEqual(refs.length, 1)
    strictEqual(refs[0].kind, 'author-year')
  })

  it('requires the title to match, not just the surname', () => {
    // Measured: "Nancy Hoffman's Schooling in the Workplace" was corroborated
    // by a paper called "HIV Disease and Work" on the surname alone, which puts
    // a false statement in front of the critique. A named work must be THE
    // named work.
    const ref = first("Nancy Hoffman's Schooling in the Workplace argues this.")
    const wrong = [{ title: 'HIV Disease and Work: Effect on the Workplace', authorSurnames: ['Hoffman'], year: 1997 }]
    strictEqual(corroborate(ref, wrong).found, false)
    const right = [{ title: 'Schooling in the Workplace', authorSurnames: ['Nancy Hoffman'], year: 2011 }]
    strictEqual(corroborate(ref, right).found, true)
  })

  it('tolerates a subtitle or a shortened title', () => {
    const ref = first("Luther's Ninety-Five Theses circulated widely.")
    const works = [{ title: 'Ninety-Five Theses: On the Power of Indulgences', authorSurnames: ['Luther'], year: 1517 }]
    strictEqual(corroborate(ref, works).found, true)
  })

  it('ignores the year test when the reference never named one', () => {
    const ref = first('Reinhart and Rogoff found that debt lowers growth.')
    const works = [{ title: 'Growth in a Time of Debt', authorSurnames: ['Reinhart', 'Rogoff'], year: 2010 }]
    strictEqual(corroborate(ref, works).found, true)
  })
})

describe('absenceIsInformative — web sources', () => {
  const webEntry = (entry: string) =>
    absenceIsInformative({
      kind: 'bibliographic' as const,
      raw: '[1]',
      surnames: ['Contributors'],
      year: 2024,
      title: null,
      entry
    } as never)

  /**
   * The reported case. Crossref registers DOIs; a Wikipedia article has none,
   * so an empty lookup says nothing about the citation and everything about
   * the index. Treating it as informative fed a "not corroborated" fact to the
   * critique about a source that was never going to be there.
   */
  it('does not treat a missing Wikipedia article as informative', () => {
    strictEqual(
      webEntry(
        'Wikipedia contributors. (2024). Desirable difficulty. In Wikipedia. https://en.wikipedia.org/wiki/Desirable_difficulty'
      ),
      false
    )
  })

  it('covers the other reference-list shapes that carry a link', () => {
    strictEqual(webEntry('World Bank. (2023). Access to electricity. Retrieved from https://data.worldbank.org'), false)
    strictEqual(webEntry('Encyclopaedia Britannica. (2022). Printing press.'), false)
    strictEqual(webEntry('Ofsted. (2021). Annual report. https://gov.uk/ofsted'), false)
  })

  /**
   * The guard has to stay narrow. A normal journal entry that happens to print
   * its DOI as a link must still be checkable — that is most of the corpus, and
   * turning every one of them into "absence proves nothing" would disable the
   * fabrication check entirely.
   */
  it('still checks a journal article that prints its DOI as a link', () => {
    // The over-match that a bare `https?://` alternative caused, and the reason
    // it came out: a properly formatted APA entry ends in its DOI link, so
    // "any URL means a web source" disabled the fabrication check for most of
    // the corpus it exists to test.
    strictEqual(
      absenceIsInformative({
        kind: 'bibliographic' as const,
        raw: '[3]',
        surnames: ['Mueller', 'Oppenheimer'],
        year: 2014,
        title: 'The Pen Is Mightier Than the Keyboard',
        entry:
          'Mueller, P. A., & Oppenheimer, D. M. (2014). The Pen Is Mightier Than the Keyboard. Psychological Science. https://doi.org/10.1177/0956797614524581'
      } as never),
      true
    )
  })

  it('still checks an ordinary journal article', () => {
    strictEqual(
      absenceIsInformative({
        kind: 'bibliographic' as const,
        raw: '[2]',
        surnames: ['Mueller', 'Oppenheimer'],
        year: 2014,
        title: 'The Pen Is Mightier Than the Keyboard',
        entry:
          'Mueller, P. A., & Oppenheimer, D. M. (2014). The Pen Is Mightier Than the Keyboard. Psychological Science.'
      } as never),
      true
    )
  })
})
