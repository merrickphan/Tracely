import { randomUUID } from 'crypto'
import type { LibraryItem } from '@shared/types'
import { queryAll, queryOne, run } from './db'
import { getSourceById } from './sourcesRepo'

interface LibraryRow {
  id: string
  source_id: string
  claim_id: string | null
  notes: string | null
  tags: string | null
  saved_at: string
}

function toDomain(row: LibraryRow): LibraryItem | null {
  const source = getSourceById(row.source_id)
  if (!source) return null
  return {
    id: row.id,
    sourceId: row.source_id,
    claimId: row.claim_id,
    notes: row.notes,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    savedAt: row.saved_at,
    source
  }
}

export interface SaveToLibraryInput {
  sourceId: string
  claimId?: string
  notes?: string
  tags?: string[]
}

export function saveToLibrary(input: SaveToLibraryInput): LibraryItem {
  const existing = queryOne<LibraryRow>('SELECT * FROM library_items WHERE source_id = $sourceId', {
    $sourceId: input.sourceId
  })
  if (existing) {
    const item = toDomain(existing)
    if (item) return item
  }

  const id = randomUUID()
  const savedAt = new Date().toISOString()
  run(
    `INSERT INTO library_items (id, source_id, claim_id, notes, tags, saved_at)
     VALUES ($id, $sourceId, $claimId, $notes, $tags, $savedAt)`,
    {
      $id: id,
      $sourceId: input.sourceId,
      $claimId: input.claimId ?? null,
      $notes: input.notes ?? null,
      $tags: JSON.stringify(input.tags ?? []),
      $savedAt: savedAt
    }
  )

  const item = toDomain({
    id,
    source_id: input.sourceId,
    claim_id: input.claimId ?? null,
    notes: input.notes ?? null,
    tags: JSON.stringify(input.tags ?? []),
    saved_at: savedAt
  })
  if (!item) throw new Error('Failed to save source to library')
  return item
}

export function listLibrary(search?: string, tag?: string): LibraryItem[] {
  const rows = queryAll<LibraryRow>('SELECT * FROM library_items ORDER BY saved_at DESC')
  let items = rows.map(toDomain).filter((item): item is LibraryItem => item !== null)

  if (search) {
    const needle = search.toLowerCase()
    items = items.filter((item) => item.source.title.toLowerCase().includes(needle))
  }
  if (tag) {
    items = items.filter((item) => item.tags.includes(tag))
  }
  return items
}

export function getLibraryItem(id: string): LibraryItem | null {
  const row = queryOne<LibraryRow>('SELECT * FROM library_items WHERE id = $id', { $id: id })
  return row ? toDomain(row) : null
}

export function updateLibraryItem(id: string, notes?: string, tags?: string[]): LibraryItem {
  const existing = getLibraryItem(id)
  if (!existing) throw new Error('Library item not found')

  run('UPDATE library_items SET notes = $notes, tags = $tags WHERE id = $id', {
    $id: id,
    $notes: notes ?? existing.notes,
    $tags: JSON.stringify(tags ?? existing.tags)
  })

  const updated = getLibraryItem(id)
  if (!updated) throw new Error('Library item not found')
  return updated
}

export function removeLibraryItem(id: string): void {
  run('DELETE FROM library_items WHERE id = $id', { $id: id })
}
