import { providerRegistry } from './provider-registry';
import { getSetting } from '~/db/repositories/settings.repository';

// Cached resolved model per provider — avoids a listModels() network call on every message.
// Call clearModelCache() alongside providerRegistry.invalidate() when the active config changes.
const resolvedModelCache = new Map<string, string>();

/** Clear the resolved model cache. Call this whenever the active provider or key changes. */
export function clearModelCache(): void {
  resolvedModelCache.clear();
}
import { buildFullContext } from './context-builder';
import { addChatMessage, getChatMessages, updateChatSessionTitle } from '~/db/repositories/chat.repository';
import { logEvent } from '~/db/repositories/audit.repository';
import { DEFAULT_MODELS } from './types';
import type { LLMProviderName } from './types';
import type { ChatCompletionChunk } from './types';

const SYSTEM_PROMPT = `You are a knowledgeable, caring medical assistant. The patient's complete health records are attached below.

Your role:
- Help the patient understand their own health records in clear, plain language
- Answer questions about their conditions, medications, lab results, allergies, procedures, and immunizations
- Explain what medical terms mean, what findings typically indicate, and how different parts of their health picture relate to each other
- Point out things the patient might want to discuss with their doctor
- Be conversational and warm — like a knowledgeable friend who happens to be a physician

Ground rules:
- Base your answers on the records provided. If something isn't in the records, say so clearly.
- Never guess, hallucinate, or invent details not present in the records.
- You are not providing a formal medical opinion or diagnosis — always recommend the patient discuss treatment decisions with their healthcare provider.
- When referencing a record, be specific (e.g. "According to your records, you have a penicillin allergy noted on...")

`;

export interface SendMessageParams {
  sessionId:    string;
  userMessage:  string;
  onChunk?:     (chunk: ChatCompletionChunk) => void;
}

export interface SendMessageResult {
  assistantMessage: string;
  fhirIdsUsed:      string[];
  tokenCount?:      number;
}

/**
 * Send a user message in a chat session backed by the patient's full health
 * record context. Supports streaming via the optional onChunk callback.
 */
export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const { sessionId, userMessage, onChunk } = params;

  const [providerName, storedModel] = await Promise.all([
    getSetting('active_provider'),
    getSetting('active_model'),
  ]);

  if (!providerName) {
    throw new Error('No AI provider configured. Go to Settings → AI & Chat to add an API key.');
  }

  const provider = await providerRegistry.getProvider(providerName);
  if (!provider) {
    throw new Error('No API key configured. Go to Settings → AI & Chat to add one.');
  }

  // Stored model names go stale as providers deprecate them. Verify the stored
  // model is still available and fall back to the best available if not.
  // Result is cached per provider to avoid a listModels() call on every message.
  let model: string | null = storedModel;
  if (!resolvedModelCache.has(providerName)) {
    const available = await provider.listModels();
    if (available.length > 0) {
      const stored = available.find(m => m === storedModel);
      if (stored) {
        resolvedModelCache.set(providerName, stored);
      } else {
        // Prefer a flash/haiku tier model, otherwise take first available
        const preferred =
          available.find(m => m.includes('flash')) ??
          available.find(m => m.includes('haiku')) ??
          available[0];
        resolvedModelCache.set(providerName, preferred);
      }
    }
  }
  model = resolvedModelCache.get(providerName) ?? storedModel ?? DEFAULT_MODELS[providerName];

  // ── 1. Load all health records as context ─────────────────────────────────
  const { context, fhirIds } = await buildFullContext();

  // ── 2. Load conversation history ──────────────────────────────────────────
  const history = await getChatMessages(sessionId);
  const priorMessages = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .reverse() // getChatMessages returns DESC; we need oldest-first
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // ── 3. Build messages array ───────────────────────────────────────────────
  const messages = [
    {
      role:    'system' as const,
      content: SYSTEM_PROMPT + context,
    },
    ...priorMessages,
    {
      role:    'user' as const,
      content: userMessage,
    },
  ];

  // ── 4. Persist user message ───────────────────────────────────────────────
  await addChatMessage({
    sessionId,
    role:    'user',
    content: userMessage,
  });

  // ── 5. Call LLM ───────────────────────────────────────────────────────────
  let assistantMessage = '';

  if (onChunk) {
    const stream = provider.stream({ messages, model, temperature: 0.4 });
    for await (const chunk of stream) {
      if (chunk.delta) {
        assistantMessage += chunk.delta;
        onChunk(chunk);
      }
      if (chunk.done) break;
    }
  } else {
    assistantMessage = await provider.complete({ messages, model, temperature: 0.4 });
  }

  // ── 6. Persist assistant message ──────────────────────────────────────────
  await addChatMessage({
    sessionId,
    role:           'assistant',
    content:        assistantMessage,
    contextFhirIds: JSON.stringify(fhirIds),
  });

  // Auto-title session from first exchange
  await _maybeSetSessionTitle(sessionId, userMessage);

  // ── 7. Audit log ──────────────────────────────────────────────────────────
  await logEvent({
    eventType: 'chat_query',
    metadata:  {
      provider:    providerName,
      model,
      fhirIdCount: fhirIds.length,
    },
  });

  return { assistantMessage, fhirIdsUsed: fhirIds };
}

async function _maybeSetSessionTitle(sessionId: string, firstMessage: string) {
  const title = firstMessage.length > 60
    ? firstMessage.slice(0, 57) + '...'
    : firstMessage;
  try {
    await updateChatSessionTitle(sessionId, title);
  } catch {
    // Non-critical — ignore
  }
}
