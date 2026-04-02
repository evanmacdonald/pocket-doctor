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

  // Create FTS5 virtual table for keyword search
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

  // Create sqlite-vec virtual table for RAG embeddings
  // NOTE: sqlite-vec (vec0) must be loaded as an extension.
  // In a development build, this is configured via the expo-sqlite plugin in app.json.
  // For now we create the metadata table; the vec0 table is created after extension load.
  await _sqlite.execAsync(`
    CREATE TABLE IF NOT EXISTS embedding_metadata (
      rowid      INTEGER PRIMARY KEY,
      fhir_id    TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      chunk_text  TEXT NOT NULL,
      model       TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
  `);

  _db = drizzle(_sqlite, { schema, logger: false });
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
