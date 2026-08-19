import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert'
import { MAX_AUTO_CRITIQUE_CLAIMS, autoCritiqueTargets } from './autoCritique.ts'

/**
 * This function decides when Tracely spends money with nobody's finger on the
 * button, so every test here is about a bound holding. Over-selecting costs the
 * user real credits on the most expensive call in the app; under-selecting
 * costs a check. The tests are written from that asymmetry.
 */

function claim(
  id: string,
  text: string,
  strengthScore: number | null,
  critiqueVerdict: 'weak' | null = null
) {
  return {
    id,
    analysisId: 'a1',
    text,
    claimType: 'factual' as const,
    confidence: 0.8,
    searchQuery: id,
    strengthScore,
    scoreBreakdown: null,
    critique: null,
    critiqueVerdict,
    suggestedRevision: null,
    citationFix: null,
    createdAt: '2026-08-19T00:00:00.000Z'
  }
}

const cited = (id: string, score: number | null = 40, verdict: 'weak' | null = null) =>
  claim(id, `Point ${id} holds across the record (Walker, 2010).`, score, verdict)
const uncited = (id: string, score: number | null = 40) =>
  claim(id, `Point ${id} holds across the record`, score)

describe('autoCritiqueTargets', () => {
  it('takes a cited claim whose evidence has resolved', () => {
    deepStrictEqual(autoCritiqueTargets([cited('a')]), ['a'])
  })

  it('leaves uncited claims alone — their verdict is already in the score', () => {
    deepStrictEqual(autoCritiqueTargets([uncited('a')]), [])
  })

  it('waits for the evidence search', () => {
    // The critique reasons over an evidence list; an empty one produces a
    // verdict about the search rather than about the sentence.
    deepStrictEqual(autoCritiqueTargets([cited('a', null)]), [])
  })

  it('never pays twice for a verdict already on the claim', () => {
    deepStrictEqual(autoCritiqueTargets([cited('a', 40, 'weak')]), [])
  })

  it('caps the batch, in document order', () => {
    const many = Array.from({ length: MAX_AUTO_CRITIQUE_CLAIMS + 4 }, (_, i) => cited(`c${i}`))
    const targets = autoCritiqueTargets(many)
    strictEqual(targets.length, MAX_AUTO_CRITIQUE_CLAIMS)
    deepStrictEqual(targets, many.slice(0, MAX_AUTO_CRITIQUE_CLAIMS).map((c) => c.id))
  })

  it('returns nothing for an empty draft', () => {
    deepStrictEqual(autoCritiqueTargets([]), [])
    deepStrictEqual(autoCritiqueTargets([], 'some text'), [])
  })

  /**
   * A detected claim is a sub-span of its sentence, so a reference that follows
   * the assertion is invisible to the claim-only test. Same bug that made the
   * coverage ratio and the weakness list disagree about one sentence.
   */
  it('sees a citation that follows the claim in the document', () => {
    const bare = claim('bare', 'She delivered newspapers for the resistance', 40)
    const document =
      'She delivered newspapers for the resistance, at real risk to herself (Lähteenmäki, 2006).'
    deepStrictEqual(autoCritiqueTargets([bare]), [])
    deepStrictEqual(autoCritiqueTargets([bare], document), ['bare'])
  })

  it('does not invent a citation from the document for an uncited sentence', () => {
    const bare = claim('bare', 'Rationing continued into the following year', 40)
    const document =
      'She delivered newspapers for the resistance (Lähteenmäki, 2006). Rationing continued into the following year.'
    deepStrictEqual(autoCritiqueTargets([bare], document), [])
  })
})
