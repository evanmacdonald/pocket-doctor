jest.mock('~/utils/secure-store', () => ({
  getSecureItem: jest.fn(),
  SecureKeys: {
    ACTIVE_API_KEY:        'apikey_active',
    INGESTION_API_KEY:     'apikey_ingestion',
    PORTAL_TOKEN_KEY:      'portal_token_encryption_key',
    _LEGACY_OPENAI_KEY:    'apikey_openai',
    _LEGACY_ANTHROPIC_KEY: 'apikey_anthropic',
    _LEGACY_GEMINI_KEY:    'apikey_gemini',
  },
}));

jest.mock('~/db/repositories/settings.repository', () => ({
  getSetting: jest.fn(),
}));

import { providerRegistry } from '../provider-registry';
import { getSecureItem } from '~/utils/secure-store';
import { getSetting } from '~/db/repositories/settings.repository';

const mockGetSecureItem = getSecureItem as jest.Mock;
const mockGetSetting    = getSetting    as jest.Mock;

describe('ProviderRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    providerRegistry.invalidate();
  });

  describe('getProvider()', () => {
    it('returns null when no API key is configured', async () => {
      mockGetSecureItem.mockResolvedValue(null);
      const provider = await providerRegistry.getProvider('openai');
      expect(provider).toBeNull();
    });

    it('returns null when requested name does not match active provider', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('gemini');
      const provider = await providerRegistry.getProvider('openai');
      expect(provider).toBeNull();
    });

    it('returns an OpenAI provider when key is present and active_provider matches', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('openai');
      const provider = await providerRegistry.getProvider('openai');
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('openai');
    });

    it('returns an Anthropic provider when key is present and active_provider matches', async () => {
      mockGetSecureItem.mockResolvedValue('sk-ant-test');
      mockGetSetting.mockResolvedValue('anthropic');
      const provider = await providerRegistry.getProvider('anthropic');
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('anthropic');
    });

    it('returns a Gemini provider when key is present and active_provider matches', async () => {
      mockGetSecureItem.mockResolvedValue('AIza-test');
      mockGetSetting.mockResolvedValue('gemini');
      const provider = await providerRegistry.getProvider('gemini');
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('gemini');
    });

    it('caches the provider — getSecureItem only called once when requesting same provider twice', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('openai');
      await providerRegistry.getProvider('openai');
      await providerRegistry.getProvider('openai');
      expect(mockGetSecureItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('getActiveProvider()', () => {
    it('returns null when no key is configured', async () => {
      mockGetSecureItem.mockResolvedValue(null);
      const provider = await providerRegistry.getActiveProvider();
      expect(provider).toBeNull();
    });

    it('returns the active provider without needing to specify a name', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('openai');
      const provider = await providerRegistry.getActiveProvider();
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('openai');
    });
  });

  describe('invalidate()', () => {
    it('clears the cache so next call re-fetches from Keychain', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('openai');
      await providerRegistry.getProvider('openai');
      providerRegistry.invalidate();
      await providerRegistry.getProvider('openai');
      // Called twice: once before invalidation, once after
      expect(mockGetSecureItem).toHaveBeenCalledTimes(2);
    });

    it('invalidate(name) also clears the cache', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('openai');
      await providerRegistry.getProvider('openai');
      providerRegistry.invalidate('openai');
      await providerRegistry.getProvider('openai');
      expect(mockGetSecureItem).toHaveBeenCalledTimes(2);
    });
  });

  describe('getConfiguredProviders()', () => {
    it('returns the active provider name when a key is configured', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      mockGetSetting.mockResolvedValue('openai');
      const configured = await providerRegistry.getConfiguredProviders();
      expect(configured).toEqual(['openai']);
    });

    it('returns the correct provider name for whichever is active', async () => {
      mockGetSecureItem.mockResolvedValue('sk-ant-test');
      mockGetSetting.mockResolvedValue('anthropic');
      const configured = await providerRegistry.getConfiguredProviders();
      expect(configured).toEqual(['anthropic']);
    });

    it('returns empty array when no key is configured', async () => {
      mockGetSecureItem.mockResolvedValue(null);
      const configured = await providerRegistry.getConfiguredProviders();
      expect(configured).toEqual([]);
    });
  });
});
