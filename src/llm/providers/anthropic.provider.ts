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

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

export class AnthropicProvider implements LLMProvider {
  readonly name: LLMProviderName = 'anthropic';

  constructor(private readonly apiKey: string) {}

  async complete(req: ChatCompletionRequest): Promise<string> {
    const { system, messages } = this._prepareMessages(req.messages);
    const res = await this._fetch('/messages', {
      model:      req.model,
      messages,
      system,
      max_tokens: req.maxTokens ?? 4096,
      ...(req.temperature !== undefined && { temperature: req.temperature }),
    });
    return res.content?.[0]?.text ?? '';
  }

  async *stream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk> {
    const { system, messages } = this._prepareMessages(req.messages);

    const response = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model:      req.model,
        messages,
        system,
        max_tokens: req.maxTokens ?? 4096,
        stream:     true,
      }),
    });

    if (!response.ok) await this._throwOnError(response);

    const reader = response.body!.getReader();
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
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta') {
            const delta = json.delta?.text ?? '';
            if (delta) yield { delta, done: false };
          } else if (json.type === 'message_stop') {
            yield { delta: '', done: true };
            return;
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  }

  /** Anthropic does not support embeddings */
  async embed(_req: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new UnsupportedOperationError('embed', 'anthropic');
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      // Send a minimal message to validate the key
      const res = await fetch(`${BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type':       'application/json',
          'x-api-key':          apiKey,
          'anthropic-version':  API_VERSION,
        },
        body: JSON.stringify({
          model:      'claude-3-5-haiku-latest',
          max_tokens: 1,
          messages:   [{ role: 'user', content: 'hi' }],
        }),
      });
      // 200 = valid, 401 = invalid key, 400 = valid key but bad request is fine too
      return res.status !== 401;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a public list models endpoint; return known models
    return [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-3-5-haiku-20241022',
      'claude-3-7-sonnet-20250219',
    ];
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _headers() {
    return {
      'Content-Type':       'application/json',
      'x-api-key':          this.apiKey,
      'anthropic-version':  API_VERSION,
    };
  }

  /**
   * Anthropic separates system messages from the messages array.
   * Extract the first system message and pass the rest as the messages array.
   */
  private _prepareMessages(messages: ChatCompletionRequest['messages']) {
    const systemMsg = messages.find((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    return {
      system:   systemMsg?.content,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  private async _fetch(path: string, body: object) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method:  'POST',
        headers: this._headers(),
        body:    JSON.stringify(body),
      });
      if (!res.ok) await this._throwOnError(res);
      return res.json();
    } catch (err) {
      if (err instanceof LLMAuthError) throw err;
      throw new LLMNetworkError('anthropic', err instanceof Error ? err : undefined);
    }
  }

  private async _throwOnError(res: Response): Promise<never> {
    if (res.status === 401) throw new LLMAuthError('anthropic');
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
}
