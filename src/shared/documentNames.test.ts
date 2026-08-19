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

  it('ignores a name used only once', () => {
    // Used once is the case the writer is least likely to have proof-read.
    deepStrictEqual(documentNames('The report by Smithe was published in 1990.'), [])
  })

  it('ignores ordinary capitalised English', () => {
    const text = 'However the data were thin. The results held. However the sample was small.'
    deepStrictEqual(documentNames(text), [])
  })

  it('ignores acronyms and shouting', () => {
    const text = 'The UNICEF report was clear. UNICEF said so. NATO agreed, and NATO said so.'
    deepStrictEqual(documentNames(text), [])
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
