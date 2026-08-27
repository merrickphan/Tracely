/**
 * Storage — node:sqlite (built in, no native build), one file under data/.
 * Migrations are a versioned list keyed off PRAGMA user_version; a brand-new
 * database runs the schema and then every migration, so migrations must be
 * idempotent. Never edit an existing table's definition in SCHEMA — add a
 * migration. If a fix changes how something is DERIVED, ask whether stored
 * rows need re-deriving too (that is usually the half that makes it visible).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "tracely.db"));
db.exec("PRAGMA journal_mode = WAL;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled',
  body_html TEXT NOT NULL DEFAULT '', created_at INTEGER, updated_at INTEGER,
  last_opened_at INTEGER, grade_letter TEXT, grade_score REAL
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY, document_id TEXT, source_text TEXT NOT NULL,
  created_at INTEGER, grade_json TEXT
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, text TEXT NOT NULL,
  sentence TEXT, start_off INTEGER, end_off INTEGER,
  claim_type TEXT, confidence REAL, query TEXT,
  strength_score REAL, strength_json TEXT,
  critique_verdict TEXT, critique_json TEXT, retrieval_gen INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, doi TEXT, title TEXT NOT NULL, authors_json TEXT,
  year INTEGER, venue TEXT, venue_type TEXT, url TEXT, abstract TEXT,
  provider TEXT, oa_url TEXT, created_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_doi ON sources(doi) WHERE doi IS NOT NULL;
CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL, source_id TEXT NOT NULL,
  relevance REAL, metric TEXT, stance TEXT,
  PRIMARY KEY (claim_id, source_id)
);
CREATE TABLE IF NOT EXISTS citations (
  source_id TEXT NOT NULL, style TEXT NOT NULL, formatted TEXT, in_text TEXT,
  PRIMARY KEY (source_id, style)
);
CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, note TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS document_structure (
  document_id TEXT PRIMARY KEY, text_hash TEXT, structure_json TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS request_cache (
  key TEXT PRIMARY KEY, kind TEXT, value_json TEXT, created_at INTEGER, version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tracer_conversations (
  id TEXT PRIMARY KEY, document_id TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS tracer_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT, content TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
`;

// Versioned migrations. Push new entries; never rewrite old ones.
const MIGRATIONS = [
  // v1 — baseline lives in SCHEMA; this slot exists so user_version starts at 1.
  () => {},
];

export function migrate() {
  db.exec(SCHEMA);
  const current = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      MIGRATIONS[v]();
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
migrate();

export const now = () => Date.now();
export const uuid = () => randomUUID();
export const hashKey = (s) => createHash("sha256").update(s).digest("hex").slice(0, 40);

// ── request cache: every model result, keyed on a hash of normalized input.
// An EMPTY answer and a FAILED answer must never be conflated by callers:
// failures are simply not cached. Version the key when the answering set changes.
export function cacheGet(kind, key, { maxAgeMs = null, version = 1 } = {}) {
  const row = db.prepare("SELECT value_json, created_at, version FROM request_cache WHERE key = ?").get(`${kind}:${version}:${key}`);
  if (!row) return null;
  if (maxAgeMs != null && Date.now() - row.created_at > maxAgeMs) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}
export function cacheSet(kind, key, value, { version = 1 } = {}) {
  db.prepare(
    "INSERT INTO request_cache (key, kind, value_json, created_at, version) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, created_at = excluded.created_at"
  ).run(`${kind}:${version}:${key}`, kind, JSON.stringify(value), Date.now(), version);
}

// ── sources: deduped by DOI, falling back to normalized title+year.
// NOTE (spec trap): rows are returned untouched when a DOI already matches, so
// a re-search never re-classifies anything — derived-column fixes need a
// migration that re-derives stored rows.
export function upsertSource(s) {
  if (s.doi) {
    const existing = db.prepare("SELECT * FROM sources WHERE doi = ?").get(s.doi);
    if (existing) return existing;
  }
  const normTitle = (s.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const byTitle = db.prepare("SELECT * FROM sources WHERE lower(title) = ? AND year IS ?").get(normTitle, s.year ?? null);
  if (byTitle) return byTitle;
  const id = uuid();
  db.prepare(
    "INSERT INTO sources (id, doi, title, authors_json, year, venue, venue_type, url, abstract, provider, oa_url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(id, s.doi ?? null, s.title ?? "", JSON.stringify(s.authors ?? []), s.year ?? null, s.venue ?? null,
        s.venueType ?? null, s.url ?? null, s.abstract ?? null, s.provider ?? null, s.oaUrl ?? null, Date.now());
  return db.prepare("SELECT * FROM sources WHERE id = ?").get(id);
}

export function settingsGet() {
  const out = {};
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  return out;
}
export function settingsSet(patch) {
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  db.exec("BEGIN");
  try {
    for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return settingsGet();
}
