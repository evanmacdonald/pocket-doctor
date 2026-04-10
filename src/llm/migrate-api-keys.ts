import {
  getSecureItem,
  setSecureItem,
  deleteSecureItem,
  SecureKeys,
} from '~/utils/secure-store';
import {
  getSetting,
  setSetting,
} from '~/db/repositories/settings.repository';
import type { LLMProviderName } from './types';

/**
 * One-time migration from the old per-provider Keychain keys to a single
 * ACTIVE_API_KEY. Runs at app startup; guarded by `has_migrated_api_key` so it
 * never executes twice.
 *
 * Migration strategy: prefer the key matching the stored `active_provider`;
 * fall back to any other provider that has a key. The remaining legacy keys are
 * silently dropped — the new model only supports one active config at a time.
 */
export async function migrateApiKeysIfNeeded(): Promise<void> {
  const alreadyMigrated = await getSetting('has_migrated_api_key');
  if (alreadyMigrated) return;

  const activeProvider = await getSetting('active_provider');

  const legacyKeyMap: Record<string, typeof SecureKeys[keyof typeof SecureKeys]> = {
    openai:    SecureKeys._LEGACY_OPENAI_KEY,
    anthropic: SecureKeys._LEGACY_ANTHROPIC_KEY,
    gemini:    SecureKeys._LEGACY_GEMINI_KEY,
  };

  // Try active provider first (if set), then others
  const allProviders: LLMProviderName[] = ['openai', 'anthropic', 'gemini'];
  const orderedProviders: LLMProviderName[] = [
    ...(activeProvider ? [activeProvider] : []),
    ...allProviders.filter((p) => p !== activeProvider),
  ];

  let migratedKey: string | null = null;
  let migratedProvider: LLMProviderName = 'openai';

  for (const p of orderedProviders) {
    const legacyKey = legacyKeyMap[p];
    if (!legacyKey) continue;
    const key = await getSecureItem(legacyKey);
    if (key) {
      migratedKey = key;
      migratedProvider = p as LLMProviderName;
      break;
    }
  }

  if (migratedKey) {
    await setSecureItem(SecureKeys.ACTIVE_API_KEY, migratedKey);
    await setSetting('active_provider', migratedProvider);
  }

  // Delete all legacy keys regardless of whether migration found anything
  for (const legacyKey of Object.values(legacyKeyMap)) {
    try {
      await deleteSecureItem(legacyKey);
    } catch {
      // Key may not exist — safe to ignore
    }
  }

  await setSetting('has_migrated_api_key', true);
}
