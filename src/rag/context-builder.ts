import { getFhirResourceById } from '~/db/repositories/fhir.repository';
import type { FtsResult } from './fts.service';
import type { RagResult } from './rag.service';

const MAX_CONTEXT_CHARS = 8000; // ~2k tokens at ~4 chars/token

/**
 * Build a context string from FTS results to inject into the LLM prompt.
 */
export async function buildContextFromFts(results: FtsResult[]): Promise<{
  context: string;
  fhirIds: string[];
}> {
  if (results.length === 0) {
    return { context: 'No matching health records found.', fhirIds: [] };
  }

  const fhirIds: string[] = [];
  const lines: string[] = ['--- Relevant Health Records ---'];
  let totalChars = 0;

  for (const result of results) {
    const record = await getFhirResourceById(result.fhirId);
    if (!record) continue;

    const line = formatFhirForContext(record.resourceType, record.resourceJson, record.effectiveDate);
    if (totalChars + line.length > MAX_CONTEXT_CHARS) break;

    lines.push(line);
    fhirIds.push(result.fhirId);
    totalChars += line.length;
  }

  return { context: lines.join('\n\n'), fhirIds };
}

/**
 * Build a context string from RAG (vector search) results.
 */
export async function buildContextFromRag(results: RagResult[]): Promise<{
  context: string;
  fhirIds: string[];
}> {
  if (results.length === 0) {
    return { context: 'No semantically similar health records found.', fhirIds: [] };
  }

  const fhirIds: string[] = [];
  const lines: string[] = ['--- Relevant Health Records ---'];
  let totalChars = 0;

  for (const result of results) {
    // chunkText is the pre-formatted text stored at embedding time
    const line = result.chunkText;
    if (totalChars + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    fhirIds.push(result.fhirId);
    totalChars += line.length;
  }

  return { context: lines.join('\n\n'), fhirIds };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFhirForContext(
  resourceType: string,
  resourceJson: string,
  effectiveDate?: string | null
): string {
  try {
    const r = JSON.parse(resourceJson);
    const date = effectiveDate ? ` (${effectiveDate.slice(0, 10)})` : '';

    switch (resourceType) {
      case 'Condition': {
        const name = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Unknown condition';
        const status = r.clinicalStatus?.coding?.[0]?.code ?? '';
        const note = r.note?.[0]?.text ? ` — Note: ${r.note[0].text}` : '';
        return `Condition${date}: ${name} [${status}]${note}`;
      }
      case 'Observation': {
        const name = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Unknown observation';
        const value = r.valueQuantity
          ? `${r.valueQuantity.value} ${r.valueQuantity.unit}`
          : r.valueString ?? r.valueCodeableConcept?.text ?? '';
        return `Observation${date}: ${name}${value ? ` = ${value}` : ''}`;
      }
      case 'MedicationStatement':
      case 'MedicationRequest': {
        const med = r.medicationCodeableConcept?.text
          ?? r.medicationCodeableConcept?.coding?.[0]?.display
          ?? 'Unknown medication';
        const dosage = r.dosage?.[0]?.text ? ` — ${r.dosage[0].text}` : '';
        return `Medication${date}: ${med}${dosage}`;
      }
      case 'AllergyIntolerance': {
        const allergen = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Unknown allergen';
        const reaction = r.reaction?.[0]?.description ? ` — ${r.reaction[0].description}` : '';
        return `Allergy${date}: ${allergen}${reaction}`;
      }
      case 'Immunization': {
        const vaccine = r.vaccineCode?.text ?? r.vaccineCode?.coding?.[0]?.display ?? 'Unknown vaccine';
        return `Immunization${date}: ${vaccine}`;
      }
      case 'Procedure': {
        const proc = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Unknown procedure';
        const note = r.note?.[0]?.text ? ` — ${r.note[0].text}` : '';
        return `Procedure${date}: ${proc}${note}`;
      }
      case 'DiagnosticReport': {
        const name = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Report';
        const conclusion = r.conclusion ? ` — ${r.conclusion}` : '';
        return `Diagnostic Report${date}: ${name}${conclusion}`;
      }
      default:
        return `${resourceType}${date}: ${JSON.stringify(r).slice(0, 300)}`;
    }
  } catch {
    return `${resourceType}: [parse error]`;
  }
}
