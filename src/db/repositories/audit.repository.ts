import { getDatabase } from '../client';
import { auditLog } from '../schema';

export type AuditEventType =
  | 'record_viewed'
  | 'record_created'
  | 'record_deleted'
  | 'chat_query'
  | 'export_created'
  | 'import_completed'
  | 'portal_sync'
  | 'api_key_set'
  | 'api_key_removed'
  | 'app_unlocked';

export interface LogEventParams {
  eventType:    AuditEventType;
  resourceType?: string;
  resourceId?:   string;
  metadata?:     Record<string, unknown>;
}

export async function logEvent(params: LogEventParams): Promise<void> {
  const db = getDatabase();
  await db.insert(auditLog).values({
    eventType:    params.eventType,
    resourceType: params.resourceType,
    resourceId:   params.resourceId,
    metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    createdAt:    Date.now(),
  });
}

export async function getRecentEvents(limit = 100) {
  const db = getDatabase();
  return db.query.auditLog.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
  });
}
