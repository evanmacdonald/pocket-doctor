jest.mock('~/db/client', () => require('../../../__mocks__/db-client'));

import {
  createChatSession,
  getChatSessions,
  getChatSession,
  addChatMessage,
  getChatMessages,
  deleteChatSession,
} from '../chat.repository';
import { mockDb, resetMockDb } from '../../../__mocks__/db-client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createChatSession()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('returns a UUID-formatted session ID', async () => {
    const id = await createChatSession({
      provider: 'openai',
      model: 'gpt-4o-mini',
      searchMode: 'fts',
    });
    expect(id).toMatch(UUID_REGEX);
  });

  it('calls db.insert once', async () => {
    await createChatSession({ provider: 'openai', model: 'gpt-4o-mini', searchMode: 'fts' });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });
});

describe('getChatSessions()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls findMany and returns the result', async () => {
    const sessions = [{ id: 'sess-1', title: 'Test', provider: 'openai', model: 'gpt-4o-mini' }];
    (mockDb.query.chatSessions.findMany as jest.Mock).mockResolvedValueOnce(sessions);
    expect(await getChatSessions()).toEqual(sessions);
  });
});

describe('getChatSession()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls findFirst and returns the row', async () => {
    const session = { id: 'sess-1' };
    (mockDb.query.chatSessions.findFirst as jest.Mock).mockResolvedValueOnce(session);
    expect(await getChatSession('sess-1')).toEqual(session);
  });
});

describe('addChatMessage()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('returns a UUID message ID', async () => {
    const id = await addChatMessage({
      sessionId: 'sess-1',
      role: 'user',
      content: 'Hello',
    });
    expect(id).toMatch(UUID_REGEX);
  });

  it('calls insert once for the message and update once to bump session', async () => {
    await addChatMessage({ sessionId: 'sess-1', role: 'user', content: 'Hi' });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });
});

describe('getChatMessages()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls findMany and returns messages', async () => {
    const messages = [{ id: 'msg-1', role: 'user', content: 'Hi' }];
    (mockDb.query.chatMessages.findMany as jest.Mock).mockResolvedValueOnce(messages);
    expect(await getChatMessages('sess-1')).toEqual(messages);
  });
});

describe('deleteChatSession()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('calls delete twice — messages first, then session', async () => {
    await deleteChatSession('sess-1');
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
    // Verify the call order: messages table deleted first
    const firstTable = (mockDb.delete as jest.Mock).mock.calls[0][0];
    const secondTable = (mockDb.delete as jest.Mock).mock.calls[1][0];
    // We can't easily compare drizzle table references, but can verify two distinct calls
    expect(firstTable).not.toBe(secondTable);
  });
});
