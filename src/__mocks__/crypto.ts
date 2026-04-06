// Re-export Node's built-in crypto module.
// This mock is used for two module IDs:
//   - 'crypto'              (import from react-native-quick-crypto)
//   - 'react-native-quick-crypto'
// Node 18+ exports the same AES-256-GCM / PBKDF2 API that
// react-native-quick-crypto wraps, so crypto.service.ts runs with real crypto.
export * from 'node:crypto';
