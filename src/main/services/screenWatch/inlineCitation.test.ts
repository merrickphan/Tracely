import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasInlineCitation, inlineCitationKind } from './inlineCitation.ts'

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
    'Handwriting is the oldest form of note-taking.'
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
