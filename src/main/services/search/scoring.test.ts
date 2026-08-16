import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeStrengthScore, MIN_COUNTABLE_RELEVANCE, type ScorableItem } from './scoring.ts'

// scoring.ts had no tests until 2026-08-16, which is how the dilution below
// survived: it is not a subtle bug, but nothing ever asked the module a
// question with a known answer. Its only import is `import type`, which type
// stripping erases, so it loads under `node --test` like any other leaf.

const YEAR = new Date().getFullYear()

/** A source that clears the dense floor and is otherwise unremarkable. */
const relevantItem = (over: Partial<ScorableItem> = {}): ScorableItem => ({
  venueType: 'journal',
  year: YEAR - 2,
  relevanceRank: 0,
  textRelevance: 0.6,
  stance: null,
  ...over
})

/** A recent journal paper about something else — the shape that used to inflate
 *  a score, because venue tier and publication year know nothing about topic. */
const irrelevantItem = (over: Partial<ScorableItem> = {}): ScorableItem => ({
  venueType: 'journal',
  year: YEAR,
  relevanceRank: 5,
  textRelevance: 0.2,
  stance: null,
  ...over
})

describe('computeStrengthScore — irrelevant sources must not carry the score', () => {
  it('does not change the score when irrelevant results are added', () => {
    // The measured failure, from eval/retrieval/labels-2026-08-10.json: mean
    // score by relevant sources retrieved ran 60.3 (none) / 71.0 (one or two) /
    // 58.7 (three or more). A claim with three supporting papers scored BELOW a
    // claim with none, because quality and recency averaged over the six
    // unrelated papers behind them.
    const alone = computeStrengthScore([relevantItem()], 'dense').score
    const diluted = computeStrengthScore(
      [relevantItem(), irrelevantItem(), irrelevantItem(), irrelevantItem()],
      'dense'
    ).score

    ok(
      diluted >= alone,
      `adding irrelevant sources lowered the score (${alone} -> ${diluted}) — the dilution bug is back`
    )
  })

  it('scores a claim with nothing relevant near zero', () => {
    // Not "the average of the noise". Six recent journal articles about other
    // subjects used to floor a claim around 60, which is the mixed band — so a
    // claim nothing supports was reported as partially supported.
    const { score, breakdown } = computeStrengthScore(
      [irrelevantItem(), irrelevantItem(), irrelevantItem()],
      'dense'
    )
    strictEqual(score, 0)
    strictEqual(breakdown.sourceCount, 0)
    strictEqual(breakdown.quality, 0)
    strictEqual(breakdown.recency, 0)
  })

  it('rises with the number of relevant sources', () => {
    const one = computeStrengthScore([relevantItem()], 'dense').score
    const three = computeStrengthScore([relevantItem(), relevantItem(), relevantItem()], 'dense').score
    ok(three > one, `three relevant sources (${three}) should beat one (${one})`)
  })

  it('judges quality on the relevant sources, not on the whole list', () => {
    // One preprint that is actually about the claim, behind three journal
    // papers that are not. The old formula reported this as high-quality
    // evidence on the strength of the journals.
    const weakVenue = computeStrengthScore(
      [relevantItem({ venueType: 'preprint' }), irrelevantItem(), irrelevantItem(), irrelevantItem()],
      'dense'
    )
    const strongVenue = computeStrengthScore(
      [relevantItem({ venueType: 'journal' }), irrelevantItem(), irrelevantItem(), irrelevantItem()],
      'dense'
    )
    ok(
      weakVenue.breakdown.quality < strongVenue.breakdown.quality,
      'venue tier should reflect the relevant source, not the irrelevant majority'
    )
  })

  it('applies the floor belonging to the metric it was told about', () => {
    // The two scales are not interchangeable — a lexical 0.3 is a decent match
    // and a dense 0.3 is noise. Passing the wrong metric would let weak matches
    // count as sources, which is the whole reason the parameter exists.
    const item = relevantItem({ textRelevance: 0.3 })
    ok(0.3 > MIN_COUNTABLE_RELEVANCE.lexical && 0.3 < MIN_COUNTABLE_RELEVANCE.dense)
    ok(computeStrengthScore([item], 'lexical').score > 0)
    strictEqual(computeStrengthScore([item], 'dense').score, 0)
  })
})

describe('computeStrengthScore — stance still degrades rather than deflating', () => {
  it('uses the pre-stance weights when no source produced a verdict', () => {
    // The NLI model answers `unclear` for effectively everything it is asked
    // (21 of 21 on the labelled baseline). Treating that as a real zero would
    // cap every claim in the app near 60, since support carries 0.4 — so a
    // fully-supported claim must still be able to score high with no verdicts.
    const { score, breakdown } = computeStrengthScore(
      [relevantItem(), relevantItem(), relevantItem()],
      'dense'
    )
    strictEqual(breakdown.support, 0)
    ok(score > 60, `no stance verdict should not deflate a well-evidenced claim (got ${score})`)
  })

  it('caps a claim the evidence runs against', () => {
    const { score } = computeStrengthScore(
      [
        relevantItem({ stance: 'contradicts' }),
        relevantItem({ stance: 'contradicts' }),
        relevantItem({ stance: 'supports' })
      ],
      'dense'
    )
    ok(score <= 30, `net-contradicted claim should be capped at 30 (got ${score})`)
  })
})
