import { CustomProvider } from '../custom.provider';
import { LLMAuthError, LLMNetworkError, UnsupportedOperationError } from '../../types';
import { makeJsonResponse, makeSseResponse } from './sse-helper';

const API_KEY  = 'test-key-123';
const BASE_URL = 'https://my-llm.example.com/v1';

describe('CustomProvider', () => {
  let provider: CustomProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider  = new CustomProvider(API_KEY, BASE_URL);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('strips trailing slash from base URL', async () => {
      const p = new CustomProvider(API_KEY, 'https://example.com/v1/');
      fetchMock.mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: '' } }] }));
      await p.complete({ model: 'llama3', messages: [] });
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/v1/chat/completions');
    });

    it('has name "custom"', () => {
      expect(provider.name).toBe('custom');
    });
  });

  // ── complete() ──────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('returns text from choices[0].message.content', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        choices: [{ message: { content: 'Hello from custom' } }],
      }));
      const result = await provider.complete({ model: 'llama3', messages: [{ role: 'user', content: 'Hi' }] });
      expect(result).toBe('Hello from custom');
    });

    it('POSTs to {baseUrl}/chat/completions', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: '' } }] }));
      await provider.complete({ model: 'llama3', messages: [] });
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/chat/completions`);
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    });

    it('sends Authorization Bearer header', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ choices: [{ message: { content: '' } }] }));
      await provider.complete({ model: 'llama3', messages: [] });
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${API_KEY}`);
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 401));
      await expect(provider.complete({ model: 'llama3', messages: [] })).rejects.toThrow(LLMAuthError);
    });

    it('throws LLMNetworkError on 500', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 500));
      await expect(provider.complete({ model: 'llama3', messages: [] })).rejects.toThrow(LLMNetworkError);
    });

    it('throws LLMNetworkError on network failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(provider.complete({ model: 'llama3', messages: [] })).rejects.toThrow(LLMNetworkError);
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
      for await (const chunk of provider.stream({ model: 'llama3', messages: [] })) {
        chunks.push(chunk);
      }
      expect(chunks.find(c => c.delta === 'Hello')).toBeTruthy();
      expect(chunks.find(c => c.delta === ' World')).toBeTruthy();
      expect(chunks.find(c => c.done)).toBeTruthy();
    });

    it('skips malformed SSE lines without throwing', async () => {
      const sseLines = [
        'data: {bad json}',
        'data: {"choices":[{"delta":{"content":"OK"}}]}',
        'data: [DONE]',
      ];
      fetchMock.mockResolvedValue(makeSseResponse(sseLines));
      const deltas: string[] = [];
      for await (const chunk of provider.stream({ model: 'llama3', messages: [] })) {
        if (chunk.delta) deltas.push(chunk.delta);
      }
      expect(deltas).toEqual(['OK']);
    });

    it('falls back to complete() when response.body is null', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, body: null, text: jest.fn() })
        .mockResolvedValueOnce(makeJsonResponse({ choices: [{ message: { content: 'Fallback' } }] }));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'llama3', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toContain('Fallback');
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeSseResponse([], 401));
      const gen = provider.stream({ model: 'llama3', messages: [] });
      await expect(gen.next()).rejects.toThrow(LLMAuthError);
    });
  });

  // ── embed() ─────────────────────────────────────────────────────────────────

  describe('embed()', () => {
    it('throws UnsupportedOperationError', () => {
      expect(() => provider.embed({ model: 'any', input: 'test' })).toThrow(UnsupportedOperationError);
    });
  });

  // ── validateKey() ────────────────────────────────────────────────────────────

  describe('validateKey()', () => {
    it('returns true for 200', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      expect(await provider.validateKey(API_KEY)).toBe(true);
    });

    it('returns false for 401', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      expect(await provider.validateKey('bad-key')).toBe(false);
    });

    it('returns true for non-401 error status (server reachable)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403 });
      expect(await provider.validateKey(API_KEY)).toBe(true);
    });

    it('returns false on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));
      expect(await provider.validateKey(API_KEY)).toBe(false);
    });
  });

  // ── listModels() ─────────────────────────────────────────────────────────────

  describe('listModels()', () => {
    it('returns sorted model ids from /models', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        data: [{ id: 'llama3.2' }, { id: 'mistral-7b' }, { id: 'codellama' }],
      }));
      const models = await provider.listModels();
      expect(models).toEqual(['codellama', 'llama3.2', 'mistral-7b']);
    });

    it('returns [] when /models returns non-ok status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      expect(await provider.listModels()).toEqual([]);
    });

    it('returns [] on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));
      expect(await provider.listModels()).toEqual([]);
    });

    it('returns [] when data is missing from response', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}));
      expect(await provider.listModels()).toEqual([]);
    });
  });
});
