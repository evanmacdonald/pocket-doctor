import 'react-native-get-random-values';

/**
 * Generate a UUID v4 using the device's secure random source.
 * react-native-get-random-values polyfills crypto.getRandomValues()
 * on React Native / Hermes.
 */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
