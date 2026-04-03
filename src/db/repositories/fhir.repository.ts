import { eq, desc, and } from 'drizzle-orm';
import { getDatabase, indexFhirResourceFts, removeFhirResourceFts } from '../client';
import { fhirResources, NewFhirResource, FhirResource } from '../schema';
import { uuid } from '~/utils/uuid';

// ─── Deduplication fingerprint ────────────────────────────────────────────────
// Two FHIR resources are duplicates if they share the same type and semantic
// content key. We extract the most stable identifying fields (code, date, value)
// and hash them — ignoring the LLM-generated UUID which changes every run.

function fingerprintResource(resourceType: string, resourceJson: string): string {
  try {
    const r = JSON.parse(resourceJson);

    // Pull the stable identity fields for each resource type
    const parts: (string | number | undefined)[] = [resourceType];

    // Code is common across almost all types
    const code = r.code?.text ?? r.code?.coding?.[0]?.code ?? r.code?.coding?.[0]?.display;
    parts.push(code);

    switch (resourceType) {
      case 'Condition':
        parts.push(r.onsetDateTime ?? r.recordedDate ?? r.effectiveDateTime);
        parts.push(r.clinicalStatus?.coding?.[0]?.code);
        break;
      case 'Observation':
        parts.push(r.effectiveDateTime ?? r.effectivePeriod?.start);
        parts.push(r.valueQuantity?.value, r.valueQuantity?.unit, r.valueString);
        break;
      case 'MedicationStatement':
      case 'MedicationRequest':
        parts.push(r.medicationCodeableConcept?.text ?? r.medicationCodeableConcept?.coding?.[0]?.code);
        parts.push(r.dosage?.[0]?.text ?? r.dosageInstruction?.[0]?.text);
        break;
      case 'AllergyIntolerance':
        parts.push(r.recordedDate ?? r.onsetDateTime);
        parts.push(r.reaction?.[0]?.manifestation?.[0]?.text);
        break;
      case 'Immunization':
        parts.push(r.vaccineCode?.text ?? r.vaccineCode?.coding?.[0]?.code);
        parts.push(r.occurrenceDateTime);
        break;
      case 'Procedure':
        parts.push(r.performedDateTime ?? r.performedPeriod?.start);
        break;
      case 'DiagnosticReport':
        parts.push(r.effectiveDateTime ?? r.effectivePeriod?.start);
        parts.push(r.conclusion);
        break;
    }

    const key = parts.filter(Boolean).join('|').toLowerCase().replace(/\s+/g, ' ').trim();

    // Simple djb2 hash — fast, no crypto needed, collision-resistant enough for dedup
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return `${resourceType}:${hash.toString(16)}`;
  } catch {
    return `${resourceType}:${uuid()}`;
  }
}

// ─── Human-readable text extractor for FTS indexing ──────────────────────────
// Pulls the most useful text fields out of a FHIR JSON resource so the FTS
// index has something meaningful to search.

function extractTextContent(resourceJson: string, resourceType: string): string {
  try {
    const r = JSON.parse(resourceJson);
    const parts: string[] = [];

    const push = (...vals: (string | undefined | null)[]) => {
      for (const v of vals) {
        if (v && typeof v === 'string' && v.trim()) parts.push(v.trim());
      }
    };

    push(resourceType);

    switch (resourceType) {
      case 'Condition':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.note?.[0]?.text, r.clinicalStatus?.coding?.[0]?.code);
        break;
      case 'Observation':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.valueString, r.valueQuantity?.unit, r.note?.[0]?.text);
        break;
      case 'MedicationStatement':
      case 'MedicationRequest':
        push(r.medicationCodeableConcept?.text, r.medicationCodeableConcept?.coding?.[0]?.display, r.note?.[0]?.text);
        break;
      case 'AllergyIntolerance':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.note?.[0]?.text, r.reaction?.[0]?.description);
        break;
      case 'Immunization':
        push(r.vaccineCode?.text, r.vaccineCode?.coding?.[0]?.display, r.note?.[0]?.text);
        break;
      case 'Procedure':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.note?.[0]?.text);
        break;
      case 'DiagnosticReport':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.conclusion, r.presentedForm?.[0]?.title);
        break;
      default:
        push(r.code?.text, r.text?.div?.replace(/<[^>]+>/g, ' '));
    }

    return parts.join(' ');
  } catch {
    return resourceType;
  }
}

// ─── Repository ───────────────────────────────────────────────────────────────

export async function upsertFhirResource(
  data: Omit<NewFhirResource, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<FhirResource> {
  const db = getDatabase();
  const now = Date.now();

  const contentHash = fingerprintResource(data.resourceType, data.resourceJson);

  // Deduplicate: if an identical resource already exists (same content hash),
  // return it immediately without inserting a new row.
  const existing = await db.query.fhirResources.findFirst({
    where: and(
      eq(fhirResources.contentHash, contentHash),
      eq(fhirResources.isDeleted, 0),
    ),
  });
  if (existing) return existing;

  const id = data.id ?? uuid();
  const row: NewFhirResource = {
    ...data,
    id,
    contentHash,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(fhirResources)
    .values(row)
    .onConflictDoUpdate({
      target: fhirResources.id,
      set: { resourceJson: row.resourceJson, updatedAt: now, isDeleted: 0 },
    });

  // Keep FTS index in sync
  const textContent = extractTextContent(row.resourceJson, row.resourceType);
  await indexFhirResourceFts(id, row.resourceType, textContent);

  const saved = await db.query.fhirResources.findFirst({ where: eq(fhirResources.id, id) });
  if (!saved) throw new Error(`Failed to retrieve FHIR resource after upsert: ${id}`);
  return saved;
}

export async function getFhirResourceById(id: string): Promise<FhirResource | undefined> {
  const db = getDatabase();
  return db.query.fhirResources.findFirst({
    where: and(eq(fhirResources.id, id), eq(fhirResources.isDeleted, 0)),
  });
}

export async function getFhirResourcesByType(
  resourceType: string,
  limit = 50
): Promise<FhirResource[]> {
  const db = getDatabase();
  return db.query.fhirResources.findMany({
    where: and(
      eq(fhirResources.resourceType, resourceType),
      eq(fhirResources.isDeleted, 0)
    ),
    orderBy: [desc(fhirResources.effectiveDate), desc(fhirResources.createdAt)],
    limit,
  });
}

export async function getAllFhirResources(limit = 200): Promise<FhirResource[]> {
  const db = getDatabase();
  return db.query.fhirResources.findMany({
    where: eq(fhirResources.isDeleted, 0),
    orderBy: [desc(fhirResources.createdAt)],
    limit,
  });
}

export async function softDeleteFhirResource(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .update(fhirResources)
    .set({ isDeleted: 1, updatedAt: Date.now() })
    .where(eq(fhirResources.id, id));
  await removeFhirResourceFts(id);
}
