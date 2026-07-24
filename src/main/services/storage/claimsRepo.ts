import { randomUUID } from 'crypto'
import type { Claim, ClaimType, CritiqueVerdict, ScoreBreakdown } from '@shared/types'
import { queryAll, queryOne, run } from './db'

interface ClaimRow {
  id: string
  analysis_id: string
  text: string
  claim_type: string
  confidence: number
  search_query: string
  strength_score: number | null
  score_breakdown: string | null
  critique: string | null
  critique_verdict: string | null
  created_at: string
}

function toDomain(row: ClaimRow): Claim {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    text: row.text,
    claimType: row.claim_type as ClaimType,
    confidence: row.confidence,
    searchQuery: row.search_query,
    strengthScore: row.strength_score,
    scoreBreakdown: row.score_breakdown ? (JSON.parse(row.score_breakdown) as ScoreBreakdown) : null,
    critique: row.critique,
    critiqueVerdict: row.critique_verdict as CritiqueVerdict | null,
    createdAt: row.created_at
  }
}

export interface NewClaim {
  text: string
  claimType: ClaimType
  confidence: number
  searchQuery: string
}

export function insertClaims(analysisId: string, claims: NewClaim[]): Claim[] {
  const createdAt = new Date().toISOString()
  return claims.map((c) => {
    const id = randomUUID()
    run(
      `INSERT INTO claims (id, analysis_id, text, claim_type, confidence, search_query, created_at)
       VALUES ($id, $analysisId, $text, $type, $confidence, $query, $createdAt)`,
      {
        $id: id,
        $analysisId: analysisId,
        $text: c.text,
        $type: c.claimType,
        $confidence: c.confidence,
        $query: c.searchQuery,
        $createdAt: createdAt
      }
    )
    return {
      id,
      analysisId,
      text: c.text,
      claimType: c.claimType,
      confidence: c.confidence,
      searchQuery: c.searchQuery,
      strengthScore: null,
      scoreBreakdown: null,
      critique: null,
      critiqueVerdict: null,
      createdAt
    }
  })
}

export function getClaimsByAnalysis(analysisId: string): Claim[] {
  const rows = queryAll<ClaimRow>('SELECT * FROM claims WHERE analysis_id = $id ORDER BY created_at', {
    $id: analysisId
  })
  return rows.map(toDomain)
}

export function getClaim(id: string): Claim | null {
  const row = queryOne<ClaimRow>('SELECT * FROM claims WHERE id = $id', { $id: id })
  return row ? toDomain(row) : null
}

export function updateClaimScore(claimId: string, score: number, breakdown: ScoreBreakdown): void {
  run('UPDATE claims SET strength_score = $score, score_breakdown = $breakdown WHERE id = $id', {
    $id: claimId,
    $score: score,
    $breakdown: JSON.stringify(breakdown)
  })
}

export function updateClaimCritique(claimId: string, critique: string, verdict: CritiqueVerdict): void {
  run('UPDATE claims SET critique = $critique, critique_verdict = $verdict WHERE id = $id', {
    $id: claimId,
    $critique: critique,
    $verdict: verdict
  })
}
