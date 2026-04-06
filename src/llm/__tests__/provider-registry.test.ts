jest.mock('~/utils/secure-store', () => ({
  getSecureItem: jest.fn(),
  SecureKeys: {
    OPENAI_API_KEY:    'apikey_openai',
    ANTHROPIC_API_KEY: 'apikey_anthropic',
    GEMINI_API_KEY:    'apikey_gemini',
    PORTAL_TOKEN_KEY:  'portal_token_encryption_key',
  },
}));

import { providerRegistry } from '../provider-registry';
import { getSecureItem } from '~/utils/secure-store';

const mockGetSecureItem = getSecureItem as jest.Mock;

describe('ProviderRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    providerRegistry.invalidate(); // clear provider cache between tests
  });

  describe('getProvider()', () => {
    it('returns null when no API key is configured', async () => {
      mockGetSecureItem.mockResolvedValue(null);
      const provider = await providerRegistry.getProvider('openai');
      expect(provider).toBeNull();
    });

    it('returns an OpenAI provider instance when key is present', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      const provider = await providerRegistry.getProvider('openai');
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('openai');
    });

    it('returns an Anthropic provider when key is present', async () => {
      mockGetSecureItem.mockResolvedValue('sk-ant-test');
      const provider = await providerRegistry.getProvider('anthropic');
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('anthropic');
    });

    it('returns a Gemini provider when key is present', async () => {
      mockGetSecureItem.mockResolvedValue('AIza-test');
      const provider = await providerRegistry.getProvider('gemini');
      expect(provider).not.toBeNull();
      expect(provider!.name).toBe('gemini');
    });

    it('caches the provider — getSecureItem only called once per provider', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      await providerRegistry.getProvider('openai');
      await providerRegistry.getProvider('openai');
      expect(mockGetSecureItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate()', () => {
    it('invalidate(name) clears only that provider from cache', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      await providerRegistry.getProvider('openai');
      providerRegistry.invalidate('openai');
      await providerRegistry.getProvider('openai');
      // Called twice: once before, once after invalidation
      expect(mockGetSecureItem).toHaveBeenCalledTimes(2);
    });

    it('invalidate() with no arg clears all providers', async () => {
      mockGetSecureItem.mockResolvedValue('sk-test');
      await providerRegistry.getProvider('openai');
      await providerRegistry.getProvider('anthropic');
      providerRegistry.invalidate();
      await providerRegistry.getProvider('openai');
      // 3 calls: openai, anthropic, openai again after full clear
      expect(mockGetSecureItem).toHaveBeenCalledTimes(3);
    });
  });

  describe('getConfiguredProviders()', () => {
    it('returns only providers that have keys configured', async () => {
      mockGetSecureItem.mockImplementation((key: string) => {
        if (key === 'apikey_openai') return Promise.resolve('sk-test');
        return Promise.resolve(null);
      });
      const configured = await providerRegistry.getConfiguredProviders();
      expect(configured).toEqual(['openai']);
    });

    it('returns all three when all keys are set', async () => {
      mockGetSecureItem.mockResolvedValue('some-key');
      const configured = await providerRegistry.getConfiguredProviders();
      expect(configured).toEqual(['openai', 'anthropic', 'gemini']);
    });

    it('returns empty array when no keys are set', async () => {
      mockGetSecureItem.mockResolvedValue(null);
      const configured = await providerRegistry.getConfiguredProviders();
      expect(configured).toEqual([]);
    });
  });
});
