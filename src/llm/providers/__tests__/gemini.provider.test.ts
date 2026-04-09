import { GeminiProvider } from '../gemini.provider';
import { LLMAuthError } from '../../types';
import { makeJsonResponse, makeSseResponse } from './sse-helper';

const API_KEY = 'gemini-test-key';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider  = new GeminiProvider(API_KEY);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const GEMINI_RESPONSE = {
    candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
  };

  // ── complete() ──────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('returns text from candidates[0].content.parts[0].text', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse(GEMINI_RESPONSE));
      const result = await provider.complete({
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result).toBe('Hello from Gemini');
    });

    it('includes ?key= in the URL', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse(GEMINI_RESPONSE));
      await provider.complete({ model: 'gemini-1.5-flash', messages: [] });
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain(`?key=${API_KEY}`);
    });

    it('extracts system message to systemInstruction', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse(GEMINI_RESPONSE));
      await provider.complete({
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'system',    content: 'You are a medical AI.' },
          { role: 'user',      content: 'Hello' },
        ],
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are a medical AI.' }] });
      expect(body.contents.every((c: { role: string }) => c.role !== 'system')).toBe(true);
    });

    it('maps assistant role to model role', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse(GEMINI_RESPONSE));
      await provider.complete({
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'user',      content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const assistantTurn = body.contents.find((c: { role: string }) => c.role === 'model');
      expect(assistantTurn).toBeTruthy();
    });

    it('sends inline_data part when fileAttachment is provided', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse(GEMINI_RESPONSE));
      await provider.complete({
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Extract health records.' }],
        fileAttachment: { base64: 'AAAA', mimeType: 'application/pdf' },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const userTurn = body.contents.find((c: { role: string }) => c.role === 'user');
      expect(userTurn.parts[0].inline_data).toEqual({
        mime_type: 'application/pdf',
        data: 'AAAA',
      });
    });

    it('sends inline_data part for image fileAttachment', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse(GEMINI_RESPONSE));
      await provider.complete({
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Extract health records.' }],
        fileAttachment: { base64: 'imgdata', mimeType: 'image/jpeg' },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const userTurn = body.contents.find((c: { role: string }) => c.role === 'user');
      expect(userTurn.parts[0].inline_data).toEqual({
        mime_type: 'image/jpeg',
        data: 'imgdata',
      });
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 401));
      await expect(
        provider.complete({ model: 'gemini-1.5-flash', messages: [] })
      ).rejects.toThrow(LLMAuthError);
    });

    it('throws LLMAuthError on 403', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}, 403));
      await expect(
        provider.complete({ model: 'gemini-1.5-flash', messages: [] })
      ).rejects.toThrow(LLMAuthError);
    });
  });

  // ── stream() ────────────────────────────────────────────────────────────────

  describe('stream()', () => {
    it('yields text from candidates[0].content.parts[0].text', async () => {
      const sseLines = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" Gemini"}]}}]}',
      ];
      fetchMock.mockResolvedValue(makeSseResponse(sseLines));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'gemini-1.5-flash', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toEqual(['Hello', ' Gemini']);
    });

    it('yields done:true when stream ends', async () => {
      fetchMock.mockResolvedValue(makeSseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}',
      ]));

      let lastChunk: { delta: string; done: boolean } | null = null;
      for await (const chunk of provider.stream({ model: 'gemini-1.5-flash', messages: [] })) {
        lastChunk = chunk;
      }
      expect(lastChunk?.done).toBe(true);
    });

    it('falls back to complete() when response.body is null', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, body: null })
        .mockResolvedValueOnce(makeJsonResponse(GEMINI_RESPONSE));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ model: 'gemini-1.5-flash', messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks).toContain('Hello from Gemini');
    });

    it('throws LLMAuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeSseResponse([], 401));
      const gen = provider.stream({ model: 'gemini-1.5-flash', messages: [] });
      await expect(gen.next()).rejects.toThrow(LLMAuthError);
    });
  });

  // ── embed() ─────────────────────────────────────────────────────────────────

  describe('embed()', () => {
    it('calls batch embed endpoint and returns vectors', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        embeddings: [{ values: [0.1, 0.2, 0.3] }, { values: [0.4, 0.5, 0.6] }],
      }));
      const result = await provider.embed({
        model: 'text-embedding-004',
        input: ['hello', 'world'],
      });
      expect(result.vectors).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    });

    it('estimates tokenCount from input length', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        embeddings: [{ values: [] }],
      }));
      const result = await provider.embed({ model: 'text-embedding-004', input: 'abcd' });
      // ceil(4 chars / 4) = 1
      expect(result.tokenCount).toBe(1);
    });
  });

  // ── validateKey() ────────────────────────────────────────────────────────────

  describe('validateKey()', () => {
    it('returns true for 200 response', async () => {
      fetchMock.mockResolvedValue({ ok: true });
      expect(await provider.validateKey(API_KEY)).toBe(true);
    });

    it('URL contains ?key= query param', async () => {
      fetchMock.mockResolvedValue({ ok: true });
      await provider.validateKey('mykey');
      expect((fetchMock.mock.calls[0][0] as string)).toContain('?key=mykey');
    });

    it('returns false on non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false });
      expect(await provider.validateKey('bad-key')).toBe(false);
    });

    it('returns false on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('network'));
      expect(await provider.validateKey(API_KEY)).toBe(false);
    });
  });

  // ── listModels() ─────────────────────────────────────────────────────────────

  describe('listModels()', () => {
    it('strips models/ prefix and filters to gemini-* models', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        models: [
          { name: 'models/gemini-1.5-flash' },
          { name: 'models/gemini-1.5-pro' },
          { name: 'models/embedding-001' },
          { name: 'models/gemini-2.0-flash' },
        ],
      }));
      const models = await provider.listModels();
      expect(models).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash']);
    });

    it('returns fallback models on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('network'));
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.startsWith('gemini'))).toBe(true);
    });

    it('returns empty array on non-ok API response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });
  });
});
