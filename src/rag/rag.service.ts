import { getSQLite } from '~/db/client';
import { providerRegistry } from '~/llm/provider-registry';
import { getSetting } from '~/db/repositories/settings.repository';
import type { LLMProviderName } from '~/llm/types';
import { EMBEDDING_DIMENSIONS } from '~/llm/types';

export interface RagResult {
  fhirId:    string;
  chunkText: string;
  distance:  number;
}

/**
 * Perform an ANN (approximate nearest neighbour) search using sqlite-vec.
 * Returns the top-k most semantically similar FHIR record chunks.
 *
 * NOTE: sqlite-vec (vec0) must be loaded as an extension.
 * This requires a development build — it does NOT work in Expo Go.
 */
export async function ragSearch(query: string, limit = 10): Promise<RagResult[]> {
  if (!query.trim()) return [];

  const sqlite = getSQLite();
  const providerName  = await getSetting('active_provider') as LLMProviderName;
  const embeddingModel = await getSetting('embedding_model');
  const provider = await providerRegistry.getProvider(providerName);

  if (!provider) {
    throw new Error(`No API key configured for ${providerName}. Add one in Settings.`);
  }

  // Generate query embedding
  const { vectors } = await provider.embed({ input: query, model: embeddingModel });
  const queryVector = vectors[0];

  if (!queryVector) throw new Error('Failed to generate query embedding');

  // Serialize to Float32 binary blob for sqlite-vec
  const blob = float32ArrayToBuffer(queryVector);

  const rows = await sqlite.getAllAsync<{
    fhir_id:    string;
    chunk_text: string;
    distance:   number;
  }>(
    `SELECT
       em.fhir_id,
       em.chunk_text,
       vec_distance_cosine(e.embedding, ?) as distance
     FROM embeddings e
     JOIN embedding_metadata em ON em.rowid = e.rowid
     JOIN fhir_resources fr ON fr.id = em.fhir_id
     WHERE fr.is_deleted = 0
     ORDER BY distance ASC
     LIMIT ?`,
    [blob, limit]
  );

  return rows.map((r) => ({
    fhirId:    r.fhir_id,
    chunkText: r.chunk_text,
    distance:  r.distance,
  }));
}

/**
 * Embed a single FHIR resource and store the vector in the embeddings table.
 * Safe to call multiple times — uses REPLACE to upsert by rowid.
 */
export async function embedFhirResource(
  fhirId: string,
  chunkText: string,
  existingRowid?: number
): Promise<void> {
  const sqlite = getSQLite();
  const providerName   = await getSetting('active_provider') as LLMProviderName;
  const embeddingModel = await getSetting('embedding_model');
  const provider = await providerRegistry.getProvider(providerName);

  if (!provider) return; // No key configured — skip silently

  const { vectors } = await provider.embed({ input: chunkText, model: embeddingModel });
  const vector = vectors[0];
  if (!vector) return;

  const blob = float32ArrayToBuffer(vector);
  const now  = Date.now();

  if (existingRowid) {
    // Update existing vector
    await sqlite.runAsync(
      `INSERT OR REPLACE INTO embeddings(rowid, embedding) VALUES (?, ?)`,
      [existingRowid, blob]
    );
  } else {
    // Insert new vector + metadata
    const result = await sqlite.runAsync(
      `INSERT INTO embeddings(embedding) VALUES (?)`,
      [blob]
    );
    await sqlite.runAsync(
      `INSERT INTO embedding_metadata(rowid, fhir_id, chunk_text, model, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [result.lastInsertRowId, fhirId, chunkText, embeddingModel, now]
    );
  }
}

/**
 * Check how many FHIR resources have embeddings vs. total.
 */
export async function getEmbeddingCoverage(): Promise<{ indexed: number; total: number }> {
  const sqlite = getSQLite();
  const totalRows = await sqlite.getAllAsync<{ total: number }>(
    `SELECT COUNT(*) as total FROM fhir_resources WHERE is_deleted = 0`
  );
  const indexedRows = await sqlite.getAllAsync<{ indexed: number }>(
    `SELECT COUNT(*) as indexed FROM embedding_metadata`
  );
  return {
    total:   totalRows[0]?.total   ?? 0,
    indexed: indexedRows[0]?.indexed ?? 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function float32ArrayToBuffer(vector: number[]): Uint8Array {
  const buf = new ArrayBuffer(vector.length * 4);
  const view = new Float32Array(buf);
  for (let i = 0; i < vector.length; i++) {
    view[i] = vector[i];
  }
  return new Uint8Array(buf);
}
