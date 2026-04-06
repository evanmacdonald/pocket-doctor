// Reusable mock factory for ~/db/client.
//
// Usage in repository test files:
//   jest.mock('~/db/client', () => require('../../../__mocks__/db-client'));
//   (adjust relative path based on test file location)
//
// Call resetMockDb() in beforeEach to get fresh jest.fn() instances for each test.
// mockDb and mockSqlite are const references — their properties are mutated on reset
// so that imported references in test files stay in sync.

import { jest } from '@jest/globals';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeQueryTable() {
  return {
    findFirst: jest.fn().mockResolvedValue(undefined),
    findMany:  jest.fn().mockResolvedValue([]),
  };
}

function makeInsertChain() {
  const onConflictDoUpdate  = jest.fn().mockResolvedValue(undefined);
  const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
  const insertFn = jest.fn().mockReturnValue({ values });
  return insertFn;
}

function makeUpdateChain() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set   = jest.fn().mockReturnValue({ where });
  return jest.fn().mockReturnValue({ set });
}

function makeDeleteChain() {
  const where = jest.fn().mockResolvedValue(undefined);
  return jest.fn().mockReturnValue({ where });
}

function makeSqliteHandle() {
  return {
    execAsync:    jest.fn().mockResolvedValue(undefined),
    runAsync:     jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
    getAllAsync:   jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
  };
}

// ── Stable exported references (mutated in place on reset) ────────────────────
// Using `const` + property mutation ensures imported references in tests remain
// valid after resetMockDb() is called in beforeEach.

export const mockDb: ReturnType<typeof makeFreshDb> = makeFreshDb();
export const mockSqlite: ReturnType<typeof makeSqliteHandle> = makeSqliteHandle();

function makeFreshDb() {
  return {
    query: {
      fhirResources:  makeQueryTable(),
      documents:      makeQueryTable(),
      chatSessions:   makeQueryTable(),
      chatMessages:   makeQueryTable(),
      appSettings:    makeQueryTable(),
      auditLog:       makeQueryTable(),
    },
    insert: makeInsertChain(),
    update: makeUpdateChain(),
    delete: makeDeleteChain(),
  };
}

export const resetMockDb = () => {
  const fresh = makeFreshDb();
  // Mutate in place so imported references in test files stay valid
  mockDb.query          = fresh.query;
  (mockDb as any).insert = fresh.insert;
  (mockDb as any).update = fresh.update;
  (mockDb as any).delete = fresh.delete;

  const freshSqlite = makeSqliteHandle();
  (mockSqlite as any).execAsync    = freshSqlite.execAsync;
  (mockSqlite as any).runAsync     = freshSqlite.runAsync;
  (mockSqlite as any).getAllAsync   = freshSqlite.getAllAsync;
  (mockSqlite as any).getFirstAsync = freshSqlite.getFirstAsync;
};

// ── Module exports that mirror ~/db/client ────────────────────────────────────

export const getDatabase  = jest.fn(() => mockDb);
export const getSQLite    = jest.fn(() => mockSqlite);
export const openDatabase = jest.fn().mockResolvedValue(mockDb);

export const indexFhirResourceFts  = jest.fn().mockResolvedValue(undefined);
export const removeFhirResourceFts = jest.fn().mockResolvedValue(undefined);
