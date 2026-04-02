import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDatabase } from '~/db/client';
import { fhirResources, documents, chatSessions, chatMessages, appSettings, auditLog } from '~/db/schema';
import { logEvent } from '~/db/repositories/audit.repository';
import { encrypt } from './crypto.service';
import { eq } from 'drizzle-orm';

export interface ExportBundle {
  version:    string;
  exportedAt: string;
  payload: {
    fhirResources:  unknown[];
    documents:      unknown[];  // metadata only — not file bytes
    chatSessions:   unknown[];
    chatMessages:   unknown[];
    appSettings:    unknown[];
    auditLog:       unknown[];
  };
}

/**
 * Export all health data to an AES-256-GCM encrypted JSON file,
 * then share it via the iOS share sheet.
 *
 * @param passphrase  User-supplied passphrase for encryption
 */
export async function exportHealthData(passphrase: string): Promise<void> {
  const db = getDatabase();

  // ── Gather all data ───────────────────────────────────────────────────────
  const [
    fhirRows,
    docRows,
    sessionRows,
    messageRows,
    settingRows,
    auditRows,
  ] = await Promise.all([
    db.query.fhirResources.findMany({ where: eq(fhirResources.isDeleted, 0) }),
    db.query.documents.findMany(),
    db.query.chatSessions.findMany(),
    db.query.chatMessages.findMany(),
    db.query.appSettings.findMany(),
    db.query.auditLog.findMany({ limit: 10000 }),
  ]);

  const bundle: ExportBundle = {
    version:    '1.0',
    exportedAt: new Date().toISOString(),
    payload: {
      fhirResources: fhirRows,
      documents:     docRows.map(stripFilePath), // don't export file paths
      chatSessions:  sessionRows,
      chatMessages:  messageRows,
      appSettings:   settingRows,
      auditLog:      auditRows,
    },
  };

  // ── Encrypt ───────────────────────────────────────────────────────────────
  const plaintext = JSON.stringify(bundle);
  const encrypted = encrypt(plaintext, passphrase);
  const outputJson = JSON.stringify(encrypted);

  // ── Write to cache dir (excluded from iCloud device backup) ───────────────
  const dateStr   = new Date().toISOString().slice(0, 10);
  const filename  = `pocket-doctor-export-${dateStr}.pdexport`;
  const filePath  = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(filePath, outputJson, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // ── Share via iOS sheet ───────────────────────────────────────────────────
  await Sharing.shareAsync(filePath, {
    mimeType:    'application/octet-stream',
    dialogTitle: 'Save your Pocket Doctor export',
    UTI:         'public.data',
  });

  // ── Clean up ──────────────────────────────────────────────────────────────
  await FileSystem.deleteAsync(filePath, { idempotent: true });

  await logEvent({
    eventType: 'export_created',
    metadata:  { recordCount: fhirRows.length },
  });
}

function stripFilePath(doc: Record<string, unknown>) {
  const { filePath: _, ...rest } = doc;
  return rest;
}
