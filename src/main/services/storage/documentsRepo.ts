import { randomUUID } from 'crypto'
import type { DocumentRecord } from '@shared/types'
import { queryAll, queryOne, run } from './db'

interface DocumentRow {
  id: string
  title: string
  body_html: string
  created_at: string
  updated_at: string
}

function toDomain(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    bodyHtml: row.body_html,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listDocuments(): DocumentRecord[] {
  return queryAll<DocumentRow>('SELECT * FROM documents ORDER BY updated_at DESC').map(toDomain)
}

export function getDocument(id: string): DocumentRecord | null {
  const row = queryOne<DocumentRow>('SELECT * FROM documents WHERE id = $id', { $id: id })
  return row ? toDomain(row) : null
}

/** The most recently edited document, for reopening where the user left off. */
export function getLatestDocument(): DocumentRecord | null {
  const row = queryOne<DocumentRow>('SELECT * FROM documents ORDER BY updated_at DESC LIMIT 1')
  return row ? toDomain(row) : null
}

/**
 * Creates or updates a document.
 *
 * Upsert rather than separate create/update calls because the caller is an
 * autosave: the editor does not care whether this is the first save of a new
 * document or the fortieth of an existing one, and making it track that would
 * put the "have I saved yet?" race in the renderer.
 */
export function saveDocument(input: {
  id?: string | null
  title: string
  bodyHtml: string
}): DocumentRecord {
  const now = new Date().toISOString()
  const existing = input.id ? getDocument(input.id) : null

  if (existing) {
    run('UPDATE documents SET title = $title, body_html = $body, updated_at = $now WHERE id = $id', {
      $id: existing.id,
      $title: input.title,
      $body: input.bodyHtml,
      $now: now
    })
    return { ...existing, title: input.title, bodyHtml: input.bodyHtml, updatedAt: now }
  }

  const id = input.id ?? randomUUID()
  run(
    `INSERT INTO documents (id, title, body_html, created_at, updated_at)
     VALUES ($id, $title, $body, $now, $now)`,
    { $id: id, $title: input.title, $body: input.bodyHtml, $now: now }
  )
  return { id, title: input.title, bodyHtml: input.bodyHtml, createdAt: now, updatedAt: now }
}

export function removeDocument(id: string): void {
  run('DELETE FROM documents WHERE id = $id', { $id: id })
}
