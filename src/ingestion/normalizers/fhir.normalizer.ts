import { z } from 'zod';
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

export async function normalizeTextToFhir(rawText: string): Promise<ParsedFhirBundle> {
  const providerName = await getSetting('active_provider') as LLMProviderName;
  const model        = await getSetting('active_model');
  const provider     = await providerRegistry.getProvider(providerName);

  if (!provider) {
    throw new Error(
      `No API key configured for ${providerName}. Add one in Settings to enable document ingestion.`
    );
  }

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
