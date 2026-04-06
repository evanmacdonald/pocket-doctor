// In-memory SecureStore mock — same get/set/delete contract as the real module,
// without the iOS Keychain requirement.
const store = new Map<string, string>();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

export const setItemAsync = jest.fn(async (key: string, value: string) => {
  store.set(key, value);
});

export const getItemAsync = jest.fn(async (key: string) => {
  return store.get(key) ?? null;
});

export const deleteItemAsync = jest.fn(async (key: string) => {
  store.delete(key);
});

/** Helper for tests: wipe the in-memory store */
export const __resetStore = () => store.clear();
