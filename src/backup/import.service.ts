import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase, getSQLite, indexFhirResourceFts } from '~/db/client';
import {
  fhirResources, documents, chatSessions, chatMessages, appSettings,
} from '~/db/schema';
import { logEvent } from '~/db/repositories/audit.repository';
import { decrypt } from './crypto.service';
import type { ExportBundle } from './export.service';
import { z } from 'zod';

const ExportBundleSchema = z.object({
  version:    z.string(),
  exportedAt: z.string(),
  payload:    z.object({
    fhirResources: z.array(z.record(z.string(), z.unknown())),
    documents:     z.array(z.record(z.string(), z.unknown())),
    chatSessions:  z.array(z.record(z.string(), z.unknown())),
    chatMessages:  z.array(z.record(z.string(), z.unknown())),
    appSettings:   z.array(z.record(z.string(), z.unknown())),
    auditLog:      z.array(z.record(z.string(), z.unknown())).optional(),
  }),
});

/**
 * Let the user pick a .pdexport file, decrypt it, and restore all data.
 * Returns the number of FHIR resources restored, or null if cancelled.
 */
export async function importHealthData(
  passphrase: string,
  mode: 'replace' | 'merge' = 'replace'
): Promise<{ fhirCount: number } | null> {
  // ── Pick file ─────────────────────────────────────────────────────────────
  const result = await DocumentPicker.getDocumentAsync({
    type:      '*/*',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  const fileUri = result.assets[0].uri;

  // ── Read + decrypt ────────────────────────────────────────────────────────
  const encryptedJson = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  let plaintext: string;
  try {
    const encBundle = JSON.parse(encryptedJson);
    plaintext = decrypt(encBundle, passphrase);
  } catch {
    throw new Error('Wrong passphrase or corrupted file.');
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  let bundle: ExportBundle;
  try {
    const parsed = JSON.parse(plaintext);
    const validated = ExportBundleSchema.parse(parsed);
    bundle = validated as ExportBundle;
  } catch {
    throw new Error('Invalid export file format.');
  }

  // ── Restore ───────────────────────────────────────────────────────────────
  const db = getDatabase();

  if (mode === 'replace') {
    // Clear existing data (except audit log) via raw SQL
    const sqlite = getSQLite();
    await sqlite.execAsync('DELETE FROM chat_messages; DELETE FROM chat_sessions; DELETE FROM fhir_resources; DELETE FROM fhir_resources_fts; DELETE FROM documents; DELETE FROM app_settings;');
  }

  // Insert all rows — ignore conflicts in merge mode
  const { payload } = bundle;

  for (const row of payload.fhirResources) {
    try {
      await db.insert(fhirResources).values(row as typeof fhirResources.$inferInsert)
        .onConflictDoNothing();
      // Re-index FTS
      const r = row as { id: string; resource_type: string; resource_json: string };
      if (r.id && r.resource_type) {
        await indexFhirResourceFts(r.id, r.resource_type, r.resource_json ?? '');
      }
    } catch { /* skip invalid rows */ }
  }

  for (const row of payload.documents) {
    try {
      await db.insert(documents).values(row as typeof documents.$inferInsert)
        .onConflictDoNothing();
    } catch { /* skip */ }
  }

  for (const row of payload.chatSessions) {
    try {
      await db.insert(chatSessions).values(row as typeof chatSessions.$inferInsert)
        .onConflictDoNothing();
    } catch { /* skip */ }
  }

  for (const row of payload.chatMessages) {
    try {
      await db.insert(chatMessages).values(row as typeof chatMessages.$inferInsert)
        .onConflictDoNothing();
    } catch { /* skip */ }
  }

  for (const row of payload.appSettings) {
    try {
      const s = row as { key: string; value: string };
      await db.insert(appSettings).values(s).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: s.value },
      });
    } catch { /* skip */ }
  }

  // ── Clean up ──────────────────────────────────────────────────────────────
  await FileSystem.deleteAsync(fileUri, { idempotent: true });

  await logEvent({
    eventType: 'import_completed',
    metadata:  { fhirCount: payload.fhirResources.length, mode },
  });

  return { fhirCount: payload.fhirResources.length };
}
