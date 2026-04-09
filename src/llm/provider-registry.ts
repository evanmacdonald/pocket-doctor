import { getSecureItem, SecureKeys } from '~/utils/secure-store';
import { getSetting } from '~/db/repositories/settings.repository';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { CustomProvider } from './providers/custom.provider';
import type { LLMProvider, LLMProviderName } from './types';

// ─── Provider Registry ────────────────────────────────────────────────────────
// Single active provider backed by one Keychain entry (apikey_active).
// The active provider name is stored in SQLite settings (active_provider).
// Invalidate the cache when the key or provider changes (call invalidate()).

class ProviderRegistry {
  private _cached: LLMProvider | null = null;
  private _cachedProviderName: LLMProviderName | null = null;
  private _cachedIngestion: LLMProvider | null = null;
  private _cachedIngestionName: LLMProviderName | null = null;

  /**
   * Get a provider by name.
   * Returns null if no key is configured or if `name` does not match the
   * currently active provider.
   */
  async getProvider(name: LLMProviderName): Promise<LLMProvider | null> {
    if (this._cached && this._cachedProviderName === name) {
      return this._cached;
    }

    const apiKey = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
    if (!apiKey) return null;

    const activeProvider = await getSetting('active_provider') as LLMProviderName;
    if (activeProvider !== name) return null;

    const provider = await this._createProvider(name, apiKey);
    this._cached = provider;
    this._cachedProviderName = name;
    return provider;
  }

  /**
   * Get the currently active provider without needing to know its name.
   * Returns null if no key is configured.
   */
  async getActiveProvider(): Promise<LLMProvider | null> {
    const apiKey = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
    if (!apiKey) return null;

    const name = await getSetting('active_provider') as LLMProviderName;
    if (this._cached && this._cachedProviderName === name) {
      return this._cached;
    }

    const provider = await this._createProvider(name, apiKey);
    this._cached = provider;
    this._cachedProviderName = name;
    return provider;
  }

  /**
   * Returns the active provider name in an array if a key is configured,
   * otherwise an empty array.
   */
  async getConfiguredProviders(): Promise<LLMProviderName[]> {
    const apiKey = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
    if (!apiKey) return [];
    const name = await getSetting('active_provider') as LLMProviderName;
    return [name];
  }

  /**
   * Get the ingestion provider, backed by INGESTION_API_KEY and the
   * `ingestion_provider` setting. Returns null if no ingestion key is set.
   */
  async getIngestionProvider(): Promise<LLMProvider | null> {
    const apiKey = await getSecureItem(SecureKeys.INGESTION_API_KEY);
    if (!apiKey) return null;

    const name = await getSetting('ingestion_provider') as LLMProviderName;
    if (this._cachedIngestion && this._cachedIngestionName === name) {
      return this._cachedIngestion;
    }

    const provider = await this._createProvider(name, apiKey);
    this._cachedIngestion = provider;
    this._cachedIngestionName = name;
    return provider;
  }

  /** Clear the provider cache (call after storing/removing an API key) */
  invalidate(_name?: LLMProviderName) {
    this._cached = null;
    this._cachedProviderName = null;
    this._cachedIngestion = null;
    this._cachedIngestionName = null;
  }

  private async _createProvider(name: LLMProviderName, apiKey: string): Promise<LLMProvider> {
    switch (name) {
      case 'openai':    return new OpenAIProvider(apiKey);
      case 'anthropic': return new AnthropicProvider(apiKey);
      case 'gemini':    return new GeminiProvider(apiKey);
      case 'custom': {
        const baseUrl = await getSetting('custom_base_url');
        return new CustomProvider(apiKey, baseUrl);
      }
    }
  }
}

export const providerRegistry = new ProviderRegistry();
