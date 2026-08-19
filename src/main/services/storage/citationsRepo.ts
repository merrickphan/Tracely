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

/**
 * Store the formatted citation, replacing what is there when it has changed.
 *
 * This used to return the existing row untouched, which made the table a cache
 * of a pure function with no way to invalidate it. When the formatters stopped
 * putting a DOI on books (2026-08-19), every source already cited once kept its
 * old text forever — the owner installed the fix and the reference list still
 * read `https://doi.org/…`, because the row predated it.
 *
 * Formatting is string concatenation. There was never anything to cache.
 */
export function saveCitation(sourceId: string, style: CitationStyle, formattedText: string): Citation {
  const existing = getCitation(sourceId, style)
  if (existing) {
    if (existing.formattedText === formattedText) return existing
    run('UPDATE citations SET formatted_text = $text WHERE id = $id', {
      $id: existing.id,
      $text: formattedText
    })
    return { ...existing, formattedText }
  }

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
