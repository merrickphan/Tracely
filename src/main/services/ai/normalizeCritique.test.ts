import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCritique } from './normalizeCritique.ts'

const base = {
  critique: 'The evidence supports a narrower version of this.',
  verdict: 'weak' as const,
  suggestedRevision: null,
  citationFix: null
}

describe('normalizeCritique — tolerating a relay on a different deploy cadence', () => {
  it('fills fields an older relay cannot send', () => {
    const result = normalizeCritique({ critique: 'x', verdict: 'weak' } as never)
    strictEqual(result.suggestedRevision, null)
    strictEqual(result.citationFix, null)
  })

  it('treats a blank revision as no revision', () => {
    strictEqual(normalizeCritique({ ...base, suggestedRevision: '   ' }).suggestedRevision, null)
  })

  it('trims a revision rather than passing whitespace into the document', () => {
    strictEqual(
      normalizeCritique({ ...base, suggestedRevision: '  People are generally harmful.  ' })
        .suggestedRevision,
      'People are generally harmful.'
    )
  })

  it('downgrades overstated with no revision, since the revision IS the finding', () => {
    const result = normalizeCritique({ ...base, verdict: 'overstated', suggestedRevision: null })
    strictEqual(result.verdict, 'weak')
  })

  it('keeps overstated when the revision is there', () => {
    const result = normalizeCritique({
      ...base,
      verdict: 'overstated',
      suggestedRevision: 'People are generally harmful to the environment.'
    })
    strictEqual(result.verdict, 'overstated')
  })

  it('never shows a citation fix beside a fabrication verdict', () => {
    // The two are mutually exclusive: one says the source does not exist, the
    // other corrects how it was written down. Showing both would have Tracely
    // reformat a reference it has just called invented.
    const result = normalizeCritique({
      ...base,
      verdict: 'fabricated',
      citationFix: 'Ramirez, A., & Doyle, B. (2024).'
    })
    strictEqual(result.citationFix, null)
    strictEqual(result.verdict, 'fabricated')
  })

  it('passes a citation fix through for any other verdict', () => {
    const result = normalizeCritique({
      ...base,
      verdict: 'partially-supported',
      citationFix: 'Shoup, Donald. The High Cost of Free Parking. APA Planners Press, 2005.'
    })
    strictEqual(result.citationFix, 'Shoup, Donald. The High Cost of Free Parking. APA Planners Press, 2005.')
  })
})

describe('a revision must narrow the claim, not replace it', () => {
  const claim =
    'GPT-5 class models now score above the median human rater on the AP English Language essay rubric, according to the vendor\'s own published evaluation.'

  it('drops a revision that swaps the subject, and the verdict falls to weak', () => {
    // Production, 2026-08-16. The evidence was about GPT-4, so the model
    // rewrote the sentence to be about GPT-4 — dropping the AP rubric and the
    // vendor citation with it. A student accepting that asserts something they
    // never claimed, about a different model, with the attribution removed.
    const result = normalizeCritique(
      {
        critique: 'x',
        verdict: 'overstated',
        suggestedRevision:
          'Recent large language models, such as GPT-4, have demonstrated scoring performance comparable to or sometimes exceeding the average human rater on academic English essay rubrics, according to published evaluations.',
        citationFix: null
      } as never,
      claim
    )
    strictEqual(result.suggestedRevision, null)
    strictEqual(result.verdict, 'weak')
  })

  it('keeps a real hedge change, which introduces no new name', () => {
    const result = normalizeCritique(
      {
        critique: 'x',
        verdict: 'overstated',
        suggestedRevision: 'People are generally harmful to the environment.',
        citationFix: null
      } as never,
      'People are 100% dangerous to the environment.'
    )
    strictEqual(result.suggestedRevision, 'People are generally harmful to the environment.')
    strictEqual(result.verdict, 'overstated')
  })

  it('allows a narrowing to DROP a named thing', () => {
    // One-directional on purpose: losing "three US states" for "some states" is
    // exactly what narrowing looks like. Only INTRODUCING a name is forbidden.
    const result = normalizeCritique(
      {
        critique: 'x',
        verdict: 'overstated',
        suggestedRevision: 'The policy reduced emissions in some states.',
        citationFix: null
      } as never,
      'The policy reduced emissions in all 50 US states.'
    )
    strictEqual(result.suggestedRevision, 'The policy reduced emissions in some states.')
  })

  it('does not count the first word, which is capitalised by position', () => {
    const result = normalizeCritique(
      {
        critique: 'x',
        verdict: 'overstated',
        suggestedRevision: 'Many students report the effect.',
        citationFix: null
      } as never,
      'Students always report the effect.'
    )
    strictEqual(result.suggestedRevision, 'Many students report the effect.')
  })

  it('keeps the pre-existing behaviour when no claim text is supplied', () => {
    const result = normalizeCritique(
      {
        critique: 'x',
        verdict: 'overstated',
        suggestedRevision: 'Something about GPT-4 entirely.',
        citationFix: null
      } as never
    )
    strictEqual(result.suggestedRevision, 'Something about GPT-4 entirely.')
  })
})
