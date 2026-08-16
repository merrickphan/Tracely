import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasRelevantSource,
  isRetrievalMiss,
  problemKindFor,
  problemKindsFor,
  problemSeverity
} from './problemKind.ts'

/**
 * A resolved search that returned `count` results, `count > 0` of which were
 * on topic.
 *
 * The two are separate inputs because retrieval separates them: it returns its
 * top eight for every claim whether or not any of them speak to it. Every case
 * below that used to write `count: 0` meant "nothing relevant came back", and
 * that is what it still means; `retrieved` covers the case the old shape could
 * not express at all — results came back, and none of them were about this.
 */
const found = (score: number, count: number): { score: number; count: number; hasRelevantSource: boolean } => ({
  score,
  count,
  hasRelevantSource: count > 0
})

/** Results came back and NONE of them cleared the relevance floor. */
const retrieved = (count: number): { score: number; count: number; hasRelevantSource: boolean } => ({
  score: 0,
  count,
  hasRelevantSource: false
})

const base = {
  claimType: 'factual' as const,
  hasInlineCitation: false,
  evidence: found(80, 5),
  critiqueVerdict: null
}

describe('problemKindFor', () => {
  it('says nothing is known until the search resolves', () => {
    strictEqual(problemKindFor({ ...base, evidence: null }), 'searching')
  })

  it('separates a factual contradiction from weak reasoning', () => {
    // CRITIQUE_SYSTEM_PROMPT reserves 'contradicted' for "a specific fact you
    // are confident is wrong". It used to fold into 'weak-reasoning', which
    // printed "Weak reasoning" over the one verdict that is not about
    // reasoning — and ranked it below a citation problem.
    strictEqual(
      problemKindFor({ ...base, critiqueVerdict: 'contradicted' }),
      'contradicted-claim'
    )
    strictEqual(problemKindFor({ ...base, critiqueVerdict: 'weak' }), 'weak-reasoning')
    strictEqual(problemKindFor({ ...base, critiqueVerdict: 'unsupported' }), 'weak-reasoning')
  })

  it('ranks a contradicted fact above everything else, including a bad citation', () => {
    ok(problemSeverity('contradicted-claim') < problemSeverity('cited-unverified'))
    ok(problemSeverity('contradicted-claim') < problemSeverity('weak-reasoning'))
    deepStrictEqual(
      problemKindsFor({ ...base, hasInlineCitation: true, evidence: found(0, 0), critiqueVerdict: 'contradicted' })[0],
      'contradicted-claim'
    )
  })

  it('puts reasoning above evidence, however well sourced', () => {
    // The point of the ordering: a claim can be perfectly well sourced and
    // still not follow from what those sources say.
    strictEqual(
      problemKindFor({ ...base, evidence: found(95, 8), critiqueVerdict: 'weak' }),
      'weak-reasoning'
    )
  })

  it('does not treat a sound verdict as a problem', () => {
    strictEqual(problemKindFor({ ...base, critiqueVerdict: 'sound' }), 'missing-citation')
  })

  it('separates an unfindable number from an unfindable assertion', () => {
    strictEqual(
      problemKindFor({ ...base, claimType: 'statistic', evidence: found(0, 0) }),
      'unverified-statistic'
    )
    strictEqual(problemKindFor({ ...base, evidence: found(0, 0) }), 'no-sources')
  })

  it('bands evidence on the same 70/40 thresholds as the rest of the app', () => {
    strictEqual(problemKindFor({ ...base, evidence: found(39, 4) }), 'weak-evidence')
    strictEqual(problemKindFor({ ...base, evidence: found(40, 4) }), 'partial-evidence')
    strictEqual(problemKindFor({ ...base, evidence: found(69, 4) }), 'partial-evidence')
    strictEqual(problemKindFor({ ...base, evidence: found(70, 4) }), 'missing-citation')
  })

  it('never says "missing citation" about a sentence that has one', () => {
    // The complaint that started all of this. A cited claim that IS supported
    // is filtered out upstream as settled and never reaches this function.
    strictEqual(problemKindFor({ ...base, hasInlineCitation: false }), 'missing-citation')
  })

  it('separates a wrong citation from thin evidence', () => {
    // The alarming case: the writer attributed it, and the literature we found
    // does not carry what they attributed. It used to fall into weak-evidence,
    // whose copy never mentions the citation at all.
    strictEqual(
      problemKindFor({ ...base, hasInlineCitation: true, evidence: found(22, 5) }),
      'cited-unverified'
    )
    // Uncited at the same score is a different problem with different advice.
    strictEqual(
      problemKindFor({ ...base, hasInlineCitation: false, evidence: found(22, 5) }),
      'weak-evidence'
    )
  })

  it('says nothing about a cited claim the databases had no opinion on', () => {
    // Zero results is not a finding about a sentence that is already
    // attributed. The search corpus is four ACADEMIC APIs; a policy paper
    // cites UN pages, government programmes and newspapers, none of which they
    // index. Reporting that as "Citation may not support this" is asserting
    // something nobody checked — and on a well-cited essay it fired on nearly
    // every line.
    deepStrictEqual(
      problemKindsFor({ ...base, hasInlineCitation: true, evidence: found(0, 0) }),
      []
    )
    deepStrictEqual(
      problemKindsFor({
        ...base,
        claimType: 'statistic',
        hasInlineCitation: true,
        evidence: found(0, 0)
      }),
      []
    )
    // Uncited and unfindable is still a real finding: nothing was attributed,
    // and nothing was found.
    deepStrictEqual(
      problemKindsFor({ ...base, hasInlineCitation: false, evidence: found(0, 0) }),
      ['no-sources']
    )
  })

  it('ranks a wrong citation above every other problem', () => {
    ok(problemSeverity('cited-unverified') < problemSeverity('weak-reasoning'))
  })
})

describe('problemKindsFor — a sentence can be in more than one kind of trouble', () => {
  it('reports reasoning AND the citation gap together', () => {
    deepStrictEqual(problemKindsFor({ ...base, critiqueVerdict: 'weak' }), [
      'weak-reasoning',
      'missing-citation'
    ])
  })

  it('reports a cited statistic whose sources do not carry it as both', () => {
    // Sources came back and they score badly for this figure — that is two
    // facts, and the second is what tells the writer which part to check.
    // Zero results is deliberately NOT this case; see the test above.
    deepStrictEqual(
      problemKindsFor({
        ...base,
        claimType: 'statistic',
        hasInlineCitation: true,
        evidence: found(12, 4)
      }),
      ['cited-unverified']
    )
  })

  it('does not double-report thin evidence for a cited claim', () => {
    // cited-unverified already says it, with the right advice.
    deepStrictEqual(
      problemKindsFor({ ...base, hasInlineCitation: true, evidence: found(20, 5) }),
      ['cited-unverified']
    )
  })

  it('returns nothing at all for a cited, well-supported claim', () => {
    // Filtered out upstream as settled; this is the same judgement from here.
    deepStrictEqual(problemKindsFor({ ...base, hasInlineCitation: true }), [])
  })

  it('makes searching the sole kind, since nothing else is known', () => {
    deepStrictEqual(problemKindsFor({ ...base, evidence: null }), ['searching'])
  })

  it('always orders worst first, so the card shows the right one', () => {
    const kinds = problemKindsFor({ ...base, critiqueVerdict: 'contradicted' })
    strictEqual(kinds[0], 'contradicted-claim')
    strictEqual(problemKindFor({ ...base, critiqueVerdict: 'contradicted' }), kinds[0])
  })
})

describe('problemSeverity', () => {
  it('ranks reasoning and unfindable numbers above a tidy claim wanting a citation', () => {
    ok(problemSeverity('weak-reasoning') < problemSeverity('missing-citation'))
    ok(problemSeverity('unverified-statistic') < problemSeverity('partial-evidence'))
  })

  it('puts an unresolved search last, since nothing is known about it yet', () => {
    ok(problemSeverity('searching') > problemSeverity('missing-citation'))
  })

  it('gives every kind a place, so nothing sorts to -1 and jumps to the top', () => {
    const kinds = [
      'searching',
      'contradicted-claim',
      'weak-reasoning',
      'unverified-statistic',
      'no-sources',
      'weak-evidence',
      'partial-evidence',
      'missing-citation',
      'cited-unverified'
    ] as const
    for (const kind of kinds) ok(problemSeverity(kind) >= 0, `${kind} is unranked`)
  })
})

describe('fabricated-citation — a source that does not exist', () => {
  it('outranks a contradicted fact, the previous worst', () => {
    ok(
      problemSeverity('fabricated-citation') < problemSeverity('contradicted-claim'),
      'an invented source must sort above a wrong fact'
    )
  })

  it('is the sole reasoning kind, never doubled with weak-reasoning', () => {
    const kinds = problemKindsFor({ ...base, critiqueVerdict: 'fabricated' })
    strictEqual(kinds.filter((k) => k === 'weak-reasoning').length, 0)
    strictEqual(kinds[0], 'fabricated-citation')
  })

  it('fires for a cited sentence, which is the only way it can happen', () => {
    // The writer attributed it. That is what makes the verdict possible and
    // what makes it serious — before this verdict existed the sentence landed
    // in 'unsupported', which reads back as "may still be true".
    strictEqual(
      problemKindFor({
        ...base,
        hasInlineCitation: true,
        evidence: found(0, 0),
        critiqueVerdict: 'fabricated'
      }),
      'fabricated-citation'
    )
  })

  it('is not suppressed by a strong evidence score elsewhere in the sentence', () => {
    strictEqual(
      problemKindFor({
        ...base,
        hasInlineCitation: true,
        evidence: found(95, 8),
        critiqueVerdict: 'fabricated'
      }),
      'fabricated-citation'
    )
  })
})

describe('overstated-claim — defensible substance, indefensible quantifier', () => {
  it('is not folded in with weak reasoning', () => {
    const kinds = problemKindsFor({ ...base, critiqueVerdict: 'overstated' })
    strictEqual(kinds.includes('weak-reasoning'), false)
    strictEqual(kinds[0], 'overstated-claim')
  })

  it('outranks every evidence finding, since no source can fix a quantifier', () => {
    for (const kind of ['unverified-statistic', 'no-sources', 'weak-evidence', 'partial-evidence'] as const) {
      ok(
        problemSeverity('overstated-claim') < problemSeverity(kind),
        `overstated-claim should outrank ${kind}`
      )
    }
  })

  it('still ranks below the two findings about truth', () => {
    ok(problemSeverity('overstated-claim') > problemSeverity('contradicted-claim'))
    ok(problemSeverity('overstated-claim') > problemSeverity('fabricated-citation'))
  })

  it('survives a zero evidence score — the problem is the wording, not the sourcing', () => {
    strictEqual(
      problemKindFor({ ...base, evidence: found(0, 0), critiqueVerdict: 'overstated' }),
      'overstated-claim'
    )
  })
})

describe('unsupported — a verdict about the claim, or about the search?', () => {
  // eval/critique/FINDINGS.md, 2026-08-16. Two of the five `unsupported`
  // verdicts in that run were reached with nothing on topic retrieved, and both
  // were on sentences that are true and properly hedged. The product printed
  // "Weak reasoning" over them.
  it('does not call a sentence weak because the search came back empty', () => {
    const kinds = problemKindsFor({ ...base, evidence: found(0, 0), critiqueVerdict: 'unsupported' })
    strictEqual(kinds.includes('weak-reasoning'), false, 'a retrieval miss is not a reasoning finding')
    // Reported honestly instead — same state, and the copy for this one says
    // "It may still be true — but you have nothing to cite for it yet."
    deepStrictEqual(kinds, ['no-sources'])
  })

  it('still calls it weak when there WAS on-topic evidence to read', () => {
    // The half of `unsupported` that is a real finding: the critique had
    // relevant sources in front of it and they do not carry the claim.
    deepStrictEqual(
      problemKindsFor({ ...base, evidence: found(30, 6), critiqueVerdict: 'unsupported' }),
      ['weak-reasoning', 'weak-evidence']
    )
  })

  it('says nothing at all about a cited sentence nothing was found for', () => {
    // Already attributed, and the academic corpus has no opinion. Neither half
    // of that is a finding about the writing.
    deepStrictEqual(
      problemKindsFor({
        ...base,
        hasInlineCitation: true,
        evidence: found(0, 0),
        critiqueVerdict: 'unsupported'
      }),
      []
    )
  })

  it('gates only `unsupported`, never `weak`', () => {
    // `weak` is a judgement about how the argument is made, which is readable
    // from the sentence itself. Only `unsupported` is the word doing two jobs.
    deepStrictEqual(
      problemKindsFor({ ...base, evidence: found(0, 0), critiqueVerdict: 'weak' }),
      ['weak-reasoning', 'no-sources']
    )
  })

  it('leaves the three truth verdicts alone, however empty the search', () => {
    for (const verdict of ['fabricated', 'contradicted', 'overstated'] as const) {
      strictEqual(
        problemKindsFor({ ...base, evidence: found(0, 0), critiqueVerdict: verdict }).length > 0,
        true,
        `${verdict} asserts something about the claim and must survive an empty search`
      )
    }
  })
})

describe('results returned vs results that are about the claim', () => {
  // The bug this separation exists for. The aggregator merges four providers
  // down to its top eight and returns eight for every claim in the app, so the
  // overlay's `count === 0` test for "nothing found" was unreachable — eight
  // papers about other subjects read as eight sources.
  it('reports eight off-topic results as no sources, not as weak evidence', () => {
    deepStrictEqual(problemKindsFor({ ...base, evidence: retrieved(8) }), ['no-sources'])
  })

  it('does not accuse a cited sentence over eight off-topic results', () => {
    // 'cited-unverified' says "your citation may not support this". Saying it
    // because a search of the wrong corpus came back empty is the accusation
    // problemKind's own comments say it must not make.
    deepStrictEqual(problemKindsFor({ ...base, hasInlineCitation: true, evidence: retrieved(8) }), [])
  })

  it('reads the relevance floor off the breakdown, not the result count', () => {
    strictEqual(hasRelevantSource(null), false)
    strictEqual(hasRelevantSource({ sourceCount: 0, quality: 1, recency: 1, relevance: 0, support: 0 }), false)
    strictEqual(hasRelevantSource({ sourceCount: 0.167, quality: 0, recency: 0, relevance: 0, support: 0 }), true)
  })

  it('names a retrieval miss only for the one verdict that is ambiguous', () => {
    strictEqual(isRetrievalMiss('unsupported', false), true)
    strictEqual(isRetrievalMiss('unsupported', true), false)
    strictEqual(isRetrievalMiss('weak', false), false)
    strictEqual(isRetrievalMiss('contradicted', false), false)
    strictEqual(isRetrievalMiss(null, false), false)
  })
})
