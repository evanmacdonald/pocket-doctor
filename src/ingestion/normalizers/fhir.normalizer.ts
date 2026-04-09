import { z } from 'zod';
import * as FileSystem from 'expo-file-system/legacy';
import { providerRegistry } from '~/llm/provider-registry';
import { getSetting } from '~/db/repositories/settings.repository';
import type { LLMProviderName } from '~/llm/types';
// @types/fhir provides global type declarations — no named import needed

// ─── FHIR normalization via LLM ───────────────────────────────────────────────
// Sends the document (file or text) to the LLM and asks it to return a FHIR R4 Bundle.
// Files are passed as inline base64 data; the provider handles encoding per its API.

const MAX_INPUT_CHARS = 12000; // ~3k tokens — budget guard for text-only paths

const SYSTEM_PROMPT = `You are a medical record parser. Extract structured health information from the document below and return a FHIR R4 Bundle JSON object.

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
  anthropic: 'claude-3-5-sonnet-latest',
  gemini:    'gemini-1.5-flash',
};

async function resolveProvider(): Promise<{
  provider: NonNullable<Awaited<ReturnType<typeof providerRegistry.getProvider>>>;
  providerName: LLMProviderName;
  model: string;
}> {
  // Try the dedicated ingestion key first; fall back to the chat key if no
  // ingestion key is configured.
  let providerName = await getSetting('ingestion_provider') as LLMProviderName;
  let provider     = await providerRegistry.getIngestionProvider();

  if (!provider) {
    providerName = await getSetting('active_provider') as LLMProviderName;
    provider     = await providerRegistry.getActiveProvider();
  }

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

  // For Gemini, always use listModels() — model names change frequently
  let model: string;
  if (providerName === 'gemini') {
    const available = await provider.listModels();
    const preferred = available.find((m) => m.includes('flash')) ?? available[0];
    model = preferred ?? KNOWN_GOOD_MODELS.gemini;
  } else {
    model = await getSetting('ingestion_model') || KNOWN_GOOD_MODELS[providerName] || 'gpt-4o-mini';
  }

  return { provider, providerName, model };
}

function _parseResponse(response: string): ParsedFhirBundle {
  const cleaned = response
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/,           '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `LLM returned invalid JSON (length=${cleaned.length}, ends with: ${JSON.stringify(cleaned.slice(-80))}). ` +
      `Likely truncated by maxTokens. First 200 chars: ${cleaned.slice(0, 200)}`
    );
  }

  const result = FhirBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`LLM returned invalid FHIR Bundle: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Normalize a document to a FHIR R4 Bundle using the configured ingestion provider.
 *
 * @param opts.filePath - Local file URI to read and send as inline base64 data
 * @param opts.mimeType - MIME type of the file (required when filePath is provided)
 * @param opts.rawText  - Pre-extracted text (used when filePath is not available)
 */
export async function normalizeDocumentToFhir(opts: {
  filePath?: string;
  mimeType?: string;
  rawText?: string;
}): Promise<ParsedFhirBundle> {
  const { provider, providerName, model } = await resolveProvider();

  let response: string;

  if (opts.filePath && opts.mimeType) {
    // OpenAI does not support inline PDFs — images are fine via vision API
    if (providerName === 'openai' && opts.mimeType === 'application/pdf') {
      throw new Error(
        'PDF files require a Gemini or Anthropic API key for document processing. ' +
        'Go to Settings → Document Processing and configure one.'
      );
    }

    const base64 = await FileSystem.readAsStringAsync(opts.filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });

    response = await provider.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'Extract all health records from this document.' },
      ],
      model,
      maxTokens:      16384,
      temperature:    0,
      fileAttachment: { base64, mimeType: opts.mimeType },
    });
  } else if (opts.rawText) {
    const truncated = opts.rawText.slice(0, MAX_INPUT_CHARS);

    response = await provider.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: truncated },
      ],
      model,
      maxTokens:   4096,
      temperature: 0,
    });
  } else {
    throw new Error('No document content provided.');
  }

  return _parseResponse(response);
}
