// ─── LLM Abstraction Layer ────────────────────────────────────────────────────
// All three providers implement LLMProvider. Callers never talk to a specific
// provider directly — they use the registry to get the active provider.

export type LLMProviderName = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FileAttachment {
  base64: string;
  mimeType: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  fileAttachment?: FileAttachment;
}

export interface ChatCompletionChunk {
  delta: string;
  done: boolean;
}

export interface EmbeddingRequest {
  input: string | string[];
  model: string;
}

export interface EmbeddingResponse {
  vectors: number[][];
  tokenCount: number;
}

export interface LLMProvider {
  readonly name: LLMProviderName;

  /** Blocking chat completion */
  complete(req: ChatCompletionRequest): Promise<string>;

  /** Streaming chat completion — yields chunks until done */
  stream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk>;

  /**
   * Generate embeddings.
   * Throws UnsupportedOperationError for providers that don't support it
   * (e.g., Anthropic).
   */
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;

  /**
   * Test an API key against the provider without storing it.
   * Returns true if the key is valid.
   */
  validateKey(apiKey: string): Promise<boolean>;

  /** List available model IDs for this provider */
  listModels(): Promise<string[]>;
}

export class UnsupportedOperationError extends Error {
  constructor(operation: string, provider: LLMProviderName) {
    super(`${operation} is not supported by the ${provider} provider`);
    this.name = 'UnsupportedOperationError';
  }
}

export class LLMAuthError extends Error {
  constructor(provider: LLMProviderName) {
    super(`Invalid or missing API key for ${provider}`);
    this.name = 'LLMAuthError';
  }
}

export class LLMNetworkError extends Error {
  constructor(provider: LLMProviderName, cause?: Error) {
    super(`Network error contacting ${provider}${cause ? `: ${cause.message}` : ''}`);
    this.name = 'LLMNetworkError';
    if (cause) this.cause = cause;
  }
}

// Default models per provider (cost-optimised for health record parsing)
export const DEFAULT_MODELS: Record<LLMProviderName, string> = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini:    'gemini-1.5-flash',
  custom:    '',  // no default — user must select after validation
};
