import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeStrengthScore,
  MIN_COUNTABLE_RELEVANCE,
  rescoreFromBreakdown,
  selectShownEvidence,
  type ScorableItem
} from './scoring.ts'

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

/**
 * The weights themselves, fitted 2026-08-18 against 51 labelled claims.
 *
 * The tests above pin the SHAPE of the formula — dilution, the floor, the
 * contradiction cap — and all of them passed unchanged when the weights moved,
 * which is the right outcome for a property test and also the reason none of
 * them noticed that the weights were flattening every claim onto one band.
 * These pin the consequences the fit was run to fix.
 */
describe('computeStrengthScore — the fitted weights spread claims out', () => {
  it('does not let a prestigious irrelevant list beat a modest relevant one', () => {
    // eval/baseline.md, the failure that started this: the claim with ZERO
    // relevant sources scored 78, the highest in that run, on venue tier and
    // publication year alone.
    const prestigiousNoise = computeStrengthScore(
      Array.from({ length: 8 }, () => irrelevantItem({ venueType: 'journal', year: YEAR })),
      'dense'
    ).score
    const modestButRelevant = computeStrengthScore(
      [
        relevantItem({ venueType: 'preprint', year: YEAR - 12 }),
        relevantItem({ venueType: 'preprint', year: YEAR - 12 })
      ],
      'dense'
    ).score
    ok(
      modestButRelevant > prestigiousNoise,
      `two old preprints that are ON TOPIC (${modestButRelevant}) must beat eight recent journal ` +
        `papers that are not (${prestigiousNoise})`
    )
  })

  it('leaves room below 40, so the weak band is reachable', () => {
    // Nothing in a 58-claim eval run ever scored between 1 and 39: quality and
    // recency floored every claim with any retrieval at ~45, which made both
    // `weak-evidence` and `cited-unverified` in problemKind.ts dead code.
    const oneWeakSource = computeStrengthScore(
      [relevantItem({ venueType: 'preprint', year: YEAR - 15, relevanceRank: 5, textRelevance: 0.45 })],
      'dense'
    ).score
    ok(oneWeakSource > 0, 'a claim with one relevant source is not a zero')
    ok(oneWeakSource < 40, `one weak relevant source should land in the weak band (got ${oneWeakSource})`)
  })

  it('still reaches the strong band on genuinely good evidence', () => {
    // The other half of the same requirement, and the reason quality was kept
    // at 0.20 rather than taken to the fit's zero: driving it out collapsed
    // everything above 70 to nothing.
    const strong = computeStrengthScore(
      Array.from({ length: 6 }, () => relevantItem({ textRelevance: 0.85, venueType: 'journal' })),
      'dense'
    ).score
    ok(strong >= 70, `six strongly relevant journal sources should clear the strong band (got ${strong})`)
  })

  it('keeps venue quality worth something', () => {
    // Kept deliberately against the fit, which wanted it at zero. If this ever
    // stops holding, the weights have drifted back to a pure relevance count.
    const good = computeStrengthScore([relevantItem({ venueType: 'journal' })], 'dense').score
    const poor = computeStrengthScore([relevantItem({ venueType: 'preprint' })], 'dense').score
    ok(good > poor, `a relevant journal paper should outscore a relevant preprint (${good} vs ${poor})`)
  })
})

describe('rescoreFromBreakdown — stored claims re-band under new weights', () => {
  it('reproduces computeStrengthScore exactly for the no-stance path', () => {
    // The property the migration rests on: the score IS the weighted sum of
    // the stored factors, so re-deriving one cannot drift from computing one.
    for (const items of [
      [relevantItem()],
      [relevantItem(), relevantItem(), irrelevantItem()],
      [relevantItem({ venueType: 'preprint', year: YEAR - 15 })],
      Array.from({ length: 6 }, () => relevantItem({ textRelevance: 0.9 }))
    ]) {
      const { score, breakdown } = computeStrengthScore(items, 'dense')
      strictEqual(rescoreFromBreakdown(breakdown), score)
    }
  })

  it('keeps null distinct from zero', () => {
    // null = nobody has looked. 0 = we looked and found nothing. problemKind.ts
    // says different things about them, so collapsing the two would report a
    // verdict on every claim the moment it was detected.
    strictEqual(rescoreFromBreakdown(null), null)
    strictEqual(
      rescoreFromBreakdown({ sourceCount: 0, quality: 0, recency: 0, relevance: 0, support: 0 }),
      0
    )
  })

  it('re-bands a claim stored under the old weights', () => {
    // A breakdown typical of the old failure: prestigious, recent, and barely
    // relevant. Under the pre-2026-08-18 weights this scored in the 40-69
    // "partially supported" band; it must now read as weak.
    // One source of six clears the floor, it is barely on topic, and the list
    // is recent and well-published. Old weights: 52. New: 33.
    const prestigiousButOffTopic = { sourceCount: 0.17, quality: 1, recency: 0.9, relevance: 0.15, support: 0 }
    const old = 0.3 * 0.15 + 0.25 * 0.17 + 0.3 * 1 + 0.15 * 0.9
    ok(Math.round(100 * old) >= 40, 'this breakdown used to land in the partial band')
    ok(
      (rescoreFromBreakdown(prestigiousButOffTopic) ?? 0) < 40,
      'a prestigious off-topic list must now band as weak'
    )
  })
})

/**
 * What a student is OFFERED, which is a different question from what the score
 * is computed over. Owner, 2026-08-19: *"a lot of them don't even match
 * whatsoever."* Measured cause: the displayed list had no floor at all.
 */
describe('selectShownEvidence', () => {
  const at = (textRelevance: number) => ({ textRelevance })

  it('drops everything below the floor for the metric in use', () => {
    const shown = selectShownEvidence([at(0.6), at(0.5), at(0.3), at(0.05)], 'dense', 10)
    deepStrictEqual(shown.map((s) => s.textRelevance), [0.6, 0.5])
  })

  // The two floors are not on the same scale — claim-word coverage runs high,
  // MiniLM cosine runs low and compresses. Using one for the other would either
  // show everything or nothing.
  it('uses the LEXICAL floor when the embedder was unavailable', () => {
    const candidates = [at(0.6), at(0.5), at(0.3), at(0.05)]
    strictEqual(selectShownEvidence(candidates, 'dense', 10).length, 2)
    strictEqual(selectShownEvidence(candidates, 'lexical', 10).length, 3)
  })

  it('caps what survives the floor, keeping the best', () => {
    const shown = selectShownEvidence([at(0.9), at(0.8), at(0.7), at(0.6), at(0.5)], 'dense', 3)
    deepStrictEqual(shown.map((s) => s.textRelevance), [0.9, 0.8, 0.7])
  })

  // The honest outcome for a claim the four indexes cannot answer. Padding the
  // list to look useful is what put "The DSM and Its Discontents" under a claim
  // about German casualties at Stalingrad.
  it('returns NOTHING rather than the best of a bad set', () => {
    deepStrictEqual(selectShownEvidence([at(0.3), at(0.2), at(0.05)], 'dense', 5), [])
  })

  it('keeps a source exactly on the floor', () => {
    strictEqual(selectShownEvidence([at(MIN_COUNTABLE_RELEVANCE.dense)], 'dense', 5).length, 1)
  })

  it('preserves the order it was given, which is the caller ranking', () => {
    const shown = selectShownEvidence([at(0.9), at(0.44), at(0.7)], 'dense', 5)
    deepStrictEqual(shown.map((s) => s.textRelevance), [0.9, 0.44, 0.7])
  })
})
