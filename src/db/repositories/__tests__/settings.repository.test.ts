jest.mock('~/db/client', () => require('../../../__mocks__/db-client'));

import { getSetting, setSetting, getAllSettings } from '../settings.repository';
import { mockDb, resetMockDb } from '../../../__mocks__/db-client';

describe('getSetting()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('returns the typed default when no row exists', async () => {
    (mockDb.query.appSettings.findFirst as jest.Mock).mockResolvedValueOnce(undefined);
    expect(await getSetting('active_provider')).toBe('openai');
    expect(await getSetting('auto_lock_seconds')).toBe(300);
    expect(await getSetting('has_completed_onboarding')).toBe(false);
  });

  it('returns the stored value (JSON-parsed) when a row exists', async () => {
    (mockDb.query.appSettings.findFirst as jest.Mock).mockResolvedValue({
      key: 'active_provider',
      value: JSON.stringify('gemini'),
    });
    expect(await getSetting('active_provider')).toBe('gemini');
  });
});

describe('setSetting()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls insert (upsert) once', async () => {
    await setSetting('active_model', 'gpt-4o');
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('calls onConflictDoUpdate', async () => {
    await setSetting('active_model', 'gpt-4o');
    const valuesReturn = (mockDb.insert as jest.Mock).mock.results[0].value.values.mock.results[0].value;
    expect(valuesReturn.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('getAllSettings()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('returns an empty object when no settings stored', async () => {
    (mockDb.query.appSettings.findMany as jest.Mock).mockResolvedValueOnce([]);
    expect(await getAllSettings()).toEqual({});
  });

  it('parses all stored rows into a typed object', async () => {
    (mockDb.query.appSettings.findMany as jest.Mock).mockResolvedValueOnce([
      { key: 'active_provider', value: JSON.stringify('gemini') },
      { key: 'active_model',    value: JSON.stringify('gemini-2.0-flash') },
    ]);
    const settings = await getAllSettings();
    expect(settings.active_provider).toBe('gemini');
    expect(settings.active_model).toBe('gemini-2.0-flash');
  });
});
