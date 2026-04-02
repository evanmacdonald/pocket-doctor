import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '~/db/client';
import { documents } from '~/db/schema';
import { upsertFhirResource } from '~/db/repositories/fhir.repository';
import { logEvent } from '~/db/repositories/audit.repository';
import { getSetting } from '~/db/repositories/settings.repository';
import { normalizeTextToFhir } from './normalizers/fhir.normalizer';
import { embedFhirResource } from '~/rag/rag.service';
import { ingestionQueue } from './queue';
import { uuid } from '~/utils/uuid';
import { eq } from 'drizzle-orm';

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
 * Queue a document for ingestion.
 * Returns the document ID immediately; processing happens async.
 */
export async function ingestDocument(params: IngestDocumentParams): Promise<string> {
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
      // PDF/camera: normalize via LLM
      const bundle = await normalizeTextToFhir(rawText);
      fhirEntries = bundle.entry ?? [];
    }

    // ── Step 3: Store FHIR resources ──────────────────────────────────────
    const searchMode = await getSetting('search_mode');

    for (const entry of fhirEntries) {
      const resource = entry.resource;
      if (!resource?.resourceType) continue;

      const effectiveDate = _extractEffectiveDate(resource);
      const fhirRecord = await upsertFhirResource({
        resourceType:     resource.resourceType,
        resourceJson:     JSON.stringify(resource),
        sourceDocumentId: docId,
        effectiveDate,
      });

      // ── Step 4: Generate embeddings if RAG mode is on ─────────────────
      if (searchMode === 'rag') {
        const chunkText = JSON.stringify(resource).slice(0, 2000);
        await embedFhirResource(fhirRecord.id, chunkText).catch(() => {
          // Embedding failure is non-fatal — FTS still works
        });
      }
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
  // For PDF: attempt to read as text (digital PDFs only)
  // Scanned/image PDFs will return base64 content — detect and return empty string
  // The UI layer is responsible for passing rawText from ML Kit OCR for image files.
  if (mimeType === 'application/pdf') {
    try {
      const content = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      // Crude check: if >80% of content is ASCII printable, treat as text PDF
      const printable = content.replace(/[^\x20-\x7E\n\r\t]/g, '').length;
      if (printable / content.length > 0.8) {
        return content.slice(0, 50000);
      }
    } catch {
      // Binary PDF — falls through to return empty
    }
    return ''; // Triggers ML Kit OCR fallback in the UI layer
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
