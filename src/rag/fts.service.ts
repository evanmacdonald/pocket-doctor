import { getSQLite } from '~/db/client';

export interface FtsResult {
  fhirId:       string;
  resourceType: string;
  snippet:      string;
  rank:         number;
}

/**
 * Keyword search across all FHIR resources using SQLite FTS5.
 * Uses porter stemming and unicode61 tokenizer (configured in client.ts).
 *
 * Query syntax:
 *   - Single word: "diabetes"
 *   - Phrase:      '"blood pressure"'
 *   - Prefix:      "diabet*"
 *   - Column:      "resource_type:Condition"
 */
export async function ftsSearch(
  query: string,
  limit = 15
): Promise<FtsResult[]> {
  if (!query.trim()) return [];

  const sqlite = getSQLite();

  // Sanitize: FTS5 special chars that can break syntax if unescaped
  const safeQuery = query.replace(/["*()]/g, ' ').trim();
  if (!safeQuery) return [];

  const rows = await sqlite.getAllAsync<{
    resource_id:   string;
    resource_type: string;
    snippet:       string;
    rank:          number;
  }>(
    `SELECT
       fts.resource_id,
       fts.resource_type,
       snippet(fhir_resources_fts, 2, '[', ']', '...', 24) as snippet,
       fts.rank
     FROM fhir_resources_fts fts
     JOIN fhir_resources fr ON fr.id = fts.resource_id
     WHERE fhir_resources_fts MATCH ?
       AND fr.is_deleted = 0
     ORDER BY rank
     LIMIT ?`,
    [safeQuery, limit]
  );

  return rows.map((r) => ({
    fhirId:       r.resource_id,
    resourceType: r.resource_type,
    snippet:      r.snippet,
    rank:         r.rank,
  }));
}
