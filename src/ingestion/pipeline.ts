import * as FileSystem from 'expo-file-system/legacy';

/** Resolve a stored file path (may be relative) to an absolute URI. */
function resolvePath(filePath: string): string {
  if (filePath.startsWith('file://') || filePath.startsWith('/')) return filePath;
  return `${FileSystem.documentDirectory ?? ''}${filePath}`;
}
import { getDatabase } from '~/db/client';
import { documents } from '~/db/schema';
import { upsertFhirResource } from '~/db/repositories/fhir.repository';
import { logEvent } from '~/db/repositories/audit.repository';
import { normalizeTextToFhir, normalizePdfToFhir } from './normalizers/fhir.normalizer';
import { ingestionQueue } from './queue';
import { uuid } from '~/utils/uuid';
import { eq } from 'drizzle-orm';
import { fhirResources } from '~/db/schema';

export type IngestionSource = 'pdf_upload' | 'camera_scan' | 'portal';

export interface IngestDocumentParams {
  filename:    string;
  sourceType:  IngestionSource;
  mimeType:    string;
  filePath?:   string;   // local URI (pdf_upload, camera_scan)
  rawText?:    string;   // pre-extracted text (camera_scan after OCR)
  fhirJson?:   string;   // pre-parsed FHIR JSON (portal source)
}

/**
 * Store a document record without processing it.
 * Returns the document ID. Call processDocument(id) to trigger LLM extraction.
 */
export async function storeDocument(params: IngestDocumentParams): Promise<string> {
  const db = getDatabase();
  const id  = uuid();
  const now = Date.now();

  await db.insert(documents).values({
    id,
    filename:        params.filename,
    sourceType:      params.sourceType,
    mimeType:        params.mimeType,
    filePath:        params.filePath,
    rawText:         params.rawText,
    ingestionStatus: 'pending',
    createdAt:       now,
  });

  return id;
}

/**
 * Queue an existing document for LLM processing.
 */
export async function processDocument(docId: string): Promise<void> {
  const db = getDatabase();
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, docId),
  });
  if (!doc) throw new Error(`Document ${docId} not found`);

  ingestionQueue.enqueue(() => _processDocument(docId, {
    filename:   doc.filename,
    sourceType: doc.sourceType as IngestionSource,
    mimeType:   doc.mimeType,
    filePath:   doc.filePath ? resolvePath(doc.filePath) : undefined,
    rawText:    doc.rawText ?? undefined,
  }));
}

/**
 * Delete a document and all its associated FHIR resources.
 */
export async function deleteDocument(docId: string): Promise<void> {
  const db = getDatabase();
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, docId) });

  // Delete the physical file if it exists
  if (doc?.filePath) {
    try { await FileSystem.deleteAsync(resolvePath(doc.filePath), { idempotent: true }); } catch { /* ignore */ }
  }

  // Soft-delete associated FHIR resources
  await db
    .update(fhirResources)
    .set({ isDeleted: 1, updatedAt: Date.now() })
    .where(eq(fhirResources.sourceDocumentId, docId));

  // Delete the document row
  await db.delete(documents).where(eq(documents.id, docId));
}

/**
 * Queue a document for ingestion.
 * Returns the document ID immediately; processing happens async.
 */
export async function ingestDocument(params: IngestDocumentParams): Promise<string> {
  const id = await storeDocument(params);
  ingestionQueue.enqueue(() => _processDocument(id, params));
  return id;
}

// ─── Internal processing ──────────────────────────────────────────────────────

async function _processDocument(
  docId: string,
  params: IngestDocumentParams
): Promise<void> {
  const db = getDatabase();

  try {
    await _setStatus(docId, 'processing');

    let rawText = params.rawText ?? '';

    // ── Step 1: Extract text if not already provided ──────────────────────
    if (!rawText && params.filePath) {
      rawText = await _extractText(params.filePath, params.mimeType);
      await db
        .update(documents)
        .set({ rawText })
        .where(eq(documents.id, docId));
    }

    // ── Step 2: Parse FHIR ────────────────────────────────────────────────
    let fhirEntries: Array<{ resource: { resourceType: string } & Record<string, unknown> }> = [];

    if (params.fhirJson) {
      // Portal-sourced: already native FHIR JSON
      const bundle = JSON.parse(params.fhirJson);
      fhirEntries = bundle.entry ?? [];
    } else if (rawText.trim().length > 20) {
      // Text was extracted — normalize via LLM
      const bundle = await normalizeTextToFhir(rawText);
      fhirEntries = bundle.entry ?? [];
    } else if (params.filePath && params.mimeType === 'application/pdf') {
      // Compressed PDF — send bytes directly to the LLM (Gemini supports inline PDFs)
      const bundle = await normalizePdfToFhir(params.filePath);
      fhirEntries = bundle.entry ?? [];
    } else {
      throw new Error(
        'No readable text found in this document. Try a PDF exported from Word, Pages, or a patient portal.'
      );
    }

    if (fhirEntries.length === 0) {
      throw new Error(
        'The document was processed but no medical records could be extracted. ' +
        'Try a document that contains diagnoses, medications, lab results, or immunizations.'
      );
    }

    // ── Step 3: Store FHIR resources ──────────────────────────────────────
    for (const entry of fhirEntries) {
      const resource = entry.resource;
      if (!resource?.resourceType) continue;

      const effectiveDate = _extractEffectiveDate(resource);
      await upsertFhirResource({
        resourceType:     resource.resourceType,
        resourceJson:     JSON.stringify(resource),
        sourceDocumentId: docId,
        effectiveDate,
      });
    }

    await _setStatus(docId, 'done');

    await logEvent({
      eventType: 'record_created',
      metadata:  { docId, fhirCount: fhirEntries.length, sourceType: params.sourceType },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({ ingestionStatus: 'failed', ingestionError: message })
      .where(eq(documents.id, docId));
    console.error(`[Ingestion] Failed for doc ${docId}:`, message);
  }
}

async function _extractText(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    try {
      // Read as base64 then decode to binary string.
      // UTF-8 decoding corrupts binary PDF content — base64 preserves it.
      const base64 = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(base64);

      // PDF text is stored as literal strings in content streams, followed by
      // text-show operators: Tj (single string), TJ (array), ' or "
      // Pattern: (text content) Tj
      const texts: string[] = [];
      const re = /\(([^)\\]{0,500}(?:\\.[^)\\]{0,500})*)\)\s*(?:Tj|TJ|'|")/g;
      let m: RegExpExecArray | null;

      while ((m = re.exec(binary)) !== null) {
        const chunk = m[1]
          .replace(/\\n/g, ' ')
          .replace(/\\r/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E]/g, ''); // keep printable ASCII only
        if (chunk.trim().length > 0) texts.push(chunk.trim());
      }

      const result = texts.join(' ').replace(/\s+/g, ' ').trim();
      if (result.length > 50) return result.slice(0, 50000);
    } catch {
      // Unreadable — fall through
    }
    return '';
  }
  return '';
}

async function _setStatus(docId: string, status: string) {
  const db = getDatabase();
  const now = Date.now();
  await db
    .update(documents)
    .set({
      ingestionStatus: status,
      ...(status === 'done' ? { processedAt: now } : {}),
    })
    .where(eq(documents.id, docId));
}

function _extractEffectiveDate(resource: Record<string, unknown>): string | null {
  const candidates = [
    resource.effectiveDateTime,
    resource.recordedDate,
    resource.onsetDateTime,
    resource.performedDateTime,
    resource.occurrenceDateTime,
    (resource.effectivePeriod as Record<string, unknown> | undefined)?.start,
    resource.date,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c.slice(0, 10);
  }
  return null;
}
