// moduleNameMapper routes expo-secure-store to src/__mocks__/expo-secure-store.ts
// Import the mock directly to spy on calls.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockSecureStore = require('expo-secure-store') as {
  setItemAsync:    jest.Mock;
  getItemAsync:    jest.Mock;
  deleteItemAsync: jest.Mock;
  __resetStore:    () => void;
};

import { setSecureItem, getSecureItem, deleteSecureItem, SecureKeys } from '../secure-store';

describe('secure-store helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockSecureStore.__resetStore();
  });

  describe('setSecureItem()', () => {
    it('delegates to SecureStore.setItemAsync with keychainAccessible option', async () => {
      await setSecureItem(SecureKeys.ACTIVE_API_KEY, 'sk-test');
      expect(MockSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
      expect(MockSecureStore.setItemAsync).toHaveBeenCalledWith(
        'apikey_active',
        'sk-test',
        expect.objectContaining({ keychainAccessible: expect.anything() })
      );
    });

    it('accepts all defined SecureKey values', async () => {
      for (const key of Object.values(SecureKeys)) {
        await setSecureItem(key as (typeof SecureKeys)[keyof typeof SecureKeys], 'value');
      }
      expect(MockSecureStore.setItemAsync).toHaveBeenCalledTimes(
        Object.keys(SecureKeys).length
      );
    });
  });

  describe('getSecureItem()', () => {
    it('returns the stored value', async () => {
      await MockSecureStore.setItemAsync('apikey_active', 'sk-test', {});
      const result = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
      expect(result).toBe('sk-test');
    });

    it('returns null when the key has not been set', async () => {
      const result = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
      expect(result).toBeNull();
    });
  });

  describe('deleteSecureItem()', () => {
    it('delegates to SecureStore.deleteItemAsync with keychainAccessible option', async () => {
      await deleteSecureItem(SecureKeys._LEGACY_GEMINI_KEY);
      expect(MockSecureStore.deleteItemAsync).toHaveBeenCalledWith(
        'apikey_gemini',
        expect.objectContaining({ keychainAccessible: expect.anything() })
      );
    });

    it('stored value is gone after delete', async () => {
      await setSecureItem(SecureKeys.ACTIVE_API_KEY, 'sk-test');
      await deleteSecureItem(SecureKeys.ACTIVE_API_KEY);
      const result = await getSecureItem(SecureKeys.ACTIVE_API_KEY);
      expect(result).toBeNull();
    });
  });
});
