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
