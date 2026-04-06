// ─── LLM Abstraction Layer ────────────────────────────────────────────────────
// All three providers implement LLMProvider. Callers never talk to a specific
// provider directly — they use the registry to get the active provider.

export type LLMProviderName = 'openai' | 'anthropic' | 'gemini' | 'custom';

/** Providers that support vector embeddings (used for RAG/Smart Search) */
export const PROVIDERS_WITH_EMBEDDING_SUPPORT: LLMProviderName[] = ['openai', 'gemini'];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
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

// Default embedding models per provider (Anthropic doesn't support embeddings)
export const DEFAULT_EMBEDDING_MODELS: Partial<Record<LLMProviderName, string>> = {
  openai:  'text-embedding-3-small',  // 1536 dims
  gemini:  'text-embedding-004',       // 768 dims
};

// Vector dimensions per embedding model
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'text-embedding-004':     768,
};
