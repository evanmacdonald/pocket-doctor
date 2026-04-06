jest.mock('~/utils/secure-store', () => ({
  getSecureItem:  jest.fn(),
  setSecureItem:  jest.fn(),
  deleteSecureItem: jest.fn(),
  SecureKeys: {
    ACTIVE_API_KEY:        'apikey_active',
    PORTAL_TOKEN_KEY:      'portal_token_encryption_key',
    _LEGACY_OPENAI_KEY:    'apikey_openai',
    _LEGACY_ANTHROPIC_KEY: 'apikey_anthropic',
    _LEGACY_GEMINI_KEY:    'apikey_gemini',
  },
}));

jest.mock('~/db/repositories/settings.repository', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

import { migrateApiKeysIfNeeded } from '../migrate-api-keys';
import { getSecureItem, setSecureItem, deleteSecureItem } from '~/utils/secure-store';
import { getSetting, setSetting } from '~/db/repositories/settings.repository';

const mockGetSecureItem    = getSecureItem    as jest.Mock;
const mockSetSecureItem    = setSecureItem    as jest.Mock;
const mockDeleteSecureItem = deleteSecureItem as jest.Mock;
const mockGetSetting       = getSetting       as jest.Mock;
const mockSetSetting       = setSetting       as jest.Mock;

describe('migrateApiKeysIfNeeded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSecureItem.mockResolvedValue(undefined);
    mockDeleteSecureItem.mockResolvedValue(undefined);
    mockSetSetting.mockResolvedValue(undefined);
  });

  it('does nothing when already migrated', async () => {
    mockGetSetting.mockResolvedValue(true); // has_migrated_api_key = true
    await migrateApiKeysIfNeeded();
    expect(mockSetSecureItem).not.toHaveBeenCalled();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('migrates the active provider key and marks migration complete', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'has_migrated_api_key') return Promise.resolve(false);
      if (key === 'active_provider')      return Promise.resolve('openai');
      return Promise.resolve(null);
    });
    mockGetSecureItem.mockImplementation((key: string) => {
      if (key === 'apikey_openai') return Promise.resolve('sk-test');
      return Promise.resolve(null);
    });

    await migrateApiKeysIfNeeded();

    expect(mockSetSecureItem).toHaveBeenCalledWith('apikey_active', 'sk-test');
    expect(mockSetSetting).toHaveBeenCalledWith('active_provider', 'openai');
    expect(mockSetSetting).toHaveBeenCalledWith('has_migrated_api_key', true);
  });

  it('falls back to another provider key when active provider has no key', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'has_migrated_api_key') return Promise.resolve(false);
      if (key === 'active_provider')      return Promise.resolve('openai');
      return Promise.resolve(null);
    });
    mockGetSecureItem.mockImplementation((key: string) => {
      if (key === 'apikey_anthropic') return Promise.resolve('sk-ant-test');
      return Promise.resolve(null);
    });

    await migrateApiKeysIfNeeded();

    expect(mockSetSecureItem).toHaveBeenCalledWith('apikey_active', 'sk-ant-test');
    expect(mockSetSetting).toHaveBeenCalledWith('active_provider', 'anthropic');
  });

  it('writes nothing to Keychain when no legacy keys exist', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'has_migrated_api_key') return Promise.resolve(false);
      if (key === 'active_provider')      return Promise.resolve('openai');
      return Promise.resolve(null);
    });
    mockGetSecureItem.mockResolvedValue(null);

    await migrateApiKeysIfNeeded();

    expect(mockSetSecureItem).not.toHaveBeenCalled();
    expect(mockSetSetting).toHaveBeenCalledWith('has_migrated_api_key', true);
  });

  it('deletes all legacy keys regardless of whether migration found a key', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'has_migrated_api_key') return Promise.resolve(false);
      if (key === 'active_provider')      return Promise.resolve('gemini');
      return Promise.resolve(null);
    });
    mockGetSecureItem.mockImplementation((key: string) => {
      if (key === 'apikey_gemini') return Promise.resolve('AIza-test');
      return Promise.resolve(null);
    });

    await migrateApiKeysIfNeeded();

    expect(mockDeleteSecureItem).toHaveBeenCalledWith('apikey_openai');
    expect(mockDeleteSecureItem).toHaveBeenCalledWith('apikey_anthropic');
    expect(mockDeleteSecureItem).toHaveBeenCalledWith('apikey_gemini');
  });

  it('continues safely when deleteSecureItem throws', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'has_migrated_api_key') return Promise.resolve(false);
      if (key === 'active_provider')      return Promise.resolve('openai');
      return Promise.resolve(null);
    });
    mockGetSecureItem.mockResolvedValue(null);
    mockDeleteSecureItem.mockRejectedValue(new Error('Key not found'));

    await expect(migrateApiKeysIfNeeded()).resolves.not.toThrow();
    expect(mockSetSetting).toHaveBeenCalledWith('has_migrated_api_key', true);
  });
});
