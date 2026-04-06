import { eq, desc, and } from 'drizzle-orm';
import { getDatabase, indexFhirResourceFts, removeFhirResourceFts } from '../client';
import { fhirResources, NewFhirResource, FhirResource } from '../schema';
import { uuid } from '~/utils/uuid';
import { fingerprintResource, extractTextContent } from './fhir.utils';

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
