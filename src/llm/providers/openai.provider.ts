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

const BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements LLMProvider {
  readonly name: LLMProviderName = 'openai';

  constructor(private readonly apiKey: string) {}

  async complete(req: ChatCompletionRequest): Promise<string> {
    const res = await this._fetch('/chat/completions', {
      model:       req.model,
      messages:    req.messages,
      max_tokens:  req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0,
      stream:      false,
    });
    return res.choices?.[0]?.message?.content ?? '';
  }

  async *stream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk> {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model:       req.model,
        messages:    req.messages,
        max_tokens:  req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0,
        stream:      true,
      }),
    });

    if (!response.ok) await this._throwOnError(response);

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
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) yield { delta, done: false };
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const res = await this._fetch('/embeddings', {
      model: req.model,
      input: req.input,
    });
    return {
      vectors:    res.data.map((d: { embedding: number[] }) => d.embedding),
      tokenCount: res.usage.total_tokens,
    };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this._fetch('/models');
    return (res.data as { id: string }[])
      .map((m) => m.id)
      .filter((id) => id.startsWith('gpt-'))
      .sort();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _headers() {
    return {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${this.apiKey}`,
    };
  }

  private async _fetch(path: string, body?: object) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method:  body ? 'POST' : 'GET',
        headers: this._headers(),
        body:    body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) await this._throwOnError(res);
      return res.json();
    } catch (err) {
      if (err instanceof LLMAuthError) throw err;
      throw new LLMNetworkError('openai', err instanceof Error ? err : undefined);
    }
  }

  private async _throwOnError(res: Response): Promise<never> {
    if (res.status === 401) throw new LLMAuthError('openai');
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }
}
