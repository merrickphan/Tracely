import { randomUUID } from 'crypto'
import { MAX_EVIDENCE_RESULTS } from '@shared/evidenceLimits'
import type { EvidenceItem } from '@shared/types'
import type { Stance } from '../ml/protocol'
import { queryAll, run } from './db'
import { getSourceById } from './sourcesRepo'

interface ClaimEvidenceRow {
  source_id: string
  relevance_score: number
  rank: number
  stance: string | null
  stance_confidence: number | null
}

/**
 * Drop every source currently linked to a claim.
 *
 * Called before a fresh search writes its results, because `linkEvidence`
 * upserts and therefore ACCUMULATES: a search that returns five sources leaves
 * a previous search's other eleven in place, and the picker reads all of them.
 * A re-search is the writer saying "look again", and the answer to that is the
 * new list, not the new list merged into the old one.
 */
export function clearEvidenceForClaim(claimId: string): void {
  run('DELETE FROM claim_evidence WHERE claim_id = $claimId', { $claimId: claimId })
}

export function linkEvidence(
  claimId: string,
  sourceId: string,
  relevanceScore: number,
  rank: number,
  // Null where the question was never answered — the model was unavailable, or
  // the source did not clear the relevance bar. Distinct from 'unclear', which
  // means it was asked and the answer was "not evidence either way".
  stance: Stance | null = null,
  stanceConfidence: number | null = null
): void {
  run(
    `INSERT INTO claim_evidence (id, claim_id, source_id, relevance_score, rank, stance, stance_confidence, created_at)
     VALUES ($id, $claimId, $sourceId, $relevance, $rank, $stance, $stanceConfidence, $createdAt)
     ON CONFLICT(claim_id, source_id) DO UPDATE SET
       relevance_score = $relevance, rank = $rank, stance = $stance, stance_confidence = $stanceConfidence`,
    {
      $id: randomUUID(),
      $claimId: claimId,
      $sourceId: sourceId,
      $relevance: relevanceScore,
      $rank: rank,
      $stance: stance,
      $stanceConfidence: stanceConfidence,
      $createdAt: new Date().toISOString()
    }
  )
}

/**
 * Capped on READ, not just on search.
 *
 * The citation picker reads stored rows rather than re-running the providers,
 * and `linkEvidence` upserts per (claim, source) — so the sixteen rows a search
 * wrote before the cap existed are still there, and every already-searched
 * claim kept showing its old list after the cap shipped. Owner, 2026-08-19:
 * *"limit article choices to maximum 5 instead of like 10."*
 *
 * By rank rather than by relevance floor, deliberately. Which METRIC produced a
 * stored `relevance_score` is not persisted with the row (lexical runs on a
 * different scale from dense), so applying the dense floor to a lexically
 * scored row would drop sources that are fine. Rank is metric-independent, and
 * a re-search replaces the rows with properly filtered ones.
 */
export function getEvidenceForClaim(claimId: string): EvidenceItem[] {
  const rows = queryAll<ClaimEvidenceRow>(
    'SELECT source_id, relevance_score, rank, stance, stance_confidence FROM claim_evidence WHERE claim_id = $claimId ORDER BY rank LIMIT $limit',
    { $claimId: claimId, $limit: MAX_EVIDENCE_RESULTS }
  )

  return rows
    .map((row) => {
      const source = getSourceById(row.source_id)
      if (!source) return null
      return {
        source,
        relevanceScore: row.relevance_score,
        rank: row.rank,
        stance: (row.stance as Stance | null) ?? null,
        stanceConfidence: row.stance_confidence
      }
    })
    .filter((item): item is EvidenceItem => item !== null)
}
