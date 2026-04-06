// Mock for sqlite-vec (vector extension for SQLite).
// The extension only loads in a native Expo dev build, not in Jest's Node env.
export const load = jest.fn();
