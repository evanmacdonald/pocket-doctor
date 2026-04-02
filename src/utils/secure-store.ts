import * as SecureStore from 'expo-secure-store';

// WHEN_UNLOCKED_THIS_DEVICE_ONLY:
// - Keys only accessible when device is unlocked
// - Do NOT sync to iCloud Keychain (by design — medical data stays on device)
// - Wiped on device restore (user must re-enter API keys on new device)
const ACCESSIBILITY = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

export const SecureKeys = {
  OPENAI_API_KEY:    'apikey_openai',
  ANTHROPIC_API_KEY: 'apikey_anthropic',
  GEMINI_API_KEY:    'apikey_gemini',
  PORTAL_TOKEN_KEY:  'portal_token_encryption_key',  // AES key for portal tokens
} as const;

export type SecureKey = (typeof SecureKeys)[keyof typeof SecureKeys];

export async function setSecureItem(key: SecureKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, { keychainAccessible: ACCESSIBILITY });
}

export async function getSecureItem(key: SecureKey): Promise<string | null> {
  return SecureStore.getItemAsync(key, { keychainAccessible: ACCESSIBILITY });
}

export async function deleteSecureItem(key: SecureKey): Promise<void> {
  await SecureStore.deleteItemAsync(key, { keychainAccessible: ACCESSIBILITY });
}
