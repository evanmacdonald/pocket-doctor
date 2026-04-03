import { z } from 'zod';
import * as FileSystem from 'expo-file-system/legacy';
import { providerRegistry } from '~/llm/provider-registry';
import { getSetting } from '~/db/repositories/settings.repository';
import type { LLMProviderName } from '~/llm/types';
// @types/fhir provides global type declarations — no named import needed

// ─── FHIR normalization via LLM ───────────────────────────────────────────────
// Sends raw OCR/PDF text to the LLM and asks it to return a FHIR R4 Bundle.
// The response is validated with Zod before being stored.

const MAX_INPUT_CHARS = 12000; // ~3k tokens — budget guard

const SYSTEM_PROMPT = `You are a medical record parser. Extract structured health information from the document text below and return a FHIR R4 Bundle JSON object.

Include only resources where you have sufficient information:
- Condition (diagnosis, problem list items)
- Observation (lab results, vital signs)
- MedicationStatement (current or past medications)
- AllergyIntolerance
- Immunization
- Procedure
- DiagnosticReport (lab panels, imaging reports)

Rules:
- Return ONLY valid JSON. No markdown code fences. No explanatory text before or after.
- Use resource type "Bundle" with type "collection".
- Use placeholder UUIDs for resource IDs (e.g., "urn:uuid:1").
- If a date is present, use FHIR date format (YYYY-MM-DD).
- If no structured data can be extracted, return: {"resourceType":"Bundle","type":"collection","entry":[]}
- Do not hallucinate data. Only extract what is explicitly stated.`;

// Minimal Zod schema to validate the LLM response shape
const FhirBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  type:         z.string(),
  entry:        z.array(
    z.object({
      resource: z.object({
        resourceType: z.string(),
      }).passthrough(),
    }).passthrough()
  ).default([]),
});

export type ParsedFhirBundle = z.infer<typeof FhirBundleSchema>;

const KNOWN_GOOD_MODELS: Record<string, string> = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini:    'gemini-1.5-flash',
};

async function resolveProvider(): Promise<{ provider: NonNullable<Awaited<ReturnType<typeof providerRegistry.getProvider>>>; providerName: LLMProviderName; model: string }> {
  let providerName = await getSetting('active_provider') as LLMProviderName;
  let provider     = await providerRegistry.getProvider(providerName);

  if (!provider) {
    const configured = await providerRegistry.getConfiguredProviders();
    if (configured.length === 0) {
      throw new Error(
        'No API key configured. Go to Settings → API Keys and add an OpenAI, Anthropic, or Gemini key.'
      );
    }
    providerName = configured[0];
    provider     = (await providerRegistry.getProvider(providerName))!;
  }

  // For Gemini, always use listModels to find a working model rather than
  // relying on a potentially stale stored model name.
  let model: string;
  if (providerName === 'gemini') {
    const available = await provider.listModels();
    // Prefer flash models (faster/cheaper), fall back to any available
    const preferred = available.find((m) => m.includes('flash')) ?? available[0];
    model = preferred ?? KNOWN_GOOD_MODELS.gemini;
  } else {
    model = await getSetting('active_model') || KNOWN_GOOD_MODELS[providerName] || 'gpt-4o-mini';
  }

  return { provider, providerName, model };
}

export async function normalizeTextToFhir(rawText: string): Promise<ParsedFhirBundle> {
  const { provider, model } = await resolveProvider();

  const truncated = rawText.slice(0, MAX_INPUT_CHARS);

  const response = await provider.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: truncated },
    ],
    model,
    maxTokens:   4096,
    temperature: 0, // deterministic for structured output
  });

  // Strip any accidental markdown fences the model adds
  const cleaned = response
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/,           '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const result = FhirBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`LLM returned invalid FHIR Bundle: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Send a PDF file directly to the LLM as inline binary data.
 * Gemini natively understands PDFs — no text extraction needed.
 * Falls back to normalizeTextToFhir if the active provider doesn't support inline PDF.
 */
export async function normalizePdfToFhir(filePath: string): Promise<ParsedFhirBundle> {
  const { provider, providerName, model } = await resolveProvider();

  // Only Gemini supports inline PDF — other providers need text extraction
  if (providerName !== 'gemini') {
    throw new Error(
      'PDF processing requires a Gemini API key. Go to Settings → API Keys and add one.'
    );
  }

  const base64 = await FileSystem.readAsStringAsync(filePath, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const response = await provider.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: '__PDF_INLINE__' }, // replaced by provider below
    ],
    model,
    maxTokens:   4096,
    temperature: 0,
    // Pass PDF inline data as an extension the Gemini provider handles
    _pdfBase64: base64,
  } as Parameters<typeof provider.complete>[0] & { _pdfBase64: string });

  const cleaned = response
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const result = FhirBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`LLM returned invalid FHIR Bundle: ${result.error.message}`);
  }

  return result.data;
}
