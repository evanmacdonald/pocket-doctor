// Minimal in-memory mock for expo-sqlite.
// Repositories don't import this directly — they go through ~/db/client.
// This mock is only needed so that client.ts can be imported without crashing.
export const openDatabaseAsync = jest.fn().mockResolvedValue({
  execAsync:    jest.fn().mockResolvedValue(undefined),
  runAsync:     jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
  getAllAsync:   jest.fn().mockResolvedValue([]),
  getFirstAsync: jest.fn().mockResolvedValue(null),
});
