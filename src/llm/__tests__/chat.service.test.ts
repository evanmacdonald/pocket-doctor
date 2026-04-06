// Mock all dependencies before importing the module under test
jest.mock('~/db/repositories/settings.repository', () => ({
  getSetting: jest.fn(),
}));
jest.mock('~/llm/provider-registry', () => ({
  providerRegistry: { getProvider: jest.fn() },
}));
jest.mock('~/rag/context-builder', () => ({
  buildFullContext: jest.fn(),
}));
jest.mock('~/db/repositories/chat.repository', () => ({
  getChatMessages:       jest.fn(),
  addChatMessage:        jest.fn(),
  updateChatSessionTitle: jest.fn(),
}));
jest.mock('~/db/repositories/audit.repository', () => ({
  logEvent: jest.fn(),
}));

import { sendMessage } from '../chat.service';
import { getSetting }  from '~/db/repositories/settings.repository';
import { providerRegistry } from '~/llm/provider-registry';
import { buildFullContext } from '~/rag/context-builder';
import {
  getChatMessages,
  addChatMessage,
  updateChatSessionTitle,
} from '~/db/repositories/chat.repository';
import { logEvent } from '~/db/repositories/audit.repository';

const mockGetSetting     = getSetting as jest.Mock;
const mockGetProvider    = providerRegistry.getProvider as jest.Mock;
const mockBuildContext   = buildFullContext as jest.Mock;
const mockGetMessages    = getChatMessages as jest.Mock;
const mockAddMessage     = addChatMessage as jest.Mock;
const mockUpdateTitle    = updateChatSessionTitle as jest.Mock;
const mockLogEvent       = logEvent as jest.Mock;

function makeMockProvider(overrides: Partial<{
  complete: () => Promise<string>;
  stream:   () => AsyncGenerator<{ delta: string; done: boolean }>;
  listModels: () => Promise<string[]>;
}> = {}) {
  return {
    name:       'openai' as const,
    complete:   overrides.complete   ?? jest.fn().mockResolvedValue('Mock response'),
    stream:     overrides.stream     ?? jest.fn(),
    embed:      jest.fn(),
    validateKey: jest.fn(),
    listModels: overrides.listModels ?? jest.fn().mockResolvedValue(['gpt-4o-mini']),
  };
}

const SESSION_ID = 'session-abc';
const USER_MSG   = 'What medications am I on?';

describe('sendMessage()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock state
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('openai');
      if (key === 'active_model')    return Promise.resolve('gpt-4o-mini');
      return Promise.resolve(null);
    });
    mockBuildContext.mockResolvedValue({ context: 'No records', fhirIds: [] });
    mockGetMessages.mockResolvedValue([]);
    mockAddMessage.mockResolvedValue('msg-1');
    mockUpdateTitle.mockResolvedValue(undefined);
    mockLogEvent.mockResolvedValue(undefined);
  });

  it('throws when no provider is configured', async () => {
    mockGetProvider.mockResolvedValue(null);
    await expect(
      sendMessage({ sessionId: SESSION_ID, userMessage: USER_MSG })
    ).rejects.toThrow(/No API key configured/);
  });

  it('calls provider.complete() when no onChunk is provided', async () => {
    const provider = makeMockProvider();
    mockGetProvider.mockResolvedValue(provider);

    const result = await sendMessage({ sessionId: SESSION_ID, userMessage: USER_MSG });

    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(result.assistantMessage).toBe('Mock response');
  });

  it('persists user message and assistant message', async () => {
    const provider = makeMockProvider();
    mockGetProvider.mockResolvedValue(provider);

    await sendMessage({ sessionId: SESSION_ID, userMessage: USER_MSG });

    expect(mockAddMessage).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mockAddMessage.mock.calls;
    expect(firstCall[0].role).toBe('user');
    expect(firstCall[0].content).toBe(USER_MSG);
    expect(secondCall[0].role).toBe('assistant');
    expect(secondCall[0].content).toBe('Mock response');
  });

  it('calls onChunk for each streaming delta', async () => {
    async function* mockStream() {
      yield { delta: 'Hello', done: false };
      yield { delta: ' World', done: false };
      yield { delta: '', done: true };
    }
    const provider = makeMockProvider({ stream: jest.fn().mockReturnValue(mockStream()) });
    mockGetProvider.mockResolvedValue(provider);

    const chunks: string[] = [];
    const result = await sendMessage({
      sessionId:   SESSION_ID,
      userMessage: USER_MSG,
      onChunk:     (c) => { if (c.delta) chunks.push(c.delta); },
    });

    expect(chunks).toEqual(['Hello', ' World']);
    expect(result.assistantMessage).toBe('Hello World');
  });

  it('calls logEvent after a successful response', async () => {
    const provider = makeMockProvider();
    mockGetProvider.mockResolvedValue(provider);

    await sendMessage({ sessionId: SESSION_ID, userMessage: USER_MSG });
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'chat_query' }));
  });

  it('falls back to flash/haiku model when stored model is not in available list', async () => {
    // Use a different provider key to avoid cache from other tests
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('gemini');
      if (key === 'active_model')    return Promise.resolve('gemini-ultra-old');
      return Promise.resolve(null);
    });
    const provider = makeMockProvider({
      listModels: jest.fn().mockResolvedValue(['gemini-1.5-flash', 'gemini-1.5-pro']),
    });
    provider.name = 'gemini' as any;
    mockGetProvider.mockResolvedValue(provider);

    await sendMessage({ sessionId: SESSION_ID, userMessage: USER_MSG });

    // The model passed to complete should be the flash fallback
    const req = (provider.complete as jest.Mock).mock.calls[0][0];
    expect(req.model).toBe('gemini-1.5-flash');
  });

  it('truncates long first message to 57 chars + "..." as session title', async () => {
    const provider = makeMockProvider();
    mockGetProvider.mockResolvedValue(provider);
    const longMessage = 'A'.repeat(100);

    await sendMessage({ sessionId: SESSION_ID, userMessage: longMessage });

    expect(mockUpdateTitle).toHaveBeenCalledWith(
      SESSION_ID,
      'A'.repeat(57) + '...'
    );
  });

  it('uses message as-is for titles ≤ 60 chars', async () => {
    const provider = makeMockProvider();
    mockGetProvider.mockResolvedValue(provider);
    const shortMessage = 'Short question?';

    await sendMessage({ sessionId: SESSION_ID, userMessage: shortMessage });
    expect(mockUpdateTitle).toHaveBeenCalledWith(SESSION_ID, shortMessage);
  });

  it('returns fhirIdsUsed from context builder', async () => {
    const provider = makeMockProvider();
    mockGetProvider.mockResolvedValue(provider);
    mockBuildContext.mockResolvedValue({ context: 'records', fhirIds: ['id-1', 'id-2'] });

    const result = await sendMessage({ sessionId: SESSION_ID, userMessage: USER_MSG });
    expect(result.fhirIdsUsed).toEqual(['id-1', 'id-2']);
  });
});
