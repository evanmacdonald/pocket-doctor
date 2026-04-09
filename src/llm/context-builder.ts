import { getAllFhirResources } from '~/db/repositories/fhir.repository';

const MAX_FULL_CONTEXT_CHARS = 40_000; // ~10k tokens — covers even large record sets

/**
 * Build context from ALL of the patient's health records, grouped by type.
 * Equivalent to attaching all files to a ChatGPT / Claude conversation.
 */
export async function buildFullContext(): Promise<{
  context: string;
  fhirIds: string[];
}> {
  const resources = (await getAllFhirResources(500)).filter((r) => r.resourceType !== 'Patient');

  if (resources.length === 0) {
    return {
      context: 'The patient has no health records on file yet.',
      fhirIds: [],
    };
  }

  // Group by resource type for readability
  const byType = new Map<string, typeof resources>();
  for (const r of resources) {
    if (!byType.has(r.resourceType)) byType.set(r.resourceType, []);
    byType.get(r.resourceType)!.push(r);
  }

  const SECTION_LABELS: Record<string, string> = {
    Condition:            'Conditions & Diagnoses',
    Observation:          'Observations & Lab Results',
    MedicationStatement:  'Medications',
    MedicationRequest:    'Medications',
    AllergyIntolerance:   'Allergies',
    Immunization:         'Immunizations',
    Procedure:            'Procedures',
    DiagnosticReport:     'Diagnostic Reports',
  };

  const lines: string[] = ['=== Patient Health Records ==='];
  const fhirIds: string[] = [];
  let totalChars = 0;

  for (const [type, records] of byType) {
    const label = SECTION_LABELS[type] ?? type;
    lines.push(`\n--- ${label} ---`);

    for (const r of records) {
      const line = formatFhirForContext(r.resourceType, r.resourceJson, r.effectiveDate);
      if (totalChars + line.length > MAX_FULL_CONTEXT_CHARS) break;
      lines.push(line);
      fhirIds.push(r.id);
      totalChars += line.length;
    }
  }

  lines.push('\n=== End of Records ===');
  return { context: lines.join('\n'), fhirIds };
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
