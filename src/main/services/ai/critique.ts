import { createHash } from 'crypto'
import type { Claim, CritiqueVerdict, EvidenceItem } from '@shared/types'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import { normalizeCritique } from './normalizeCritique'
import {
  MAX_CRITIQUE_ABSTRACT_CHARS,
  MAX_CRITIQUE_EVIDENCE_ITEMS,
  MIN_CRITIQUE_EVIDENCE_ITEMS,
  MIN_CRITIQUE_RELEVANCE
} from './costGuard'

export interface CritiqueResult {
  critique: string
  verdict: CritiqueVerdict
  /**
   * The claim's own sentence with ONLY its quantifier, scope or hedge changed,
   * when it is defensible but overstated. Null in every other case.
   *
   * Deliberately narrow. Tracer's prompt forbids writing sentences for the
   * student and that rule is not being relaxed here: narrowing "100%" to
   * "generally" is a correction of accuracy, not composition — it changes what
   * the sentence claims, not how it reads. Anything that adds a fact, a clause
   * or a citation is out of scope, and the relay prompt says so explicitly.
   */
  suggestedRevision: string | null
  /**
   * The corrected reference when a real source is cited in a malformed way.
   *
   * The counterweight to `fabricated`. A student who reversed the author order
   * or mixed MLA with APA has made a formatting mistake, and the single worst
   * thing this product could do is call that an invented source — so the relay
   * is instructed to prefer this outcome whenever it is unsure, and this field
   * is always null when the verdict is `fabricated`.
   */
  citationFix: string | null
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
// Relevant items FIRST, then the rest as padding — not "the filtered list, or
// else the raw list". The raw list is ordered by rank, so the old fallback
// (`relevant.length >= MIN ? relevant : evidence`) then took the first four by
// rank: a claim with exactly one relevant source sitting at rank 5 had that
// source dropped and four off-topic ones sent in its place. The one case the
// fallback exists for is the one case it broke.
function selectCritiqueEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const relevant = evidence.filter((e) => e.relevanceScore >= MIN_CRITIQUE_RELEVANCE)
  if (relevant.length >= MIN_CRITIQUE_EVIDENCE_ITEMS) return relevant.slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)

  const padding = evidence.filter((e) => e.relevanceScore < MIN_CRITIQUE_RELEVANCE)
  return [...relevant, ...padding].slice(0, MAX_CRITIQUE_EVIDENCE_ITEMS)
}

function cacheKey(claim: Claim, evidence: EvidenceItem[]): string {
  // Keyed on the evidence actually sent, not the first N of the raw list —
  // otherwise two different evidence sets that happen to share their first
  // few entries would collide on one cached critique.
  const evidenceIds = selectCritiqueEvidence(evidence)
    .map((e) => e.source.id)
    .sort()
    .join(',')
  // v6: keyed on the claim's TEXT and score — the actual request body — rather
  // than `claim.id`.
  //
  // The id looked equivalent and was not. Screen Watch synthesizes its claims
  // in memory with a fresh randomUUID() on every detection (see
  // synthesizeClaim), so an id-keyed entry could never be hit there: editing a
  // paragraph and having the same sentence re-detected paid a fresh call on the
  // reasoning model — the most expensive call in the product — for input the
  // relay had already answered. The in-app path had a weaker version of the
  // same problem, since re-analyzing a document mints new claim rows too.
  //
  // strengthScore is in the key because it is in the request body. It usually
  // moves with the evidence set, but not always: the same sources rescored (ML
  // on vs off) is a different question with the same evidenceIds.
  // v7: the response gained `suggestedRevision` and `citationFix`. Every v6
  // entry was written by a relay that could not produce either, so reusing them
  // would silently withhold the new output from exactly the claims a user has
  // already looked at — the ones most likely to be looked at again.
  const normalizedText = claim.text.trim().replace(/\s+/g, ' ').toLowerCase()
  return createHash('sha256')
    .update(`ai:critique::v7::${normalizedText}::${claim.strengthScore ?? 'null'}::${evidenceIds}`)
    .digest('hex')
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

  const raw = await callRelay<CritiqueResult>('critique', {
    claimText: claim.text,
    strengthScore: claim.strengthScore,
    evidenceSummary
  })

  const result = normalizeCritique(raw)
  setCached(key, 'ai:critique', result)
  return result
}
