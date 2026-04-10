import { eq } from 'drizzle-orm';
import { getDatabase } from '../client';
import { appSettings } from '../schema';

// ─── Typed setting keys ───────────────────────────────────────────────────────

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface AppSettingsMap {
  active_provider:           ProviderName | null;
  active_model:              string | null;
  ingestion_provider:        ProviderName | null;
  ingestion_model:           string | null;
  has_completed_onboarding:  boolean;
  auto_lock_seconds:         number;
  custom_base_url:           string;
  has_migrated_api_key:      boolean;
  last_active_tab:           string | null;
}

const DEFAULTS: AppSettingsMap = {
  active_provider:          null,
  active_model:             null,
  ingestion_provider:       null,
  ingestion_model:          null,
  has_completed_onboarding: false,
  auto_lock_seconds:        300,
  custom_base_url:          '',
  has_migrated_api_key:     false,
  last_active_tab:          null,
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
