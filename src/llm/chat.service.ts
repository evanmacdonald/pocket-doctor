import { providerRegistry } from './provider-registry';
import { getSetting } from '~/db/repositories/settings.repository';
import { ftsSearch } from '~/rag/fts.service';
import { ragSearch } from '~/rag/rag.service';
import { buildContextFromFts, buildContextFromRag } from '~/rag/context-builder';
import { addChatMessage, updateChatSessionTitle } from '~/db/repositories/chat.repository';
import { logEvent } from '~/db/repositories/audit.repository';
import type { LLMProviderName } from './types';
import type { ChatCompletionChunk } from './types';

const HEALTH_SYSTEM_PROMPT = `You are a knowledgeable health assistant helping a patient understand their own medical records.

Guidelines:
- Answer based ONLY on the health records provided in context below.
- If information is not in the records, say so clearly — do not guess or hallucinate.
- Use plain, accessible language. Avoid excessive medical jargon.
- Never provide a diagnosis or treatment recommendation — you can explain what records say, but always suggest the patient consult their healthcare provider for medical decisions.
- If the patient asks about something not in their records, acknowledge it and suggest they ask their doctor.
- Be concise but thorough.

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
 * Send a user message, retrieve context from health records,
 * call the active LLM provider, and persist both messages.
 *
 * Supports streaming via the optional onChunk callback.
 */
export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const { sessionId, userMessage, onChunk } = params;

  const providerName  = await getSetting('active_provider') as LLMProviderName;
  const model         = await getSetting('active_model');
  const searchMode    = await getSetting('search_mode');
  const provider      = await providerRegistry.getProvider(providerName);

  if (!provider) {
    throw new Error(
      `No API key configured for ${providerName}. Go to Settings → API Keys to add one.`
    );
  }

  // ── 1. Retrieve relevant health record context ────────────────────────────
  let context: string;
  let fhirIds: string[];

  if (searchMode === 'rag') {
    const results = await ragSearch(userMessage, 10);
    ({ context, fhirIds } = await buildContextFromRag(results));
  } else {
    const results = await ftsSearch(userMessage, 15);
    ({ context, fhirIds } = await buildContextFromFts(results));
  }

  // ── 2. Persist user message ───────────────────────────────────────────────
  await addChatMessage({
    sessionId,
    role:    'user',
    content: userMessage,
  });

  // ── 3. Build messages array ───────────────────────────────────────────────
  const messages = [
    {
      role:    'system' as const,
      content: HEALTH_SYSTEM_PROMPT + context,
    },
    {
      role:    'user' as const,
      content: userMessage,
    },
  ];

  // ── 4. Call LLM ───────────────────────────────────────────────────────────
  let assistantMessage = '';

  if (onChunk) {
    // Streaming mode
    const stream = provider.stream({ messages, model, temperature: 0.3 });
    for await (const chunk of stream) {
      if (chunk.delta) {
        assistantMessage += chunk.delta;
        onChunk(chunk);
      }
      if (chunk.done) break;
    }
  } else {
    assistantMessage = await provider.complete({ messages, model, temperature: 0.3 });
  }

  // ── 5. Persist assistant message ──────────────────────────────────────────
  await addChatMessage({
    sessionId,
    role:           'assistant',
    content:        assistantMessage,
    contextFhirIds: JSON.stringify(fhirIds),
  });

  // Auto-title session from first exchange
  await _maybeSetSessionTitle(sessionId, userMessage);

  // ── 6. Audit log ──────────────────────────────────────────────────────────
  await logEvent({
    eventType: 'chat_query',
    metadata:  {
      provider:    providerName,
      model,
      searchMode,
      fhirIdCount: fhirIds.length,
    },
  });

  return { assistantMessage, fhirIdsUsed: fhirIds };
}

async function _maybeSetSessionTitle(sessionId: string, firstMessage: string) {
  // Truncate to a reasonable title length
  const title = firstMessage.length > 60
    ? firstMessage.slice(0, 57) + '...'
    : firstMessage;

  try {
    await updateChatSessionTitle(sessionId, title);
  } catch {
    // Non-critical — ignore
  }
}
