import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasInlineCitation,
  hasInlineCitationNear,
  inlineCitationKind,
  sentenceAround,
  sentenceRangeAround
} from './inlineCitation.ts'

describe('hasInlineCitation — finds what a writer actually types', () => {
  const cited = [
    'Laptop users score lower on conceptual questions (Mueller & Oppenheimer, 2014).',
    'Screen time is associated with lower wellbeing (Twenge et al., 2018).',
    'Renewables passed 30% of generation (IEA, 2024).',
    'Mueller and Oppenheimer (2014) found lower conceptual scores.',
    'Twenge et al. (2018) report a dose-response relationship.',
    'Sana (2013) showed nearby students are affected too.',
    'The effect replicates across cohorts [12].',
    'Two independent trials found the same thing [1,2].',
    'Later replications disagree [4-7].',
    'See doi: 10.1016/j.chb.2023.107891 for the full method.',
    'Full text at https://doi.org/10.1073/pnas.2210918120.',
    'The figure is contested.¹'
  ]
  for (const sentence of cited) {
    it(`treats as cited: ${sentence.slice(0, 52)}…`, () => {
      strictEqual(hasInlineCitation(sentence), true)
    })
  }
})

describe('hasInlineCitation — MLA title citations, from a real position paper', () => {
  // Every one of these is lifted verbatim from a meticulously cited Model UN
  // position paper that Screen Watch flagged on almost every line. 26 of its
  // 34 citations were invisible to the first version of this module, because
  // they cite institutions rather than authors — and an institution is cited
  // by TITLE, in quotes, often with no year at all.
  const cited = [
    'The convention guarantees fair pay and fair trial ("Background to the Convention").',
    'Objective 17 works to eliminate hate speech ("International Migration.").',
    'Japan grants transport and legal help ("Support System for SSWs"; "Japan is looking for Specified Skilled Workers!").',
    'Migrants reached 3.9 million in 2025 ("Japan’s 2026 Election: Immigration Reform.").',
    'Only 38 of 180 countries improved ("Corruption Perceptions Index", 2024).',
    'Language was a significant challenge for 79% ("IOM Libya Migrant Report Round 44", 2022: 15).',
    'Governments use that gap to justify warrantless searches (Gregory P. Margarian, 2022: 23).',
    'One in seven avoid seeking medical care ("KFF/New York Times 2025 Survey of Immigrants: Worries and Experiences amid Increased Immigration Enforcement.").',
    'The EEOC enforces eight federal laws ("What Laws Does EEOC Enforce?").',
    'A former FIFA member was sentenced to nine years ("UNODC - Global Report On Corruption In Sport").',
    'Illegal betting reached a trillion yen ("Betting money from Japan, 6.5 trillion yen/illegal sports betting", 2025).',
    'Athletes want half the voting rights ("Global Athlete Survey Results: Athlete Rights, Welfare And Representation", 2020).'
  ]
  for (const sentence of cited) {
    it(`treats as cited: ${sentence.slice(0, 52)}…`, () => {
      strictEqual(hasInlineCitation(sentence), true)
    })
  }
})

describe('hasInlineCitation — MLA author-page, which has no year to anchor on', () => {
  // MLA keeps the year in the Works Cited only, so every author-date pattern in
  // this module missed the style outright — an MLA essay was told to add a
  // citation on each line that already had one.
  const cited = [
    'Parking minimums act as a hidden tax on housing (Shoup 45).',
    'The argument runs across three chapters (Shoup 45-47).',
    'Laptop users score lower on conceptual questions (Mueller and Oppenheimer 1163).',
    'Attendance improved in every cohort studied (Wahlstrom et al. 12).',
    'The reform stalled twice before passing (van Dijk 88).',
    'The survey covers eighty countries (Ólafsson 231).',
    'The chapter opens with the same objection (Shoup p. 45).'
  ]
  for (const sentence of cited) {
    it(`treats as cited: ${sentence.slice(0, 52)}…`, () => {
      strictEqual(hasInlineCitation(sentence), true)
    })
  }
})

describe('hasInlineCitation — names the ASCII-capital anchor used to miss', () => {
  const cited = [
    'Trust in institutions declined over the period (van Dijk, 2019).',
    'The concept originates in this work (de Beauvoir, 1949).',
    'The survey found the opposite (Ángel, 2020).',
    'Attendance rose after the change (Ólafsson, 2019).'
  ]
  for (const sentence of cited) {
    it(`treats as cited: ${sentence.slice(0, 52)}…`, () => {
      strictEqual(hasInlineCitation(sentence), true)
    })
  }
})

describe('hasInlineCitation — notes shorthand and bare-scheme URLs', () => {
  const cited = [
    'The same source makes the point again (ibid.).',
    'The figure is repeated later in the chapter (Ibid., 47).',
    'The earlier objection still stands (op. cit.).',
    'The full series is at www.oecd.org/education/report.pdf.'
  ]
  for (const sentence of cited) {
    it(`treats as cited: ${sentence.slice(0, 52)}…`, () => {
      strictEqual(hasInlineCitation(sentence), true)
    })
  }
})

/**
 * Prose attribution — the citation shape that has no brackets in it at all.
 *
 * Owner, 2026-08-19: *"a citation doesn't need to have parentheses directly at
 * the very end. It could be at the very start, like if it says 'according to
 * Pearson from UNICEF.' Be smart about this, because there is not just one way
 * to cite stuff."*
 */
describe('hasInlineCitation — a source named in prose', () => {
  it('finds "according to", wherever the sentence puts it', () => {
    ok(hasInlineCitation('According to UNICEF, she made fifteen field visits.'))
    ok(hasInlineCitation('According to Pearson from UNICEF, the camps were overcrowded.'))
    // Lowercase mid-sentence, and a multi-word institution behind "the".
    ok(
      hasInlineCitation(
        'The rate doubled, according to the World Health Organization, before aid arrived.'
      )
    )
  })

  it('finds a reporting verb attached to a named source', () => {
    ok(hasInlineCitation('As Walker notes, she rarely spoke of it afterwards.'))
    // A multi-word name has to fit in the gap before the verb, which is why it
    // cannot be restricted to lowercase filler.
    ok(hasInlineCitation('As the Red Cross reported, the camps were full by December.'))
    ok(hasInlineCitation('As van Dijk observed, the effect is smaller than claimed.'))
  })

  it('finds the passive form and the possessive form', () => {
    ok(hasInlineCitation('The figure was first published in the Lancet.'))
    ok(hasInlineCitation('These numbers were compiled by Statistics Netherlands.'))
    ok(hasInlineCitation("UNICEF's own records put the number higher."))
    ok(hasInlineCitation("Walker's biography covers the war years in detail."))
  })

  it('reports it as its own kind', () => {
    strictEqual(inlineCitationKind('According to UNICEF, she visited Ethiopia.'), 'attributed')
  })

  /**
   * The deliberate gap. In an essay ABOUT a person, `Name verb that …`
   * attributes to its own subject and cites nothing — it is far too common in
   * biography and history to read as a reference, so every pattern requires a
   * word that only appears when the writer is pointing AT a source.
   */
  it('does not read a subject speaking as a citation', () => {
    strictEqual(hasInlineCitation('Hepburn argued that the war changed her outlook.'), false)
    strictEqual(hasInlineCitation('She wrote that she was hungry for most of 1944.'), false)
    strictEqual(hasInlineCitation('She found the work exhausting but necessary.'), false)
  })

  it('does not fire on prose that merely starts the same way', () => {
    // "plan" is lowercase, so there is no named source to attribute to.
    strictEqual(hasInlineCitation('According to plan, the family left before winter.'), false)
    strictEqual(
      hasInlineCitation('She devolved anemia and oedema because of her malnutrition.'),
      false
    )
    strictEqual(hasInlineCitation('Audrey moved to Arnhem and stayed for the duration.'), false)
  })
})

describe('hasInlineCitation — does not fire on ordinary prose', () => {
  const uncited = [
    'Screen time causes depression in teenagers.',
    // A year in parentheses is a date far more often than a reference, which is
    // why a bare parenthesised year is deliberately not a pattern.
    'The rate rose sharply (up from 2019).',
    'Emissions fell by a fifth (down 4% since 2015).',
    'Renewables now account for nearly 30% of global electricity generation.',
    'Some researchers argue the effect sizes are trivially small.',
    'In 2020, the policy was reversed.',
    'The study cost £2.3m and ran for three years.',
    'See the appendix (page 14) for the full table.',
    'Handwriting is the oldest form of note-taking.',
    // The 6-character floor inside the quotes is what keeps short quoted
    // speech out of the `titled` pattern.
    'He shrugged ("no") and walked out.',
    // A capitalised word beside a bare number is the entire MLA author-page
    // signature, so these pointers need NOT_AN_AUTHOR to hold them back.
    'The breakdown by year is in Table 3 (Table 3).',
    'The argument is developed further (Chapter 11).',
    'Assessed values were frozen (Proposition 13).',
    'Enforcement continued under the rule (Title 42).',
    'The trend is clearest here (Figure 2).',
    'The committee met twice (Planning Committee).'
  ]
  for (const sentence of uncited) {
    it(`treats as uncited: ${sentence.slice(0, 52)}…`, () => {
      strictEqual(hasInlineCitation(sentence), false)
    })
  }
})

describe('inlineCitationKind', () => {
  it('names which pattern matched, for the debug log', () => {
    strictEqual(inlineCitationKind('Laptops lower grades (Smith, 2020).'), 'parenthetical')
    strictEqual(inlineCitationKind('Smith (2020) found the effect.'), 'narrative')
    strictEqual(inlineCitationKind('The effect replicates [3].'), 'numeric')
    strictEqual(inlineCitationKind('It is a hidden tax (Shoup 45).'), 'author-page')
    strictEqual(inlineCitationKind('The point recurs (ibid.).'), 'ibid')
    strictEqual(inlineCitationKind('Nothing here.'), null)
  })

  it('is stateless across calls', () => {
    // The patterns are module-level and would carry lastIndex between calls if
    // any of them were ever given the /g flag.
    const s = 'Laptops lower grades (Smith, 2020).'
    strictEqual(hasInlineCitation(s), true)
    strictEqual(hasInlineCitation(s), true)
  })
})

describe('sentenceAround — a claim is a sub-span, not a sentence', () => {
  // The reported failure, verbatim. The relay returns the assertion and stops
  // before the citation, so testing the claim string alone found nothing while
  // the sentence it came from matches on the first pattern in the file.
  const doc =
    'Migration is rising across the region. Increased xenophobia has caused migrants to fear speaking out for their fundamental rights due to risks to their livelihood such as the risk of being deported, cultural barriers, and anti-migrant sentiment (Tyche Hendricks, 2024). Policy has not kept pace.'
  const claim =
    'Increased xenophobia has caused migrants to fear speaking out for their fundamental rights due to risks to their livelihood such as the risk of being deported, cultural barriers, and anti-migrant sentiment'
  const start = doc.indexOf(claim)
  const end = start + claim.length

  it('does not find the citation in the claim span alone', () => {
    strictEqual(hasInlineCitation(claim), false)
  })

  it('finds it once the claim is read in its sentence', () => {
    strictEqual(hasInlineCitationNear(doc, start, end), true)
  })

  it('widens forward to the citation and no further', () => {
    const s = sentenceAround(doc, start, end)
    strictEqual(s.includes('(Tyche Hendricks, 2024)'), true)
    strictEqual(s.includes('Policy has not kept pace'), false)
    strictEqual(s.includes('Migration is rising'), false)
  })

  it('does not borrow the NEXT sentence’s citation', () => {
    const d = 'Renewables are growing fast. Solar costs fell again (IEA, 2024).'
    const c = 'Renewables are growing fast'
    strictEqual(hasInlineCitationNear(d, d.indexOf(c), d.indexOf(c) + c.length), false)
  })

  it('does not borrow the PREVIOUS sentence’s citation', () => {
    const d = 'Solar costs fell again (IEA, 2024). Renewables are growing fast.'
    const c = 'Renewables are growing fast'
    strictEqual(hasInlineCitationNear(d, d.indexOf(c), d.indexOf(c) + c.length), false)
  })

  it('is not cut short by a full stop INSIDE the citation brackets', () => {
    // "et al." ends in a period; at bracket depth zero that would terminate the
    // sentence before the year and lose the match.
    const d = 'Screen time tracks lower wellbeing (Twenge et al., 2018).'
    const c = 'Screen time tracks lower wellbeing'
    strictEqual(hasInlineCitationNear(d, d.indexOf(c), d.indexOf(c) + c.length), true)
  })

  it('stops at a paragraph break', () => {
    const d = 'Costs are falling\nOther work disagrees (Smith, 2020).'
    const c = 'Costs are falling'
    strictEqual(hasInlineCitationNear(d, 0, c.length), false)
  })

  it('is unchanged when the claim already spans its whole sentence', () => {
    const d = 'Laptop users score lower (Mueller & Oppenheimer, 2014).'
    strictEqual(hasInlineCitationNear(d, 0, d.length), true)
  })

  // Both found by `npm run eval:citations`, which measures this function the
  // way production uses it — with the citation OUTSIDE the span being tested.
  // Each pattern scored 100% when handed a whole sentence and 0% through a
  // span, which is a window bug wearing a detection bug's clothes.

  it('reaches a footnote mark, which sits past the full stop', () => {
    // Chicago scored 5/5 by sentence and 1/5 by span: the window closed on the
    // terminator and the mark was one character outside it, every time.
    const d = 'The printing press changed how fast dissent could travel.¹ Manuscripts were slower.'
    const c = 'The printing press changed how fast dissent could travel'
    strictEqual(hasInlineCitation(c), false)
    strictEqual(hasInlineCitationNear(d, 0, c.length), true)
    strictEqual(sentenceAround(d, 0, c.length).includes('Manuscripts'), false)
  })

  it('does not mistake the dots inside a URL or DOI for sentence ends', () => {
    // `doi` and `url` were both 100% by sentence and 0% by span: the window
    // stopped at the dot in `10.1257` and in `www.`, leaving a fragment with no
    // second dot for the pattern to match. A pasted link is how students cite
    // when they are not using a style guide at all.
    const doi = 'The clearest version of this argument is doi: 10.1257/aer.20191325 in the AER.'
    const claim = 'The clearest version of this argument is'
    strictEqual(hasInlineCitationNear(doi, 0, claim.length), true)

    const url = 'Employers reversed course, according to www.bls.gov/news.release/flex2.nr0.htm which shows otherwise.'
    const uClaim = 'Employers reversed course, according to'
    strictEqual(hasInlineCitationNear(url, 0, uClaim.length), true)

    // The rule is "no whitespace after the terminator", so a real boundary
    // still ends the window — a following sentence's citation is not borrowed.
    const two = 'Rates rose sharply. Other work disagrees (Smith, 2020).'
    strictEqual(hasInlineCitationNear(two, 0, 'Rates rose sharply'.length), false)
  })
})

/**
 * A claim span that ends exactly on its own full stop must not borrow the next
 * sentence's citation.
 *
 * Owner, 2026-08-19, on a sentence with no citation of any kind: *"why is it
 * asking to compare sources? It isn't even cited."* The forward walk began one
 * character past the claim's own terminator, so it never saw it and ran on
 * until the next one — taking the following sentence, and its ("Audrey"
 * UNICEF), with it. The relay returns whole sentences for a great many claims,
 * so this was the common case rather than an edge one.
 */
describe('sentenceAround — a span that already ends a sentence', () => {
  const para =
    'This was caused by the Nazis who wanted to kill the population by starving them to death. ' +
    'She devolved anemia, respiratory difficulties, and oedema because of her consequential malnutrition. ' +
    'Surviving on boiled grass, the people of Arnhem received medical help from UNICEF ("Audrey" UNICEF).'
  const claim =
    'She devolved anemia, respiratory difficulties, and oedema because of her consequential malnutrition.'

  it('stops at its own terminator instead of swallowing the next sentence', () => {
    const start = para.indexOf(claim)
    const window = sentenceAround(para, start, start + claim.length)
    strictEqual(window.includes('UNICEF'), false, window)
    strictEqual(hasInlineCitation(window), false, window)
  })

  it('still widens when the span stops SHORT of the sentence end', () => {
    // The reason sentenceAround exists: a detected claim is usually a sub-span,
    // and the citation sits after it.
    const cited = 'the people of Arnhem received medical help from UNICEF'
    const start = para.indexOf(cited)
    const window = sentenceAround(para, start, start + cited.length)
    strictEqual(hasInlineCitation(window), true, window)
  })

  it('is unaffected by trailing whitespace on the span', () => {
    const start = para.indexOf(claim)
    const window = sentenceAround(para, start, start + claim.length + 1)
    strictEqual(hasInlineCitation(window), false, window)
  })
})

/**
 * The offsets behind `sentenceAround`, which is what an EDIT needs.
 *
 * `replaceCitationText` used to require the broken citation to be unique in the
 * whole document, and refused otherwise — so a draft that pastes one malformed
 * reference after four sentences could never fix any of them. Owner,
 * 2026-08-20: *"this keeps appearing."* The card knows which claim it was
 * opened from; its sentence is the only place the replacement may land.
 */
describe('sentenceRangeAround', () => {
  it('agrees with sentenceAround, which is the point of extracting it', () => {
    const text = 'First one. The rate rose sharply (Smith, 2020). Third one here.'
    const at = text.indexOf('rate rose')
    const { from, to } = sentenceRangeAround(text, at, at + 9)
    strictEqual(text.slice(from, to), sentenceAround(text, at, at + 9))
  })

  it('bounds the claim to its own sentence, not its neighbours', () => {
    const text = 'Alpha (Unknown Author, 2025). Beta (Unknown Author, 2025). Gamma.'
    const at = text.indexOf('Beta')
    const { from, to } = sentenceRangeAround(text, at, at + 4)
    const sentence = text.slice(from, to)
    ok(sentence.includes('Beta'), sentence)
    strictEqual(sentence.includes('Alpha'), false, sentence)
    strictEqual(sentence.includes('Gamma'), false, sentence)
    // Exactly one copy in scope — which is what makes the replacement safe
    // while the document holds two.
    strictEqual(sentence.indexOf('(Unknown Author, 2025)'), sentence.lastIndexOf('(Unknown Author, 2025)'))
  })

  it('keeps a trailing citation inside the sentence that owns it', () => {
    // A detected claim is a sub-span that stops before the citation, so the
    // window has to reach past `end` or the edit cannot see what it is fixing.
    const text = 'She volunteered at the hospital (Unknown Author, 2025). Later she left.'
    const at = 0
    const { from, to } = sentenceRangeAround(text, at, text.indexOf(' ('))
    ok(text.slice(from, to).includes('(Unknown Author, 2025)'))
  })

  it('returns a range inside the text for a span at either edge', () => {
    const text = 'Only one sentence here.'
    deepStrictEqual(sentenceRangeAround(text, 0, 4), { from: 0, to: text.length })
    const end = sentenceRangeAround(text, text.length - 1, text.length)
    ok(end.from >= 0 && end.to <= text.length)
  })
})
