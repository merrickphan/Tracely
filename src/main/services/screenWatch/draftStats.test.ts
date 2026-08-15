import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { draftStats } from './draftStats.ts'

/**
 * These four numbers are shown to the user as a stats row, so what matters is
 * that they cannot be absurd or divide by zero — not that they match any
 * particular tokenizer. The assertions below pin the cases that would actually
 * mislead someone reading the panel.
 */
describe('draftStats', () => {
  it('counts words, sentences and distinct words', () => {
    deepStrictEqual(draftStats('The cat sat. The cat left!'), {
      words: 6,
      sentences: 2,
      uniqueWords: 4
    })
  })

  it('folds case when counting distinct words, so sentence position is not vocabulary', () => {
    // "The"/"the" is one word; a diversity figure that counted it twice would
    // reward starting more sentences with the same word.
    strictEqual(draftStats('The end. the end.').uniqueWords, 2)
  })

  it('keeps hyphens and apostrophes inside a word', () => {
    strictEqual(draftStats("well-integrated isn't two words").words, 4)
  })

  it('floors sentences at one so words-per-sentence never divides by zero', () => {
    const stats = draftStats('a draft with no terminator yet')
    strictEqual(stats.sentences, 1)
    strictEqual(Number.isFinite(stats.words / stats.sentences), true)
  })

  it('survives empty text without producing NaN downstream', () => {
    const stats = draftStats('')
    deepStrictEqual(stats, { words: 0, sentences: 1, uniqueWords: 0 })
    strictEqual(stats.words / stats.sentences, 0)
  })

  it('counts an abbreviation as a sentence end — known limitation, pinned deliberately', () => {
    // Not the behaviour anyone would choose, but it is the behaviour, and it is
    // cheap. Pinned so that if someone does add a real splitter later, this test
    // fails and tells them the stats row moves rather than letting it drift.
    strictEqual(draftStats('Dr. Smith wrote it.').sentences, 2)
  })

  it('treats an ellipsis or "?!" as one terminator, not several', () => {
    strictEqual(draftStats('Really?! Yes...').sentences, 2)
  })
})
