import { uuid } from '~/utils/uuid';

// ─── Deduplication fingerprint ────────────────────────────────────────────────
// Two FHIR resources are duplicates if they share the same type and semantic
// content key. We extract the most stable identifying fields (code, date, value)
// and hash them — ignoring the LLM-generated UUID which changes every run.

export function fingerprintResource(resourceType: string, resourceJson: string): string {
  try {
    const r = JSON.parse(resourceJson);

    // Pull the stable identity fields for each resource type
    const parts: (string | number | undefined)[] = [resourceType];

    // Code is common across almost all types
    const code = r.code?.text ?? r.code?.coding?.[0]?.code ?? r.code?.coding?.[0]?.display;
    parts.push(code);

    switch (resourceType) {
      case 'Condition':
        parts.push(r.onsetDateTime ?? r.recordedDate ?? r.effectiveDateTime);
        parts.push(r.clinicalStatus?.coding?.[0]?.code);
        break;
      case 'Observation':
        parts.push(r.effectiveDateTime ?? r.effectivePeriod?.start);
        parts.push(r.valueQuantity?.value, r.valueQuantity?.unit, r.valueString);
        break;
      case 'MedicationStatement':
      case 'MedicationRequest':
        parts.push(r.medicationCodeableConcept?.text ?? r.medicationCodeableConcept?.coding?.[0]?.code);
        parts.push(r.dosage?.[0]?.text ?? r.dosageInstruction?.[0]?.text);
        break;
      case 'AllergyIntolerance':
        parts.push(r.recordedDate ?? r.onsetDateTime);
        parts.push(r.reaction?.[0]?.manifestation?.[0]?.text);
        break;
      case 'Immunization':
        parts.push(r.vaccineCode?.text ?? r.vaccineCode?.coding?.[0]?.code);
        parts.push(r.occurrenceDateTime);
        break;
      case 'Procedure':
        parts.push(r.performedDateTime ?? r.performedPeriod?.start);
        break;
    }

    const key = parts.filter(Boolean).join('|').toLowerCase().replace(/\s+/g, ' ').trim();

    // Simple djb2 hash — fast, no crypto needed, collision-resistant enough for dedup
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return `${resourceType}:${hash.toString(16)}`;
  } catch {
    return `${resourceType}:${uuid()}`;
  }
}

// ─── Human-readable text extractor for FTS indexing ──────────────────────────
// Pulls the most useful text fields out of a FHIR JSON resource so the FTS
// index has something meaningful to search.

export function extractTextContent(resourceJson: string, resourceType: string): string {
  try {
    const r = JSON.parse(resourceJson);
    const parts: string[] = [];

    const push = (...vals: (string | undefined | null)[]) => {
      for (const v of vals) {
        if (v && typeof v === 'string' && v.trim()) parts.push(v.trim());
      }
    };

    push(resourceType);

    switch (resourceType) {
      case 'Condition':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.note?.[0]?.text, r.clinicalStatus?.coding?.[0]?.code);
        break;
      case 'Observation':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.valueString, r.valueQuantity?.unit, r.note?.[0]?.text);
        break;
      case 'MedicationStatement':
      case 'MedicationRequest':
        push(r.medicationCodeableConcept?.text, r.medicationCodeableConcept?.coding?.[0]?.display, r.note?.[0]?.text);
        break;
      case 'AllergyIntolerance':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.note?.[0]?.text, r.reaction?.[0]?.description);
        break;
      case 'Immunization':
        push(r.vaccineCode?.text, r.vaccineCode?.coding?.[0]?.display, r.note?.[0]?.text);
        break;
      case 'Procedure':
        push(r.code?.text, r.code?.coding?.[0]?.display, r.note?.[0]?.text);
        break;
      default:
        push(r.code?.text, r.text?.div?.replace(/<[^>]+>/g, ' '));
    }

    return parts.join(' ');
  } catch {
    return resourceType;
  }
}
