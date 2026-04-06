import { AnthropicProvider } from '../anthropic.provider';
import { LLMAuthError, UnsupportedOperationError } from '../../types';
import { makeJsonResponse, makeSseResponse } from './sse-helper';

const API_KEY = 'sk-ant-test-key';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider  = new AnthropicProvider(API_KEY);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── complete() ──────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('returns text from content[0].text', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        content: [{ text: 'Hello from Anthropic' }],
      }));
      const result = await provider.complete({
        model:    'claude-3-5-haiku-latest',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result).toBe('Hello from Anthropic');
    });

    it('extracts system message to top-level system field, not in messages array', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ content: [{ text: '' }] }));
      await provider.complete({
        model: 'claude-3-5-haiku-latest',
        messages: [
          { role: 'system',    content: 'You are a doctor assistant.' },
          { role: 'user',      content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.system).toBe('You are a doctor assistant.');
      expect(body.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
      expect(body.messages).toHaveLength(2);
    });

    it('sends x-api-key and anthropic-version headers', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ content: [{ text: '' }] }));
      await provider.complete({ model: 'claude-3-5-haiku-latest', messages: [] });
      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe(API_KEY);
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 401));
      await expect(
        provider.complete({ model: 'claude-3-5-haiku-latest', messages: [] })
      ).rejects.toThrow(LLMAuthError);
    });

    it('returns empty string when content is missing', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}));
      expect(await provider.complete({ model: 'claude-3-5-haiku-latest', messages: [] })).toBe('');
    });
  });

  // ── stream() ────────────────────────────────────────────────────────────────

  describe('stream()', () => {
    it('yields delta text from content_block_delta events', async () => {
      const sseLines = [
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"text":" Anthropic"}}',
        'data: {"type":"message_stop"}',
      ];
      fetchMock.mockResolvedValue(makeSseResponse(sseLines));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'claude-3-5-haiku-latest', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toEqual(['Hello', ' Anthropic']);
    });

    it('yields done:true on message_stop', async () => {
      const sseLines = [
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
        'data: {"type":"message_stop"}',
      ];
      fetchMock.mockResolvedValue(makeSseResponse(sseLines));

      const chunks: { delta: string; done: boolean }[] = [];
      for await (const chunk of provider.stream({ model: 'claude-3-5-haiku-latest', messages: [] })) {
        chunks.push(chunk);
      }
      expect(chunks.at(-1)?.done).toBe(true);
    });

    it('falls back to complete() when response.body is null', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, body: null })
        .mockResolvedValueOnce(makeJsonResponse({ content: [{ text: 'Fallback' }] }));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'claude-3-5-haiku-latest', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toContain('Fallback');
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeSseResponse([], 401));
      const gen = provider.stream({ model: 'claude-3-5-haiku-latest', messages: [] });
      await expect(gen.next()).rejects.toThrow(LLMAuthError);
    });
  });

  // ── embed() ─────────────────────────────────────────────────────────────────

  describe('embed()', () => {
    it('throws UnsupportedOperationError', async () => {
      await expect(
        provider.embed({ model: 'any', input: 'text' })
      ).rejects.toThrow(UnsupportedOperationError);
    });
  });

  // ── validateKey() ────────────────────────────────────────────────────────────

  describe('validateKey()', () => {
    it('returns true for 200 response', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      expect(await provider.validateKey(API_KEY)).toBe(true);
    });

    it('returns false for 401 response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      expect(await provider.validateKey('bad-key')).toBe(false);
    });

    it('returns false on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('network'));
      expect(await provider.validateKey(API_KEY)).toBe(false);
    });
  });

  // ── listModels() ─────────────────────────────────────────────────────────────

  describe('listModels()', () => {
    it('returns model IDs from API response', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        data: [{ id: 'claude-opus-4-5' }, { id: 'claude-haiku-4-5-20251001' }],
      }));
      const models = await provider.listModels();
      expect(models).toContain('claude-opus-4-5');
      expect(models).toContain('claude-haiku-4-5-20251001');
    });

    it('returns fallback models list when fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('network'));
      const models = await provider.listModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.includes('claude'))).toBe(true);
    });

    it('returns fallback models when API returns non-ok status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: jest.fn() });
      const models = await provider.listModels();
      expect(models.some((m) => m.includes('claude'))).toBe(true);
    });
  });
});
