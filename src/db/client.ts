import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

// ─── Database Singleton ───────────────────────────────────────────────────────

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;
let _db: DrizzleDB | null = null;
let _sqlite: SQLite.SQLiteDatabase | null = null;

export async function openDatabase() {
  if (_db) return _db;

  _sqlite = await SQLite.openDatabaseAsync('pocket-doctor.db', {
    useNewConnection: false,
  });

  // Enable Write-Ahead Logging for better concurrent read performance
  await _sqlite.execAsync('PRAGMA journal_mode = WAL;');
  await _sqlite.execAsync('PRAGMA foreign_keys = ON;');

  // ── Create schema tables (IF NOT EXISTS = safe to run every startup) ─────────

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS fhir_resources (
      id                  TEXT PRIMARY KEY,
      resource_id         TEXT,
      resource_type       TEXT NOT NULL,
      resource_json       TEXT NOT NULL,
      source_document_id  TEXT,
      portal_id           TEXT,
      effective_date      TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      is_deleted          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_fhir_type   ON fhir_resources(resource_type);
    CREATE INDEX IF NOT EXISTS idx_fhir_source ON fhir_resources(source_document_id);
    CREATE INDEX IF NOT EXISTS idx_fhir_date   ON fhir_resources(effective_date);
  `);

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS documents (
      id                TEXT PRIMARY KEY,
      filename          TEXT NOT NULL,
      source_type       TEXT NOT NULL,
      mime_type         TEXT NOT NULL,
      file_path         TEXT,
      raw_text          TEXT,
      ingestion_status  TEXT NOT NULL DEFAULT 'pending',
      ingestion_error   TEXT,
      sha256_hash       TEXT,
      created_at        INTEGER NOT NULL,
      processed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_doc_status ON documents(ingestion_status);
    CREATE INDEX IF NOT EXISTS idx_doc_hash   ON documents(sha256_hash);
  `);

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT,
      provider    TEXT NOT NULL,
      model       TEXT NOT NULL,
      search_mode TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES chat_sessions(id),
      role              TEXT NOT NULL,
      content           TEXT NOT NULL,
      context_fhir_ids  TEXT,
      token_count       INTEGER,
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id, created_at);
  `);

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS portal_connections (
      id               TEXT PRIMARY KEY,
      portal_id        TEXT NOT NULL UNIQUE,
      display_name     TEXT NOT NULL,
      access_token     TEXT,
      refresh_token    TEXT,
      token_expires_at INTEGER,
      last_synced_at   INTEGER,
      status           TEXT NOT NULL DEFAULT 'disconnected'
    );
  `);

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type    TEXT NOT NULL,
      resource_type TEXT,
      resource_id   TEXT,
      metadata_json TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
  `);

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ── FTS5 virtual table (references fhir_resources — must come after it) ──────

  await _sqlite.execAsync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fhir_resources_fts USING fts5(
      resource_id,
      resource_type,
      text_content,
      content='fhir_resources',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `);

  // ── Embedding metadata (companion to sqlite-vec vec0 virtual table) ──────────

  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS embedding_metadata (
      rowid       INTEGER PRIMARY KEY,
      fhir_id     TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      chunk_text  TEXT NOT NULL,
      model       TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
  `);

  _db = drizzle(_sqlite, { schema, logger: false });

  // Reset any documents stuck in pending/processing from a previous crashed session
  await _sqlite.runAsync(
    `UPDATE documents SET ingestion_status = 'failed', ingestion_error = 'App was closed during processing'
     WHERE ingestion_status IN ('pending', 'processing')`
  );

  return _db;
}

export function getDatabase(): DrizzleDB {
  if (!_db) {
    throw new Error('Database not initialized. Call openDatabase() first.');
  }
  return _db;
}

export function getSQLite() {
  if (!_sqlite) {
    throw new Error('SQLite not initialized. Call openDatabase() first.');
  }
  return _sqlite;
}

// ─── FTS Indexing Helpers ─────────────────────────────────────────────────────

/**
 * Index a FHIR resource into the FTS5 table.
 * Call this after inserting a new fhir_resource row.
 */
export async function indexFhirResourceFts(
  resourceId: string,
  resourceType: string,
  textContent: string
) {
  const sqlite = getSQLite();
  await sqlite.runAsync(
    `INSERT OR REPLACE INTO fhir_resources_fts(resource_id, resource_type, text_content)
     VALUES (?, ?, ?)`,
    [resourceId, resourceType, textContent]
  );
}

/**
 * Remove a resource from the FTS5 index.
 */
export async function removeFhirResourceFts(resourceId: string) {
  const sqlite = getSQLite();
  await sqlite.runAsync(
    `DELETE FROM fhir_resources_fts WHERE resource_id = ?`,
    [resourceId]
  );
}
