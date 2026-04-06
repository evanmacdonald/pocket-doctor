// jest.config.js
// Uses jest-expo preset for correct Babel transforms and RN module resolution.
// testEnvironment: 'node' — all src/ tests are pure logic, no DOM/RN rendering.

module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',

  // Only run files explicitly named *.test.ts / *.test.tsx (not helper files
  // that live in __tests__/ directories, like sse-helper.ts).
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],

  // Resolve path aliases that match tsconfig.json ("@/*" and "~/*")
  // plus map native modules to lightweight in-process mocks.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
    // Map `import ... from 'crypto'` → Node's own crypto (same API surface as
    // react-native-quick-crypto; lets crypto.service.ts run with real AES-256-GCM)
    '^crypto$': '<rootDir>/src/__mocks__/crypto.ts',
    '^react-native-quick-crypto$': '<rootDir>/src/__mocks__/crypto.ts',
    // Silence native-only modules that have no Node implementation
    '^expo-sqlite$': '<rootDir>/src/__mocks__/expo-sqlite.ts',
    '^expo-secure-store$': '<rootDir>/src/__mocks__/expo-secure-store.ts',
    '^expo-file-system$': '<rootDir>/src/__mocks__/expo-file-system.ts',
    '^expo-file-system/legacy$': '<rootDir>/src/__mocks__/expo-file-system.ts',
    '^expo-local-authentication$': '<rootDir>/src/__mocks__/expo-local-authentication.ts',
    '^expo-sharing$': '<rootDir>/src/__mocks__/expo-sharing.ts',
    '^expo-document-picker$': '<rootDir>/src/__mocks__/expo-document-picker.ts',
    '^react-native-get-random-values$': '<rootDir>/src/__mocks__/react-native-get-random-values.ts',
    '^sqlite-vec$': '<rootDir>/src/__mocks__/sqlite-vec.ts',
  },

  // Only collect coverage from src/ logic (not generated files or barrel re-exports).
  // db/client.ts (SQLite DDL init) and ingestion/pipeline.ts (integration orchestration)
  // cannot be meaningfully unit-tested — exclude to keep thresholds honest.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/__mocks__/**',
    '!src/db/client.ts',
    '!src/ingestion/pipeline.ts',
  ],

  // Enforce minimum coverage — CI fails below these thresholds
  coverageThreshold: {
    global: {
      statements: 70,
      branches:   65,
      functions:  70,
      lines:      70,
    },
  },

  coverageReporters: ['text-summary', 'lcov', 'html'],
};
