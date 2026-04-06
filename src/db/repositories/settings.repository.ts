import { eq } from 'drizzle-orm';
import { getDatabase } from '../client';
import { appSettings } from '../schema';

// ─── Typed setting keys ───────────────────────────────────────────────────────

export type SearchMode = 'fts' | 'rag';
export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface AppSettingsMap {
  search_mode:               SearchMode;
  active_provider:           ProviderName;
  active_model:              string;
  embedding_model:           string;
  embedding_dimensions:      number;
  has_completed_onboarding:  boolean;
  auto_lock_seconds:         number;
  custom_base_url:           string;    // base URL for custom OpenAI-compatible provider
  has_migrated_api_key:      boolean;   // one-time migration guard from legacy per-provider keys
}

const DEFAULTS: AppSettingsMap = {
  search_mode:              'fts',
  active_provider:          'openai',
  active_model:             'gpt-4o-mini',
  embedding_model:          'text-embedding-3-small',
  embedding_dimensions:     1536,
  has_completed_onboarding: false,
  auto_lock_seconds:        300, // 5 minutes
  custom_base_url:          '',
  has_migrated_api_key:     false,
};

export async function getSetting<K extends keyof AppSettingsMap>(
  key: K
): Promise<AppSettingsMap[K]> {
  const db = getDatabase();
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, key),
  });
  if (!row) return DEFAULTS[key];
  return JSON.parse(row.value) as AppSettingsMap[K];
}

export async function setSetting<K extends keyof AppSettingsMap>(
  key: K,
  value: AppSettingsMap[K]
): Promise<void> {
  const db = getDatabase();
  await db
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(value) } });
}

export async function getAllSettings(): Promise<Partial<AppSettingsMap>> {
  const db = getDatabase();
  const rows = await db.query.appSettings.findMany();
  const result: Partial<AppSettingsMap> = {};
  for (const row of rows) {
    const key = row.key as keyof AppSettingsMap;
    (result as Record<string, unknown>)[key] = JSON.parse(row.value);
  }
  return result;
}
