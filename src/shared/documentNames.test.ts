import { describe, it } from 'node:test'
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { documentNames } from './documentNames.ts'

/**
 * The failure to avoid is not "a name stayed underlined" — it is "a misspelling
 * stopped being underlined". Every negative case here is a word a looser rule
 * would teach the dictionary.
 */
describe('documentNames', () => {
  it('finds a recurring name used mid-sentence', () => {
    const text =
      'Audrey Hepburn was born in Brussels. The war reached Arnhem in 1944, and Hepburn was in Arnhem when it did.'
    const names = documentNames(text)
    ok(names.includes('Hepburn'), names.join(','))
    ok(names.includes('Arnhem'), names.join(','))
  })

  it('handles the accented names a bibliography is full of', () => {
    const name = 'Lähteenmäki'
    const text = `As ${name} notes, the winter was severe (${name}, 2006).`
    ok(documentNames(text).includes(name))
  })

  it('handles a hyphenated or apostrophised surname', () => {
    const text = "Iglesias-Muñoz disagreed. O’Brien cited Iglesias-Muñoz, and O’Brien said so again."
    const names = documentNames(text)
    ok(names.includes('Iglesias-Muñoz'), names.join(','))
    ok(names.includes('O’Brien'), names.join(','))
  })

  // The whole discriminator. Every sentence starts with a capital, so a word
  // capitalised ONLY there is evidence of nothing.
  it('ignores a word only ever capitalised at a sentence start', () => {
    const text = 'Rationing shaped her health. Rationing continued into 1946. Rationing ended later.'
    deepStrictEqual(documentNames(text), [])
  })

  // Changed from "ignores" on 2026-08-19. In a biography essay most proper
  // nouns appear once — English, Otto, Limburger, Stirim, Belgium, Brussels and
  // Allied were ALL blocked by the old two-occurrence bar on the owner's draft.
  // The protection it bought was narrow: Chromium cannot spellcheck a name it
  // has never heard of, so a misspelling of "Stirim" is no more underlined than
  // the correct spelling, and where the word IS in the dictionary teaching it
  // changes nothing.
  it('learns a name used once, mid-sentence', () => {
    deepStrictEqual(documentNames('The report by Smithe was published in 1990.'), ['Smithe'])
  })

  // The cost of the above, stated. A name typed once and misspelled stops being
  // underlined — but it was underlined for being UNKNOWN, not for being wrong,
  // so the writer could not have acted on it either way.
  it('still requires the mid-sentence signal, which is what does the work', () => {
    deepStrictEqual(documentNames('Smithe published in 1990. Smithe was ignored.'), [])
  })

  it('ignores ordinary capitalised English', () => {
    const text = 'However the data were thin. The results held. However the sample was small.'
    deepStrictEqual(documentNames(text), [])
  })

  // ALL-CAPS is held to the OLD two-occurrence bar rather than excluded. Upper
  // case is weaker evidence — a heading is capitalised for being a heading — so
  // recurrence is what separates an acronym the draft uses from a line that was
  // shouted once. UNICEF appeared six times in the owner's essay and was
  // rejected outright, which is the wrong reading of that evidence.
  it('learns an acronym the draft actually uses', () => {
    const text = 'The UNICEF report was clear. UNICEF said so. NATO agreed, and NATO said so.'
    const names = documentNames(text)
    ok(names.includes('UNICEF'), names.join(','))
    ok(names.includes('NATO'), names.join(','))
  })

  it('ignores a heading that was shouted once', () => {
    deepStrictEqual(documentNames('The METHODS section follows. It describes the sample.'), [])
  })

  it('ignores words too short to be worth learning', () => {
    strictEqual(documentNames('She met Al in Rome. Al was late in Rome.').includes('Al'), false)
  })

  it('treats a heading or reference line as a sentence opening', () => {
    // Otherwise the first line of a bibliography teaches every author surname
    // in it, including the misspelled ones.
    const text = 'References\nWalker, A. (2004).\nParis, B. (1996).'
    ok(!documentNames(text).includes('References'))
    ok(!documentNames(text).includes('Walker'))
  })

  it('is stable and deduplicated, in first-appearance order', () => {
    const text = 'Paris and Walker agree. Walker cites Paris, and Paris cites Walker.'
    deepStrictEqual(documentNames(text), ['Paris', 'Walker'])
    deepStrictEqual(documentNames(text), documentNames(text))
  })

  it('returns nothing for empty input', () => {
    deepStrictEqual(documentNames(''), [])
    deepStrictEqual(documentNames('   \n  '), [])
  })
})
