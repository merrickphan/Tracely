import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claimsWithoutEvidence, computeEvidenceCoverage } from './evidenceCoverage.ts'

/**
 * `sourceCount` is the only breakdown factor read; the rest are filled with a
 * constant so a change to the others can't silently affect these assertions.
 */
function claim(id: string, strengthScore: number | null, sourceCount: number | null) {
  return {
    id,
    analysisId: 'a1',
    text: `claim ${id}`,
    claimType: 'factual' as const,
    confidence: 0.8,
    searchQuery: id,
    strengthScore,
    scoreBreakdown:
      sourceCount === null
        ? null
        : { sourceCount, quality: 0.5, recency: 0.5, relevance: 0.5, support: 0 },
    critique: null,
    critiqueVerdict: null,
    createdAt: '2026-03-14T16:20:00.000Z'
  }
}

/** Searched, sources found. */
const supported = claim('supported', 72, 0.5)
/** Searched, nothing cleared the relevance floor. */
const searchedEmpty = claim('empty', 18, 0)
/** Never searched. */
const unchecked = claim('unchecked', null, null)

describe('computeEvidenceCoverage', () => {
  it('counts detected, supported and unchecked separately', () => {
    deepStrictEqual(computeEvidenceCoverage([supported, searchedEmpty, unchecked]), {
      detected: 3,
      withRelevantSource: 1,
      meanStrength: 45,
      unchecked: 1
    })
  })

  it('reports a null mean when nothing has been searched', () => {
    deepStrictEqual(computeEvidenceCoverage([unchecked, unchecked]), {
      detected: 2,
      withRelevantSource: 0,
      meanStrength: null,
      unchecked: 2
    })
  })

  it('averages only over claims whose search resolved', () => {
    // An unsearched claim must not drag the mean toward zero — that would read
    // as weak evidence when the truth is no evidence gathered yet.
    strictEqual(computeEvidenceCoverage([supported, unchecked]).meanStrength, 72)
  })

  it('does not count a searched-but-empty claim as supported', () => {
    strictEqual(computeEvidenceCoverage([searchedEmpty]).withRelevantSource, 0)
    strictEqual(computeEvidenceCoverage([searchedEmpty]).unchecked, 0)
  })

  it('handles no claims at all', () => {
    deepStrictEqual(computeEvidenceCoverage([]), {
      detected: 0,
      withRelevantSource: 0,
      meanStrength: null,
      unchecked: 0
    })
  })
})

describe('claimsWithoutEvidence', () => {
  it('returns claims that were searched and found nothing', () => {
    deepStrictEqual(claimsWithoutEvidence([supported, searchedEmpty, unchecked]), ['empty'])
  })

  it('excludes claims that have never been searched', () => {
    // "We looked and found nothing" and "we have not looked" are different
    // statements, and only the first is a weakness in the draft.
    deepStrictEqual(claimsWithoutEvidence([unchecked]), [])
  })

  it('excludes supported claims', () => {
    deepStrictEqual(claimsWithoutEvidence([supported]), [])
  })

  it('treats a resolved claim with a missing breakdown as unsupported', () => {
    deepStrictEqual(claimsWithoutEvidence([claim('odd', 30, null)]), ['odd'])
  })
})
