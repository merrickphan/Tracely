import { createHash } from 'crypto'
import type { Claim, CritiqueVerdict, EvidenceItem } from '@shared/types'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import {
  MAX_CRITIQUE_ABSTRACT_CHARS,
  MAX_CRITIQUE_EVIDENCE_ITEMS,
  MIN_CRITIQUE_EVIDENCE_ITEMS,
  MIN_CRITIQUE_RELEVANCE
} from './costGuard'

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

// Critique is the app's single most expensive call — it runs once per
// claim, on the reasoning model, while detection runs once per document on
// the cheap one. Eight claims means eight of these, so what goes into them
// is where the money is.
//
// Previously: the top 5 evidence items by rank, whatever they were. An eval
// run showed ~2 of 3 retrieved sources are off-topic, so most of that
// spend was paying the expensive model to read a paper about atrial
// fibrillation and conclude it doesn't support a claim about school start
// times. Dropping items that don't clear the relevance floor cuts input
// while *improving* the critique, because the model stops splitting its
// attention across noise — the one case where cheaper and better point the
// same way.
//
// The floor is only applied while at least MIN_KEPT items survive it: a
// claim whose retrieval failed entirely still needs a critique that says
// so, and "no supporting evidence was found" is a different (and less
// useful) message than "here are the two closest things we found".
function selectCritiqueEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const relevant = evidence.filter((e) => e.relevanceScore >= MIN_CRITIQUE_RELEVANCE)
  const chosen = relevant.length >= MIN_CRITIQUE_EVIDENCE_ITEMS ? relevant : evidence
  return chosen.slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)
}

function cacheKey(claim: Claim, evidence: EvidenceItem[]): string {
  // Keyed on the evidence actually sent, not the first N of the raw list —
  // otherwise two different evidence sets that happen to share their first
  // few entries would collide on one cached critique.
  const evidenceIds = selectCritiqueEvidence(evidence)
    .map((e) => e.source.id)
    .sort()
    .join(',')
  // v5: off-topic evidence is now dropped before the model sees it, and the
  // abstract budget settled at 900 chars — v4 entries were formed from a
  // different (larger, noisier) evidence set.
  return createHash('sha256').update(`ai:critique::v5::${claim.id}::${evidenceIds}`).digest('hex')
}

export async function generateCritique(claim: Claim, evidence: EvidenceItem[]): Promise<CritiqueResult> {
  const key = cacheKey(claim, evidence)

  const cached = getCached<CritiqueResult>(key)
  if (cached) return cached

  const topEvidence = selectCritiqueEvidence(evidence)
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
