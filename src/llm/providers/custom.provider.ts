import {
  LLMProvider,
  LLMProviderName,
  ChatCompletionRequest,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  LLMAuthError,
  LLMNetworkError,
  UnsupportedOperationError,
} from '../types';

/**
 * Custom OpenAI-compatible provider.
 * Supports any server that implements the OpenAI REST API (Ollama, LM Studio, etc.).
 * Does not support embeddings — use OpenAI or Gemini for RAG/Smart Search.
 */
export class CustomProvider implements LLMProvider {
  readonly name: LLMProviderName = 'custom';
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string, baseUrl: string) {
    // Normalize trailing slash so path concatenation is always clean
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

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
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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

  embed(_req: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new UnsupportedOperationError('embed', 'custom');
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      // A 401 means the key is explicitly rejected; anything else (including
      // 404 or 200) means the server is reachable and the key wasn't refused.
      return res.status !== 401;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this._headers(),
      });
      if (!res.ok) return [];
      const json = await res.json();
      const models = (json.data as { id: string }[] | undefined) ?? [];
      return models.map((m) => m.id).sort();
    } catch {
      // Server doesn't support /models — caller shows manual model entry
      return [];
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _headers() {
    return {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${this.apiKey}`,
    };
  }

  private async _fetch(path: string, body?: object) {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method:  body ? 'POST' : 'GET',
        headers: this._headers(),
        body:    body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) await this._throwOnError(res);
      return res.json();
    } catch (err) {
      if (err instanceof LLMAuthError) throw err;
      throw new LLMNetworkError('custom', err instanceof Error ? err : undefined);
    }
  }

  private async _throwOnError(res: Response): Promise<never> {
    if (res.status === 401) throw new LLMAuthError('custom');
    const body = await res.text();
    throw new Error(`Custom provider API error ${res.status}: ${body}`);
  }
}
