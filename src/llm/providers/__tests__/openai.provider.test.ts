import { OpenAIProvider } from '../openai.provider';
import { LLMAuthError, LLMNetworkError } from '../../types';
import { makeJsonResponse, makeSseResponse } from './sse-helper';

const API_KEY = 'sk-test-key';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider  = new OpenAIProvider(API_KEY);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── complete() ──────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('returns text from choices[0].message.content', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        choices: [{ message: { content: 'Hello from OpenAI' } }],
      }));
      const result = await provider.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] });
      expect(result).toBe('Hello from OpenAI');
    });

    it('sends stream: false in request body', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: '' } }] }));
      await provider.complete({ model: 'gpt-4o-mini', messages: [] });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.stream).toBe(false);
    });

    it('sends Authorization Bearer header', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: '' } }] }));
      await provider.complete({ model: 'gpt-4o-mini', messages: [] });
      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 401));
      await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(LLMAuthError);
    });

    it('throws LLMNetworkError on 500', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 500));
      await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(LLMNetworkError);
    });

    it('throws LLMNetworkError on network failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(LLMNetworkError);
    });

    it('returns empty string when choices is missing', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}));
      const result = await provider.complete({ model: 'gpt-4o-mini', messages: [] });
      expect(result).toBe('');
    });
  });

  // ── stream() ────────────────────────────────────────────────────────────────

  describe('stream()', () => {
    it('yields delta chunks and a final done chunk', async () => {
      const sseLines = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" World"}}]}',
        'data: [DONE]',
      ];
      fetchMock.mockResolvedValue(makeSseResponse(sseLines));

      const chunks: { delta: string; done: boolean }[] = [];
      for await (const chunk of provider.stream({ model: 'gpt-4o-mini', messages: [] })) {
        chunks.push(chunk);
      }

      expect(chunks.find(c => c.delta === 'Hello')).toBeTruthy();
      expect(chunks.find(c => c.delta === ' World')).toBeTruthy();
      expect(chunks.find(c => c.done)).toBeTruthy();
    });

    it('skips malformed SSE lines without throwing', async () => {
      const sseLines = [
        'data: {invalid json}',
        'data: {"choices":[{"delta":{"content":"OK"}}]}',
        'data: [DONE]',
      ];
      fetchMock.mockResolvedValue(makeSseResponse(sseLines));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'gpt-4o-mini', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toEqual(['OK']);
    });

    it('falls back to complete() when response.body is null', async () => {
      // First call (stream) returns null body; second call (complete inside fallback) returns text
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, body: null, text: jest.fn() })
        .mockResolvedValueOnce(makeJsonResponse({ choices: [{ message: { content: 'Fallback text' } }] }));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'gpt-4o-mini', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toContain('Fallback text');
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeSseResponse([], 401));
      const gen = provider.stream({ model: 'gpt-4o-mini', messages: [] });
      await expect(gen.next()).rejects.toThrow(LLMAuthError);
    });
  });

  // ── embed() ─────────────────────────────────────────────────────────────────

  describe('embed()', () => {
    it('returns vectors and tokenCount', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        data:  [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { total_tokens: 5 },
      }));
      const result = await provider.embed({ model: 'text-embedding-3-small', input: 'test' });
      expect(result.vectors).toEqual([[0.1, 0.2, 0.3]]);
      expect(result.tokenCount).toBe(5);
    });

    it('sends model and input in request body', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ data: [{ embedding: [] }], usage: { total_tokens: 1 } }));
      await provider.embed({ model: 'text-embedding-3-small', input: 'hello' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toBe('hello');
    });
  });

  // ── validateKey() ────────────────────────────────────────────────────────────

  describe('validateKey()', () => {
    it('returns true when fetch succeeds with 200', async () => {
      fetchMock.mockResolvedValue({ ok: true });
      expect(await provider.validateKey(API_KEY)).toBe(true);
    });

    it('returns false when fetch succeeds with 401', async () => {
      fetchMock.mockResolvedValue({ ok: false });
      expect(await provider.validateKey('bad-key')).toBe(false);
    });

    it('returns false on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));
      expect(await provider.validateKey(API_KEY)).toBe(false);
    });
  });

  // ── listModels() ─────────────────────────────────────────────────────────────

  describe('listModels()', () => {
    it('returns only gpt-* models, sorted', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        data: [
          { id: 'gpt-4o' },
          { id: 'text-embedding-3-small' },
          { id: 'gpt-3.5-turbo' },
          { id: 'gpt-4o-mini' },
          { id: 'whisper-1' },
        ],
      }));
      const models = await provider.listModels();
      expect(models).toEqual(['gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini']);
    });
  });
});
