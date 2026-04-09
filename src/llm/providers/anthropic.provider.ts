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
    const { system, messages } = this._prepareMessages(req);
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
    const { system, messages } = this._prepareMessages(req);

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
      const res = await fetch(`${BASE_URL}/models`, {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': API_VERSION,
        },
      });
      return res.status !== 401;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${BASE_URL}/models`, {
        headers: this._headers(),
      });
      if (!res.ok) return this._fallbackModels();
      const data = await res.json();
      return (data.data as { id: string }[]).map((m) => m.id);
    } catch {
      return this._fallbackModels();
    }
  }

  private _fallbackModels(): string[] {
    return [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5-20251001',
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
   * If a fileAttachment is present it is added as a document/image block
   * on the last user message using the Anthropic document API.
   */
  private _prepareMessages(req: ChatCompletionRequest) {
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const rest = req.messages.filter((m) => m.role !== 'system');

    const messages = rest.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === rest.length - 1;
      if (req.fileAttachment && isLastUser) {
        const { base64, mimeType } = req.fileAttachment;
        const fileBlock = mimeType === 'application/pdf'
          ? {
              type:   'document' as const,
              source: { type: 'base64' as const, media_type: mimeType, data: base64 },
            }
          : {
              type:   'image' as const,
              source: { type: 'base64' as const, media_type: mimeType, data: base64 },
            };
        return {
          role:    'user' as const,
          content: [fileBlock],
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    return {
      system:   systemMsg?.content,
      messages,
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
