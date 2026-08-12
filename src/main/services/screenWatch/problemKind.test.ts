import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { problemKindFor, problemKindsFor, problemSeverity } from './problemKind.ts'

const base = {
  claimType: 'factual' as const,
  hasInlineCitation: false,
  evidence: { score: 80, count: 5 },
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
      problemKindsFor({ ...base, hasInlineCitation: true, evidence: { score: 0, count: 0 }, critiqueVerdict: 'contradicted' })[0],
      'contradicted-claim'
    )
  })

  it('puts reasoning above evidence, however well sourced', () => {
    // The point of the ordering: a claim can be perfectly well sourced and
    // still not follow from what those sources say.
    strictEqual(
      problemKindFor({ ...base, evidence: { score: 95, count: 8 }, critiqueVerdict: 'weak' }),
      'weak-reasoning'
    )
  })

  it('does not treat a sound verdict as a problem', () => {
    strictEqual(problemKindFor({ ...base, critiqueVerdict: 'sound' }), 'missing-citation')
  })

  it('separates an unfindable number from an unfindable assertion', () => {
    strictEqual(
      problemKindFor({ ...base, claimType: 'statistic', evidence: { score: 0, count: 0 } }),
      'unverified-statistic'
    )
    strictEqual(problemKindFor({ ...base, evidence: { score: 0, count: 0 } }), 'no-sources')
  })

  it('bands evidence on the same 70/40 thresholds as the rest of the app', () => {
    strictEqual(problemKindFor({ ...base, evidence: { score: 39, count: 4 } }), 'weak-evidence')
    strictEqual(problemKindFor({ ...base, evidence: { score: 40, count: 4 } }), 'partial-evidence')
    strictEqual(problemKindFor({ ...base, evidence: { score: 69, count: 4 } }), 'partial-evidence')
    strictEqual(problemKindFor({ ...base, evidence: { score: 70, count: 4 } }), 'missing-citation')
  })

  it('never says "missing citation" about a sentence that has one', () => {
    // The complaint that started all of this. A cited claim that IS supported
    // is filtered out upstream as settled and never reaches this function.
    strictEqual(problemKindFor({ ...base, hasInlineCitation: false }), 'missing-citation')
  })

  it('separates a wrong citation from thin evidence', () => {
    // The alarming case: the writer attributed it, and the literature does not
    // carry what they attributed. It used to fall into weak-evidence, whose
    // copy never mentions the citation at all.
    strictEqual(
      problemKindFor({ ...base, hasInlineCitation: true, evidence: { score: 0, count: 0 } }),
      'cited-unverified'
    )
    strictEqual(
      problemKindFor({ ...base, hasInlineCitation: true, evidence: { score: 22, count: 5 } }),
      'cited-unverified'
    )
    // Uncited at the same score is a different problem with different advice.
    strictEqual(
      problemKindFor({ ...base, hasInlineCitation: false, evidence: { score: 22, count: 5 } }),
      'weak-evidence'
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

  it('reports a cited statistic that nothing carries as both', () => {
    // "You cited this AND no database has the figure" is two facts, and the
    // second is what tells the writer which part to go and check.
    deepStrictEqual(
      problemKindsFor({
        ...base,
        claimType: 'statistic',
        hasInlineCitation: true,
        evidence: { score: 0, count: 0 }
      }),
      ['cited-unverified', 'unverified-statistic']
    )
  })

  it('does not double-report thin evidence for a cited claim', () => {
    // cited-unverified already says it, with the right advice.
    deepStrictEqual(
      problemKindsFor({ ...base, hasInlineCitation: true, evidence: { score: 20, count: 5 } }),
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
