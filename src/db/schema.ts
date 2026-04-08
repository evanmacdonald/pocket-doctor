import {
  integer,
  sqliteTable,
  text,
  index,
} from 'drizzle-orm/sqlite-core';

// ─── FHIR Resources ──────────────────────────────────────────────────────────
// All health data normalized to FHIR R4, stored as JSON text

export const fhirResources = sqliteTable(
  'fhir_resources',
  {
    id:               text('id').primaryKey(),            // local UUID
    resourceId:       text('resource_id'),               // FHIR .id field
    resourceType:     text('resource_type').notNull(),   // 'Condition', 'Observation', etc.
    resourceJson:     text('resource_json').notNull(),   // full FHIR R4 JSON
    sourceDocumentId: text('source_document_id'),        // FK → documents.id
    portalId:         text('portal_id'),                 // FK → portalConnections.id
    effectiveDate:    text('effective_date'),             // denormalized ISO date
    contentHash:      text('content_hash'),              // dedup fingerprint (resourceType:hash)
    createdAt:        integer('created_at').notNull(),
    updatedAt:        integer('updated_at').notNull(),
    isDeleted:        integer('is_deleted').notNull().default(0),
  },
  (t) => [
    index('idx_fhir_type').on(t.resourceType),
    index('idx_fhir_source').on(t.sourceDocumentId),
    index('idx_fhir_date').on(t.effectiveDate),
  ]
);

// ─── Documents ───────────────────────────────────────────────────────────────
// Raw source files (PDFs, scans) and their ingestion state

export const documents = sqliteTable(
  'documents',
  {
    id:               text('id').primaryKey(),
    filename:         text('filename').notNull(),
    sourceType:       text('source_type').notNull(), // 'pdf_upload' | 'camera_scan' | 'portal'
    mimeType:         text('mime_type').notNull(),
    filePath:         text('file_path'),             // path in documentDirectory (null for portal)
    rawText:          text('raw_text'),
    ingestionStatus:  text('ingestion_status').notNull().default('pending'),
                      // 'pending' | 'processing' | 'done' | 'failed'
    ingestionError:   text('ingestion_error'),
    sha256Hash:       text('sha256_hash'),           // for deduplication
    createdAt:        integer('created_at').notNull(),
    processedAt:      integer('processed_at'),
  },
  (t) => [
    index('idx_doc_status').on(t.ingestionStatus),
    index('idx_doc_hash').on(t.sha256Hash),
  ]
);

// ─── Chat ────────────────────────────────────────────────────────────────────

export const chatSessions = sqliteTable('chat_sessions', {
  id:         text('id').primaryKey(),
  title:      text('title'),
  provider:   text('provider').notNull(), // 'openai' | 'anthropic' | 'gemini'
  model:      text('model').notNull(),
  searchMode: text('search_mode'), // retained for schema compatibility — no longer used
  createdAt:  integer('created_at').notNull(),
  updatedAt:  integer('updated_at').notNull(),
});

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id:             text('id').primaryKey(),
    sessionId:      text('session_id').notNull().references(() => chatSessions.id),
    role:           text('role').notNull(), // 'user' | 'assistant' | 'system'
    content:        text('content').notNull(),
    contextFhirIds: text('context_fhir_ids'), // JSON array of FHIR resource IDs used
    tokenCount:     integer('token_count'),
    createdAt:      integer('created_at').notNull(),
  },
  (t) => [
    index('idx_chat_msg_session').on(t.sessionId, t.createdAt),
  ]
);

// ─── Portal Connections ───────────────────────────────────────────────────────
// OAuth state per portal. Tokens are AES-encrypted before storage.

export const portalConnections = sqliteTable('portal_connections', {
  id:             text('id').primaryKey(),
  portalId:       text('portal_id').notNull().unique(),
  displayName:    text('display_name').notNull(),
  accessToken:    text('access_token'),   // AES-256-GCM encrypted
  refreshToken:   text('refresh_token'),  // AES-256-GCM encrypted
  tokenExpiresAt: integer('token_expires_at'),
  lastSyncedAt:   integer('last_synced_at'),
  status:         text('status').notNull().default('disconnected'),
  // 'disconnected' | 'connected' | 'error'
});

// ─── Audit Log ───────────────────────────────────────────────────────────────
// Append-only event trail (never updated or deleted)

export const auditLog = sqliteTable(
  'audit_log',
  {
    id:           integer('id').primaryKey({ autoIncrement: true }),
    eventType:    text('event_type').notNull(),
    // 'record_viewed' | 'record_created' | 'chat_query' |
    // 'export_created' | 'portal_sync' | 'api_key_set' | 'app_unlocked'
    resourceType: text('resource_type'),
    resourceId:   text('resource_id'),
    metadataJson: text('metadata_json'), // arbitrary JSON detail
    createdAt:    integer('created_at').notNull(),
  },
  (t) => [
    index('idx_audit_time').on(t.createdAt),
  ]
);

// ─── App Settings ─────────────────────────────────────────────────────────────
// Key/value store for user preferences (all values JSON-encoded)
// Keys: 'active_provider', 'active_model', 'has_completed_onboarding',
//       'auto_lock_seconds', 'custom_base_url', 'has_migrated_api_key'

export const appSettings = sqliteTable('app_settings', {
  key:   text('key').primaryKey(),
  value: text('value').notNull(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type FhirResource       = typeof fhirResources.$inferSelect;
export type NewFhirResource    = typeof fhirResources.$inferInsert;
export type Document           = typeof documents.$inferSelect;
export type NewDocument        = typeof documents.$inferInsert;
export type ChatSession        = typeof chatSessions.$inferSelect;
export type NewChatSession     = typeof chatSessions.$inferInsert;
export type ChatMessage        = typeof chatMessages.$inferSelect;
export type NewChatMessage     = typeof chatMessages.$inferInsert;
export type PortalConnection   = typeof portalConnections.$inferSelect;
export type AuditLogEntry      = typeof auditLog.$inferSelect;
export type AppSetting         = typeof appSettings.$inferSelect;
