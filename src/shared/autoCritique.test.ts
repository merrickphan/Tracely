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

/**
 * Owner, 2026-08-19: "I typed 'World War II ended in 1943,' and it just gave me
 * a bunch of sources because it was uncited. But obviously, that's not a true
 * statement."
 *
 * The cause was here. Auto-critique was cited-only, on the reasoning that an
 * uncited claim's verdict is readable from its evidence score — and that
 * sentence disproves it: retrieval returns real WWII scholarship, the claim
 * scores well, and nothing asks whether 1943 is the right year. Pass 1 of the
 * critique is the only thing in Tracely that can say a sentence is false.
 */
describe('autoCritiqueTargets — uncited claims that can be fact-checked', () => {
  const uncitedFact = (id: string, text: string) => claim(id, text, 40)

  it('takes the sentence that started this', () => {
    deepStrictEqual(autoCritiqueTargets([uncitedFact('wwii', 'World War II ended in 1943.')]), ['wwii'])
  })

  it('takes any uncited claim with something specific to check', () => {
    for (const text of [
      'The treaty was signed in 1919.',
      'Roughly 40% of respondents disagreed.',
      'The programme reached 2.5 million households.',
      'She died on January 20, 1993.',
      'The population passed 8000 that decade.'
    ]) {
      deepStrictEqual(autoCritiqueTargets([uncitedFact('c', text)]), ['c'], text)
    }
  })

  /**
   * Owner, 2026-08-20: *"I put 'Lamine Yamal is 22 years old' and then it didnt
   * flag it."*
   *
   * The gate was five branches — a four-digit year, a percentage, a magnitude
   * word, a run of four-plus digits, a calendar date — and measured against
   * ordinary sentences it admitted essentially only years. Every line below was
   * skipped before, and each is exactly what Pass 1 is good at.
   */
  it('takes a number that is not a year', () => {
    for (const text of [
      'Lamine Yamal is 22 years old.',
      'The Eiffel Tower is 90 metres tall.',
      // The comma beat \d{4,}, so this one failed every branch at once.
      'Mount Everest is 5,000 feet high.',
      'Barack Obama was the 43rd president.',
      'The building has 3 floors.'
    ]) {
      deepStrictEqual(autoCritiqueTargets([uncitedFact('c', text)]), ['c'], text)
    }
  })

  // Pass 1 can only be confident about something specific. An interpretive
  // sentence gives it nothing, so the call would buy a verdict about the
  // evidence — which the free strength score already reports.
  it('leaves an uncited claim with nothing specific in it alone', () => {
    for (const text of [
      'Her humanitarian work mattered more than her films.',
      'The policy was broadly unpopular.',
      'Celebrity advocacy changed after that.'
    ]) {
      deepStrictEqual(autoCritiqueTargets([uncitedFact('c', text)]), [], text)
    }
  })

  it('still waits for the evidence search', () => {
    deepStrictEqual(autoCritiqueTargets([claim('w', 'World War II ended in 1943.', null)]), [])
  })

  it('still never pays twice', () => {
    deepStrictEqual(
      autoCritiqueTargets([claim('w', 'World War II ended in 1943.', 40, 'weak')]),
      []
    )
  })

  /**
   * A cited claim qualifies on its citation alone and may carry no assertion at
   * all, so six vague cited sentences at the top of a draft would take every
   * slot from the one sentence Pass 1 has something to say about. Document
   * order still decides within each group.
   */
  it('spends the last slots on the claims with a hard number in them', () => {
    // Cited, with no digit anywhere in the text. Prose attribution is the shape
    // that manages both — "(Walker, 2010)" carries a year, and an id like
    // "Point 0" would have carried a number of its own.
    const words = ['one', 'two', 'three', 'four', 'five', 'six']
    const vagueCited = words.map((w) =>
      claim(`vague-${w}`, `According to Pearson from UNICEF, point ${w} holds.`, 40)
    )
    const targets = autoCritiqueTargets([
      ...vagueCited,
      uncitedFact('yamal', 'Lamine Yamal is 22 years old.')
    ])
    strictEqual(targets.length, MAX_AUTO_CRITIQUE_CLAIMS)
    strictEqual(targets[0], 'yamal')
    // And it is a stable partition, not a re-rank: the vague ones keep their order.
    deepStrictEqual(targets.slice(1), [
      'vague-one',
      'vague-two',
      'vague-three',
      'vague-four',
      'vague-five'
    ])
  })

  it('shares one cap with the cited claims', () => {
    const many = [
      ...Array.from({ length: 4 }, (_, i) => cited(`cited${i}`)),
      ...Array.from({ length: 4 }, (_, i) => uncitedFact(`fact${i}`, `It happened in 19${10 + i}.`))
    ]
    strictEqual(autoCritiqueTargets(many).length, MAX_AUTO_CRITIQUE_CLAIMS)
  })
})
