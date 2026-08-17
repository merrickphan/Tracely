// Run with `npm test`. See the note in src/renderer/src/lib/markdown.test.ts
// for why these files are excluded from both tsconfigs.
import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findCitationInsertPoint } from './citationInsertPoint.ts'

const CITE = '(Smith, 2020)'

/**
 * Applies the insertion the way `insertCitationForClaim` does, so a failure
 * reads as the sentence the user would actually end up with.
 */
function insert(text: string, claimEnd = text.length): string {
  const { offset, prefix } = findCitationInsertPoint(text, claimEnd)
  return text.slice(0, offset) + prefix + CITE + text.slice(offset)
}

describe('findCitationInsertPoint — moves inside the sentence', () => {
  it('handles the reported case', () => {
    strictEqual(
      insert('Babies born to smokers have low weight.'),
      'Babies born to smokers have low weight (Smith, 2020).'
    )
  })

  it('handles an exclamation mark', () => {
    strictEqual(insert('Rates rose sharply!'), 'Rates rose sharply (Smith, 2020)!')
  })

  it('handles a question mark', () => {
    strictEqual(insert('Did rates rise?'), 'Did rates rise (Smith, 2020)?')
  })

  it('handles a multi-character terminator run', () => {
    strictEqual(insert('Really?!'), 'Really (Smith, 2020)?!')
  })

  it('keeps a decimal point intact', () => {
    // The period after "3.5" is the sentence's; the one inside it is not.
    strictEqual(insert('Growth was 3.5.'), 'Growth was 3.5 (Smith, 2020).')
  })

  it('handles a percent sign before the period', () => {
    strictEqual(insert('Costs rose 20%.'), 'Costs rose 20% (Smith, 2020).')
  })

  it('steps over a period that sits outside a closing quote', () => {
    strictEqual(insert('It works".'), 'It works" (Smith, 2020).')
  })

  it('does not scan past the end of the claim', () => {
    // Only the first sentence is in scope; the second claim's period is never
    // reached, and the citation lands inside sentence one.
    strictEqual(
      insert('Rates fell. Next claim.', 11),
      'Rates fell (Smith, 2020). Next claim.'
    )
  })

  it('treats a lone capital letter plus period as an initial, not a sentence', () => {
    // "A." is genuinely ambiguous, and the initial reading is the safer one:
    // guessing wrong here would split a name. This documents the choice.
    strictEqual(insert('A. B.', 2), 'A. (Smith, 2020) B.')
  })

  it('works mid-document and leaves the paragraph break intact', () => {
    strictEqual(
      insert('Rates fell.\n\nNext para', 11),
      'Rates fell (Smith, 2020).\n\nNext para'
    )
  })

  it('handles CRLF, which Word’s UIA returns', () => {
    strictEqual(insert('Rates fell.\r\n', 11), 'Rates fell (Smith, 2020).\r\n')
  })
})

describe('findCitationInsertPoint — refuses to move', () => {
  it('leaves a heading with no terminator alone', () => {
    // splitSentences' `\n+` alternative: headings and bullet fragments end a
    // span without any punctuation.
    strictEqual(insert('Methods and Materials'), 'Methods and Materials (Smith, 2020)')
  })

  it('leaves a sentence ending in a closing quote alone', () => {
    // Never insert inside the quotation.
    strictEqual(insert('He said "it works."'), 'He said "it works." (Smith, 2020)')
  })

  it('leaves a question mark inside a quotation alone', () => {
    strictEqual(insert('Is it real?"'), 'Is it real?" (Smith, 2020)')
  })

  it('leaves a closing parenthesis alone', () => {
    // Never insert inside the parenthetical.
    strictEqual(
      insert('As shown in Figure 3 (panel b)'),
      'As shown in Figure 3 (panel b) (Smith, 2020)'
    )
  })

  it('leaves an ellipsis alone', () => {
    strictEqual(insert('The results were unclear...'), 'The results were unclear... (Smith, 2020)')
  })

  it('leaves a single-character ellipsis alone', () => {
    strictEqual(insert('The results were unclear…'), 'The results were unclear… (Smith, 2020)')
  })

  it('leaves "et al." alone', () => {
    strictEqual(insert('Reported by Smith et al.'), 'Reported by Smith et al. (Smith, 2020)')
  })

  it('leaves an abbreviation alone', () => {
    strictEqual(insert('Shown in Fig.'), 'Shown in Fig. (Smith, 2020)')
  })

  it('leaves a bare initial alone', () => {
    strictEqual(insert('Reported by Smith, J.'), 'Reported by Smith, J. (Smith, 2020)')
  })

  it('leaves a claim that is only punctuation alone', () => {
    strictEqual(insert('.'), '. (Smith, 2020)')
  })
})

describe('findCitationInsertPoint — spacing', () => {
  it('adds no leading space at offset 0', () => {
    strictEqual(insert(''), '(Smith, 2020)')
  })

  it('does not double a space that is already there', () => {
    strictEqual(insert('Low weight .'), 'Low weight (Smith, 2020).')
  })

  it('handles trailing whitespace inside the span', () => {
    strictEqual(insert('Weight is low. '), 'Weight is low (Smith, 2020). ')
  })
})

describe('findCitationInsertPoint — degenerate offsets', () => {
  it('clamps an offset past the end', () => {
    // A span measured against text that has since shrunk.
    strictEqual(insert('Rates fell.', 99), 'Rates fell (Smith, 2020).')
  })

  it('clamps a negative offset', () => {
    strictEqual(insert('Rates fell.', -3), '(Smith, 2020)Rates fell.')
  })
})

describe('findCitationInsertPoint — reported fields', () => {
  it('reports movedBeforePunctuation when it moved', () => {
    const r = findCitationInsertPoint('Rates fell.', 11)
    strictEqual(r.offset, 10)
    strictEqual(r.prefix, ' ')
    strictEqual(r.movedBeforePunctuation, true)
  })

  it('reports movedBeforePunctuation false when it did not', () => {
    const r = findCitationInsertPoint('Methods', 7)
    strictEqual(r.offset, 7)
    strictEqual(r.movedBeforePunctuation, false)
  })

  it('does not detect an existing citation — out of scope, and documented as such', () => {
    strictEqual(insert('See Smith (2020).'), 'See Smith (2020) (Smith, 2020).')
  })
})

describe('findCitationInsertPoint — non-ASCII text', () => {
  // The offsets are JS string indices, so anything that mis-handles a surrogate
  // pair or a non-ASCII letter lands the citation inside a word. These are the
  // characters a real essay actually contains.
  it('leaves a smart closing quote alone', () => {
    strictEqual(insert('He said “it works.”'), 'He said “it works.” (Smith, 2020)')
  })

  it('steps over a period outside a smart closing quote', () => {
    strictEqual(insert('It works”.'), 'It works” (Smith, 2020).')
  })

  it('moves inside a sentence with accented letters', () => {
    strictEqual(insert('La tasa subió rápidamente.'), 'La tasa subió rápidamente (Smith, 2020).')
  })

  it('still recognises "et al." after a non-ASCII surname', () => {
    // tokenBefore is \p{L}-based, not [a-z]: "Müller et al." must read as the
    // abbreviation, not as the end of a sentence.
    strictEqual(insert('Reported by Müller et al.'), 'Reported by Müller et al. (Smith, 2020)')
  })

  it('still recognises a non-ASCII initial', () => {
    strictEqual(insert('Reported by É.'), 'Reported by É. (Smith, 2020)')
  })

  it('handles an inverted-question sentence', () => {
    strictEqual(insert('¿Subieron las tasas?'), '¿Subieron las tasas (Smith, 2020)?')
  })

  it('handles an astral-plane character before the terminator', () => {
    // An emoji is two code units. `text[runStart - 1]` reads half of one, which
    // is safe here only because that half is neither a letter nor an uppercase,
    // so the initial check declines and the period is treated as the
    // sentence's. Pinned so a move to code-point iteration is a visible change.
    strictEqual(insert('Rates fell 📉.'), 'Rates fell 📉 (Smith, 2020).')
  })

  it('leaves an ideographic full stop alone', () => {
    // Not in isTerminator, so the run is empty and refusal (1) declines. The
    // conservative answer for a script this heuristic was not written for.
    strictEqual(insert('比率は下がった。'), '比率は下がった。 (Smith, 2020)')
  })

  it('treats a non-breaking space as whitespace', () => {
    // JS \s matches U+00A0, so a trailing NBSP is skipped like any other
    // whitespace and the citation still lands inside the sentence rather than
    // after the period.
    strictEqual(insert('Weight is low.\u00A0'), 'Weight is low (Smith, 2020).\u00A0')
  })
})

describe('findCitationInsertPoint — a claim that ends mid-sentence', () => {
  it('inserts where the claim ends, not where the sentence does', () => {
    // The relay returns the assertion and stops; the rest of the sentence is
    // not part of the claim. There is no terminator at the claim's end, so
    // refusal (1) applies and the citation goes exactly where the claim ended —
    // scanning forward to the sentence's period would attach the source to a
    // clause it says nothing about.
    strictEqual(
      insert('Rates fell sharply in 2020 and then rose.', 26),
      'Rates fell sharply in 2020 (Smith, 2020) and then rose.'
    )
  })

  it('does not step back over a comma', () => {
    // Only .!? are terminators. A comma is inside the sentence, so the citation
    // follows it rather than displacing it.
    strictEqual(
      insert('Rates fell in 2020, though not everywhere.', 19),
      'Rates fell in 2020, (Smith, 2020) though not everywhere.'
    )
  })

  it('steps back over the period of a sentence containing em-dashes', () => {
    strictEqual(
      insert('Rates fell — sharply — in 2020.'),
      'Rates fell — sharply — in 2020 (Smith, 2020).'
    )
  })
})
