import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { carriesAttribution, isCitedInScope } from './citationScope.ts'

/** Locates `claim` in `doc` and asks whether it is covered. */
function covered(doc: string, claim: string): boolean {
  const at = doc.indexOf(claim)
  if (at === -1) throw new Error(`claim not present in document: ${claim}`)
  return isCitedInScope(doc, at, at + claim.length)
}

describe('carriesAttribution', () => {
  it('accepts an additive connective with a reporting verb', () => {
    strictEqual(carriesAttribution('Furthermore, she argues the effect concentrated among new voters.'), true)
  })

  it('accepts an anaphoric subject reporting', () => {
    strictEqual(carriesAttribution('The study found the same pattern in three other districts.'), true)
  })

  it('accepts a bare "According to"', () => {
    strictEqual(carriesAttribution('According to the same report, deaths fell by a fifth.'), true)
  })

  it('accepts a named source with a reporting verb and no year', () => {
    strictEqual(carriesAttribution('Smith further argues the mechanism is administrative.'), true)
  })

  // The line that keeps a whole paragraph from being swallowed by one citation.
  it('rejects a pronoun with no reporting verb', () => {
    strictEqual(carriesAttribution('She was born in Brussels in 1929.'), false)
  })

  it('rejects a new assertion that simply follows a cited one', () => {
    strictEqual(carriesAttribution('Meanwhile, global temperatures rose 1.2 degrees.'), false)
  })
})

describe('isCitedInScope', () => {
  it('covers a sentence carrying the attribution forward', () => {
    const doc =
      'Smith (2020) found that turnout fell nine points. Furthermore, she argues the effect concentrated among first-time voters.'
    strictEqual(covered(doc, 'the effect concentrated among first-time voters'), true)
  })

  it('does NOT cover a new claim that merely follows a citation', () => {
    const doc =
      'Smith (2020) found that turnout fell nine points. Meanwhile, global temperatures rose 1.2 degrees that decade.'
    strictEqual(covered(doc, 'global temperatures rose 1.2 degrees that decade'), false)
  })

  it('covers sentences leading up to a trailing citation', () => {
    // The passage states the idea and cites once at the close.
    const doc =
      'Turnout fell nine points in the district. The drop concentrated among first-time voters (Smith, 2020).'
    strictEqual(covered(doc, 'Turnout fell nine points in the district'), true)
  })

  it('does not reach across a paragraph boundary', () => {
    const doc =
      'Smith (2020) found that turnout fell nine points.\nFurthermore, she argues the effect was administrative.'
    strictEqual(covered(doc, 'the effect was administrative'), false)
  })

  it('still covers a sentence that carries its own citation', () => {
    const doc = 'Turnout fell nine points (Smith, 2020).'
    strictEqual(covered(doc, 'Turnout fell nine points'), true)
  })

  it('leaves an uncited paragraph uncovered', () => {
    const doc = 'Turnout fell nine points in the district. The drop concentrated among first-time voters.'
    strictEqual(covered(doc, 'The drop concentrated among first-time voters'), false)
  })
})
