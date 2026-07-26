import { createHash } from 'crypto'
import type { Claim, CritiqueVerdict, EvidenceItem } from '@shared/types'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import { MAX_CRITIQUE_EVIDENCE_ITEMS } from './costGuard'

export interface CritiqueResult {
  critique: string
  verdict: CritiqueVerdict
}

function cacheKey(claim: Claim, evidence: EvidenceItem[]): string {
  const evidenceIds = evidence
    .slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)
    .map((e) => e.source.id)
    .sort()
    .join(',')
  // v2: prompt now fact-checks the claim's specific assertions and can return
  // a "contradicted" verdict — bump so stale v1 results aren't served for old claims.
  return createHash('sha256').update(`ai:critique::v2::${claim.id}::${evidenceIds}`).digest('hex')
}

export async function generateCritique(claim: Claim, evidence: EvidenceItem[]): Promise<CritiqueResult> {
  const key = cacheKey(claim, evidence)

  const cached = getCached<CritiqueResult>(key)
  if (cached) return cached

  const topEvidence = evidence.slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)
  const evidenceSummary = topEvidence.length
    ? topEvidence
        .map((e, i) => `${i + 1}. ${e.source.title}${e.source.abstract ? ` — ${e.source.abstract.slice(0, 300)}` : ''}`)
        .join('\n')
    : 'No supporting evidence was found.'

  const result = await callRelay<CritiqueResult>('critique', {
    claimText: claim.text,
    strengthScore: claim.strengthScore,
    evidenceSummary
  })

  setCached(key, 'ai:critique', result)
  return result
}
