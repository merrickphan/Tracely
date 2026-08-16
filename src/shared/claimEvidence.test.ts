import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claimEvidenceFor } from './claimEvidence.ts'

/**
 * A scored claim whose search found `relevant` of the six-source cap on topic.
 *
 * `sourceCount` is written the way scoring.ts writes it — a 0..1 fraction, not
 * a tally — because that is the whole reason this module exists.
 */
const scored = (
  score: number,
  relevant: number
): { strengthScore: number | null; scoreBreakdown: null | {
  sourceCount: number
  quality: number
  recency: number
  relevance: number
  support: number
} } => ({
  strengthScore: score,
  scoreBreakdown: { sourceCount: Math.min(relevant, 6) / 6, quality: 0.5, recency: 0.5, relevance: 0.5, support: 0 }
})

describe('claimEvidenceFor', () => {
  it('reports the number of articles it was given, not the relevance fraction', () => {
    // The bug. `sourceCount` here is 4/6 = 0.666…, and problemCopyFor renders
    // `count` straight into copy — so the popover read "0.6666666666666666
    // sources came back". The count has to come from the caller's evidence
    // list, because nothing on the claim row is one.
    const evidence = claimEvidenceFor(scored(35, 4), 8)
    strictEqual(evidence?.count, 8)
  })

  it('never returns a fractional count, whatever the breakdown says', () => {
    for (const relevant of [0, 1, 3, 5, 6]) {
      const evidence = claimEvidenceFor(scored(50, relevant), 8)
      strictEqual(Number.isInteger(evidence?.count), true, `relevant=${relevant} produced ${evidence?.count}`)
    }
  })

  it('passes the breakdown through untouched, since that is where the fraction belongs', () => {
    // hasRelevantSource and supportLevelFor both read the fraction off the
    // breakdown. Only `count` was ever the wrong home for it.
    const evidence = claimEvidenceFor(scored(35, 4), 8)
    strictEqual(evidence?.breakdown.sourceCount, 4 / 6)
  })

  it('says nothing at all until the search has resolved', () => {
    strictEqual(claimEvidenceFor({ strengthScore: null, scoreBreakdown: null }, 8), null)
  })

  it('says nothing at all until the count has been read', () => {
    // NOT the same as a count of zero, which is why `undefined` is answered
    // with null rather than 0: measureMarks skips a null, so an unread list
    // draws no underline instead of one whose card claims "0 sources".
    strictEqual(claimEvidenceFor(scored(35, 4), undefined), null)
  })

  it('treats a genuinely empty result list as an answer, not as unloaded', () => {
    const evidence = claimEvidenceFor(scored(0, 0), 0)
    strictEqual(evidence?.count, 0)
    strictEqual(evidence?.score, 0)
  })

  it('substitutes a zeroed breakdown for a scored claim that has none', () => {
    // Scored but unbroken-down should not crash the copy, which reads
    // breakdown.sourceCount to decide whether anything relevant came back.
    const evidence = claimEvidenceFor({ strengthScore: 12, scoreBreakdown: null }, 3)
    strictEqual(evidence?.breakdown.sourceCount, 0)
    strictEqual(evidence?.count, 3)
  })
})
