import { createHash } from 'crypto'
import type { Claim, CritiqueVerdict, EvidenceItem } from '@shared/types'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import { MAX_CRITIQUE_ABSTRACT_CHARS, MAX_CRITIQUE_EVIDENCE_ITEMS } from './costGuard'

export interface CritiqueResult {
  critique: string
  verdict: CritiqueVerdict
}

// A hard slice(0, N) can land mid-word or mid-fact ("...reduced mortality
// by 4" instead of "...by 47%"), feeding the model a truncated number right
// before asking it to fact-check numbers — cutting at the last whitespace
// before the limit costs a few characters but never severs a word.
function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…'
}

function cacheKey(claim: Claim, evidence: EvidenceItem[]): string {
  const evidenceIds = evidence
    .slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)
    .map((e) => e.source.id)
    .sort()
    .join(',')
  // v3: abstracts sent to the model are now truncated at a word boundary
  // instead of a hard character cut, and the relay prompt was tightened to
  // reduce generic/overconfident output — bump so stale v2 critiques
  // (built from mid-word-truncated abstracts) aren't served.
  return createHash('sha256').update(`ai:critique::v3::${claim.id}::${evidenceIds}`).digest('hex')
}

export async function generateCritique(claim: Claim, evidence: EvidenceItem[]): Promise<CritiqueResult> {
  const key = cacheKey(claim, evidence)

  const cached = getCached<CritiqueResult>(key)
  if (cached) return cached

  const topEvidence = evidence.slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)
  const evidenceSummary = topEvidence.length
    ? topEvidence
        .map(
          (e, i) =>
            `${i + 1}. ${e.source.title}${e.source.abstract ? ` — ${truncateAtWordBoundary(e.source.abstract, MAX_CRITIQUE_ABSTRACT_CHARS)}` : ''}`
        )
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
