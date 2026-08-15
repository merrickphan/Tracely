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
