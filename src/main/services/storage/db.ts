import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { SCHEMA_SQL } from './schema'

let db: Database | null = null
let dbPath: string | null = null

function getWasmPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'sql-wasm.wasm')
  }
  return join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

export async function initDb(): Promise<void> {
  if (db) return

  const wasmBytes = readFileSync(getWasmPath())
  const wasmBinary = wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength
  ) as ArrayBuffer
  const SQL = await initSqlJs({ wasmBinary })

  dbPath = join(app.getPath('userData'), 'tracely.db')
  mkdirSync(dirname(dbPath), { recursive: true })

  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath))
  } else {
    db = new SQL.Database()
  }

  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_SQL)
  persist()
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

export function persist(): void {
  if (!db || !dbPath) return
  const bytes = db.export()
  writeFileSync(dbPath, Buffer.from(bytes))
}

export type SqlParams = Record<string, SqlValue> | SqlValue[]

export function run(sql: string, params: SqlParams = []): void {
  getDb().run(sql, params)
  persist()
}

export function queryAll<T = Record<string, SqlValue>>(sql: string, params: SqlParams = []): T[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function queryOne<T = Record<string, SqlValue>>(sql: string, params: SqlParams = []): T | null {
  const rows = queryAll<T>(sql, params)
  return rows[0] ?? null
}

export function resetDatabase(): void {
  if (!dbPath) return
  getDb().exec(
    'DELETE FROM claim_evidence; DELETE FROM citations; DELETE FROM library_items; DELETE FROM claims; DELETE FROM analyses; DELETE FROM sources; DELETE FROM request_cache; DELETE FROM tracer_messages; DELETE FROM tracer_conversations;'
  )
  persist()
}

// Tracer conversations are cleared here too: they quote the user's own
// writing back at them, so leaving them behind would defeat the point of
// "Clear Analysis History" as a privacy control, even though they live in
// their own tables rather than analyses/claims.
export function clearAnalysisHistory(): void {
  getDb().exec(
    'DELETE FROM claim_evidence; DELETE FROM claims; DELETE FROM analyses; DELETE FROM request_cache; DELETE FROM tracer_messages; DELETE FROM tracer_conversations;'
  )
  persist()
}
