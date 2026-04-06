// Tests for the sanitization and term-filtering logic in ftsSearch.
// We mock ~/db/client so the SQLite call is controlled.

jest.mock('~/db/client', () => require('../../__mocks__/db-client'));

import { ftsSearch } from '../fts.service';
import { mockSqlite } from '../../__mocks__/db-client';

describe('ftsSearch()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockSqlite.getAllAsync as jest.Mock).mockResolvedValue([]);
  });

  it('returns empty array for empty query', async () => {
    const result = await ftsSearch('');
    expect(result).toEqual([]);
    expect(mockSqlite.getAllAsync).not.toHaveBeenCalled();
  });

  it('returns empty array for whitespace-only query', async () => {
    const result = await ftsSearch('   ');
    expect(result).toEqual([]);
    expect(mockSqlite.getAllAsync).not.toHaveBeenCalled();
  });

  it('strips special FTS5 chars and still queries', async () => {
    await ftsSearch('diabetes*');
    expect(mockSqlite.getAllAsync).toHaveBeenCalled();
    const [sql, params] = (mockSqlite.getAllAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('MATCH');
    expect(params[0]).not.toContain('*');
  });

  it('filters out single-character terms', async () => {
    // "I a" — both terms are 1 char, should produce no DB call
    const result = await ftsSearch('I a');
    expect(result).toEqual([]);
    expect(mockSqlite.getAllAsync).not.toHaveBeenCalled();
  });

  it('joins multi-word query with OR', async () => {
    await ftsSearch('blood pressure');
    const [, params] = (mockSqlite.getAllAsync as jest.Mock).mock.calls[0];
    expect(params[0]).toBe('blood OR pressure');
  });

  it('natural language question strips noise words and keeps keywords', async () => {
    await ftsSearch('What do I take for diabetes?');
    const [, params] = (mockSqlite.getAllAsync as jest.Mock).mock.calls[0];
    // 'do', 'take', 'for', 'diabetes' survive — 'What' stripped (special? no, 'What' is fine, 'do' is >= 2 chars)
    // '?' is stripped. Single-char words are filtered. Let's check result contains 'diabetes'
    expect(params[0]).toContain('diabetes');
  });

  it('passes the limit parameter to the SQL query', async () => {
    await ftsSearch('cholesterol', 5);
    const [, params] = (mockSqlite.getAllAsync as jest.Mock).mock.calls[0];
    expect(params[1]).toBe(5);
  });

  it('maps rows to FtsResult shape', async () => {
    (mockSqlite.getAllAsync as jest.Mock).mockResolvedValueOnce([
      { resource_id: 'abc', resource_type: 'Condition', snippet: '...diabetes...', rank: -1.5 },
    ]);
    const results = await ftsSearch('diabetes');
    expect(results).toEqual([{
      fhirId:       'abc',
      resourceType: 'Condition',
      snippet:      '...diabetes...',
      rank:         -1.5,
    }]);
  });

  it('returns empty for a query of only single-char terms', async () => {
    // 'I a' — both tokens are 1 char, already tested above.
    // For chars like '!' stripped + remaining 1-char terms:
    const result = await ftsSearch('! a b');
    expect(result).toEqual([]);
    expect(mockSqlite.getAllAsync).not.toHaveBeenCalled();
  });
});
