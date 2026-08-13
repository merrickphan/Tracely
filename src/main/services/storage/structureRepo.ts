import type { DocumentOutline } from '@shared/types'
import { queryOne, run } from './db'

interface StructureRow {
  document_id: string
  source_hash: string
  schema_version: number
  outline_json: string
  analyzed_at: string
}

/**
 * The Structure panel's stored analysis, one row per document.
 *
 * Everything here treats the row as a cache that may be wrong rather than as
 * data that must be right — see the schema comment. A row written by an older
 * build is discarded on read instead of being migrated or, worse, parsed into a
 * shape the current code does not expect.
 */

export function getStoredOutline(documentId: string, expectedVersion: number): DocumentOutline | null {
  const row = queryOne<StructureRow>('SELECT * FROM document_structure WHERE document_id = $id', {
    $id: documentId
  })
  if (!row || row.schema_version !== expectedVersion) return null

  try {
    return JSON.parse(row.outline_json) as DocumentOutline
  } catch {
    // A corrupt blob is not worth failing the panel over — the outline
    // recomputes from the document in milliseconds.
    return null
  }
}

export function saveOutline(outline: DocumentOutline): void {
  // An outline for an unsaved document has nowhere to hang: the foreign key
  // needs a document row, and the id arrives with the first autosave. Dropping
  // it is correct — the analysis is cheap to redo once the document exists.
  if (!outline.documentId) return

  run(
    `INSERT INTO document_structure (document_id, source_hash, schema_version, outline_json, analyzed_at)
     VALUES ($id, $hash, $version, $json, $at)
     ON CONFLICT(document_id) DO UPDATE SET
       source_hash = excluded.source_hash,
       schema_version = excluded.schema_version,
       outline_json = excluded.outline_json,
       analyzed_at = excluded.analyzed_at`,
    {
      $id: outline.documentId,
      $hash: outline.sourceHash,
      $version: outline.schemaVersion,
      $json: JSON.stringify(outline),
      $at: outline.analyzedAt
    }
  )
}
