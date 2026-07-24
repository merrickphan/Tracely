import { randomUUID } from 'crypto'
import type { EvidenceItem } from '@shared/types'
import { queryAll, run } from './db'
import { getSourceById } from './sourcesRepo'

interface ClaimEvidenceRow {
  source_id: string
  relevance_score: number
  rank: number
}

export function linkEvidence(claimId: string, sourceId: string, relevanceScore: number, rank: number): void {
  run(
    `INSERT INTO claim_evidence (id, claim_id, source_id, relevance_score, rank, created_at)
     VALUES ($id, $claimId, $sourceId, $relevance, $rank, $createdAt)
     ON CONFLICT(claim_id, source_id) DO UPDATE SET relevance_score = $relevance, rank = $rank`,
    {
      $id: randomUUID(),
      $claimId: claimId,
      $sourceId: sourceId,
      $relevance: relevanceScore,
      $rank: rank,
      $createdAt: new Date().toISOString()
    }
  )
}

export function getEvidenceForClaim(claimId: string): EvidenceItem[] {
  const rows = queryAll<ClaimEvidenceRow>(
    'SELECT source_id, relevance_score, rank FROM claim_evidence WHERE claim_id = $claimId ORDER BY rank',
    { $claimId: claimId }
  )

  return rows
    .map((row) => {
      const source = getSourceById(row.source_id)
      if (!source) return null
      return { source, relevanceScore: row.relevance_score, rank: row.rank }
    })
    .filter((item): item is EvidenceItem => item !== null)
}
