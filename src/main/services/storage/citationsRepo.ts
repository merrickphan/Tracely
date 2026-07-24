import { randomUUID } from 'crypto'
import type { Citation, CitationStyle } from '@shared/types'
import { queryAll, queryOne, run } from './db'

interface CitationRow {
  id: string
  source_id: string
  style: string
  formatted_text: string
  created_at: string
}

function toDomain(row: CitationRow): Citation {
  return {
    id: row.id,
    sourceId: row.source_id,
    style: row.style as CitationStyle,
    formattedText: row.formatted_text,
    createdAt: row.created_at
  }
}

export function getCitation(sourceId: string, style: CitationStyle): Citation | null {
  const row = queryOne<CitationRow>('SELECT * FROM citations WHERE source_id = $sourceId AND style = $style', {
    $sourceId: sourceId,
    $style: style
  })
  return row ? toDomain(row) : null
}

export function saveCitation(sourceId: string, style: CitationStyle, formattedText: string): Citation {
  const existing = getCitation(sourceId, style)
  if (existing) return existing

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  run(
    `INSERT INTO citations (id, source_id, style, formatted_text, created_at) VALUES ($id, $sourceId, $style, $text, $createdAt)`,
    { $id: id, $sourceId: sourceId, $style: style, $text: formattedText, $createdAt: createdAt }
  )
  return { id, sourceId, style, formattedText, createdAt }
}

export function listCitationsForSource(sourceId: string): Citation[] {
  const rows = queryAll<CitationRow>('SELECT * FROM citations WHERE source_id = $sourceId', { $sourceId: sourceId })
  return rows.map(toDomain)
}
