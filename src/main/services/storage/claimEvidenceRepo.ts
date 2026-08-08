import { randomUUID } from 'crypto'
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

export function getEvidenceForClaim(claimId: string): EvidenceItem[] {
  const rows = queryAll<ClaimEvidenceRow>(
    'SELECT source_id, relevance_score, rank, stance, stance_confidence FROM claim_evidence WHERE claim_id = $claimId ORDER BY rank',
    { $claimId: claimId }
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
