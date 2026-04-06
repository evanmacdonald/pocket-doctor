jest.mock('~/db/client', () => require('../../../__mocks__/db-client'));

import { logEvent, getRecentEvents } from '../audit.repository';
import { mockDb, resetMockDb } from '../../../__mocks__/db-client';

describe('logEvent()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls db.insert once', async () => {
    await logEvent({ eventType: 'record_created' });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('serialises metadata to JSON when provided', async () => {
    await logEvent({
      eventType: 'chat_query',
      metadata: { provider: 'openai', model: 'gpt-4o-mini' },
    });
    const insertedValues = (mockDb.insert as jest.Mock).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.metadataJson).toBe('{"provider":"openai","model":"gpt-4o-mini"}');
  });

  it('sets metadataJson to null when no metadata provided', async () => {
    await logEvent({ eventType: 'app_unlocked' });
    const insertedValues = (mockDb.insert as jest.Mock).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.metadataJson).toBeNull();
  });

  it('includes eventType in the inserted row', async () => {
    await logEvent({ eventType: 'export_created', resourceId: 'doc-42' });
    const insertedValues = (mockDb.insert as jest.Mock).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.eventType).toBe('export_created');
    expect(insertedValues.resourceId).toBe('doc-42');
  });

  it('includes a numeric createdAt timestamp', async () => {
    const before = Date.now();
    await logEvent({ eventType: 'api_key_set' });
    const after = Date.now();
    const insertedValues = (mockDb.insert as jest.Mock).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.createdAt).toBeGreaterThanOrEqual(before);
    expect(insertedValues.createdAt).toBeLessThanOrEqual(after);
  });
});

describe('getRecentEvents()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls findMany and returns the result', async () => {
    const events = [{ id: 1, eventType: 'record_created', createdAt: Date.now() }];
    (mockDb.query.auditLog.findMany as jest.Mock).mockResolvedValueOnce(events);
    const result = await getRecentEvents(50);
    expect(result).toEqual(events);
    expect(mockDb.query.auditLog.findMany).toHaveBeenCalledTimes(1);
  });
});
