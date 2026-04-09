import {
  LLMProvider,
  LLMProviderName,
  ChatCompletionRequest,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  LLMAuthError,
  LLMNetworkError,
} from '../types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements LLMProvider {
  readonly name: LLMProviderName = 'gemini';

  constructor(private readonly apiKey: string) {}

  async complete(req: ChatCompletionRequest): Promise<string> {
    const { systemInstruction, contents } = this._prepareContents(req);

    const res = await this._fetch(
      `/models/${req.model}:generateContent`,
      {
        systemInstruction,
        contents,
        generationConfig: this._generationConfig(req),
      }
    );

    return res.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  async *stream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk> {
    const { systemInstruction, contents } = this._prepareContents(req);

    const response = await fetch(
      `${BASE_URL}/models/${req.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction,
          contents,
          generationConfig: this._generationConfig(req),
        }),
      }
    );

    if (!response.ok) await this._throwOnError(response);

    // React Native's Hermes doesn't expose response.body as a ReadableStream —
    // fall back to a standard complete() call in that case.
    if (!response.body) {
      const text = await this.complete(req);
      yield { delta: text, done: false };
      yield { delta: '', done: true };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield { delta: '', done: true };
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (text) yield { delta: text, done: false };
        } catch {
          // malformed SSE — skip
        }
      }
    }
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];

    const res = await this._fetch(`/models/${req.model}:batchEmbedContents`, {
      requests: inputs.map((text) => ({
        model:   `models/${req.model}`,
        content: { parts: [{ text }] },
      })),
    });

    return {
      vectors:    res.embeddings.map((e: { values: number[] }) => e.values),
      tokenCount: inputs.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
    };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/models?key=${apiKey}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${BASE_URL}/models?key=${this.apiKey}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models as { name: string }[])
        .map((m) => m.name.replace('models/', ''))
        .filter((n) => n.startsWith('gemini'));
    } catch {
      return ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Build Gemini contents array from the request.
   * If fileAttachment is present, the last user turn gets an inline_data part
   * alongside (or instead of) the text content.
   */
  private _prepareContents(req: ChatCompletionRequest) {
    const messages = req.messages;
    const systemMsg = messages.find((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');

    const contents = rest.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === rest.length - 1;
      if (req.fileAttachment && isLastUser) {
        return {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: req.fileAttachment.mimeType,
                data:      req.fileAttachment.base64,
              },
            },
          ],
        };
      }
      return {
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      };
    });

    return {
      systemInstruction: systemMsg
        ? { parts: [{ text: systemMsg.content }] }
        : undefined,
      contents,
    };
  }

  private _generationConfig(req: ChatCompletionRequest) {
    return {
      maxOutputTokens: req.maxTokens ?? 4096,
      temperature:     req.temperature ?? 0,
    };
  }

  private async _fetch(path: string, body: object) {
    try {
      const res = await fetch(`${BASE_URL}${path}?key=${this.apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) await this._throwOnError(res);
      return res.json();
    } catch (err) {
      if (err instanceof LLMAuthError) throw err;
      throw new LLMNetworkError('gemini', err instanceof Error ? err : undefined);
    }
  }

  private async _throwOnError(res: Response): Promise<never> {
    if (res.status === 401 || res.status === 403) throw new LLMAuthError('gemini');
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body}`);
  }
}
