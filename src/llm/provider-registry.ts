import { getSecureItem, SecureKeys } from '~/utils/secure-store';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import type { LLMProvider, LLMProviderName } from './types';

// ─── Provider Registry ────────────────────────────────────────────────────────
// Lazily instantiates providers from API keys stored in iOS Keychain.
// Invalidate the cache when a key is added/removed (call invalidate()).

class ProviderRegistry {
  private _cache = new Map<LLMProviderName, LLMProvider>();

  /**
   * Get a provider by name.
   * Returns null if no API key is configured for that provider.
   */
  async getProvider(name: LLMProviderName): Promise<LLMProvider | null> {
    if (this._cache.has(name)) {
      return this._cache.get(name)!;
    }

    const key = await this._getKey(name);
    if (!key) return null;

    const provider = this._createProvider(name, key);
    this._cache.set(name, provider);
    return provider;
  }

  /**
   * Returns the list of provider names that have API keys configured.
   */
  async getConfiguredProviders(): Promise<LLMProviderName[]> {
    const results: LLMProviderName[] = [];
    for (const name of ['openai', 'anthropic', 'gemini'] as LLMProviderName[]) {
      const key = await this._getKey(name);
      if (key) results.push(name);
    }
    return results;
  }

  /** Clear the provider cache (call after storing a new API key) */
  invalidate(name?: LLMProviderName) {
    if (name) {
      this._cache.delete(name);
    } else {
      this._cache.clear();
    }
  }

  private async _getKey(name: LLMProviderName): Promise<string | null> {
    const keyMap: Record<LLMProviderName, typeof SecureKeys[keyof typeof SecureKeys]> = {
      openai:    SecureKeys.OPENAI_API_KEY,
      anthropic: SecureKeys.ANTHROPIC_API_KEY,
      gemini:    SecureKeys.GEMINI_API_KEY,
    };
    return getSecureItem(keyMap[name]);
  }

  private _createProvider(name: LLMProviderName, apiKey: string): LLMProvider {
    switch (name) {
      case 'openai':    return new OpenAIProvider(apiKey);
      case 'anthropic': return new AnthropicProvider(apiKey);
      case 'gemini':    return new GeminiProvider(apiKey);
    }
  }
}

export const providerRegistry = new ProviderRegistry();
