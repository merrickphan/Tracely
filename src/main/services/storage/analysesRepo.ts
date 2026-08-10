import { randomUUID } from 'crypto'
import type { Analysis } from '@shared/types'
import { queryAll, queryOne, run } from './db'

interface AnalysisRow {
  id: string
  source_text: string
  origin: string
  created_at: string
}

function toDomain(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    sourceText: row.source_text,
    origin: row.origin as Analysis['origin'],
    createdAt: row.created_at
  }
}

export function createAnalysis(sourceText: string, origin: 'main' | 'floating'): Analysis {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  run('INSERT INTO analyses (id, source_text, origin, created_at) VALUES ($id, $text, $origin, $createdAt)', {
    $id: id,
    $text: sourceText,
    $origin: origin,
    $createdAt: createdAt
  })
  return { id, sourceText, origin, createdAt }
}

export function getAnalysis(id: string): Analysis | null {
  const row = queryOne<AnalysisRow>('SELECT * FROM analyses WHERE id = $id', { $id: id })
  return row ? toDomain(row) : null
}

export function listAnalyses(limit = 100): Analysis[] {
  const rows = queryAll<AnalysisRow>(
    'SELECT * FROM analyses WHERE origin = $origin ORDER BY created_at DESC LIMIT $limit',
    { $origin: 'main', $limit: limit }
  )
  return rows.map(toDomain)
}
