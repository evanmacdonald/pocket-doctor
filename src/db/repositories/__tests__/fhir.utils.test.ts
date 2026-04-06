import { fingerprintResource, extractTextContent } from '../fhir.utils';

// ─── fingerprintResource ──────────────────────────────────────────────────────

describe('fingerprintResource()', () => {
  it('returns a deterministic hash for the same input', () => {
    const json = JSON.stringify({ code: { text: 'Hypertension' }, onsetDateTime: '2024-01-01' });
    const h1 = fingerprintResource('Condition', json);
    const h2 = fingerprintResource('Condition', json);
    expect(h1).toBe(h2);
  });

  it('returns different hashes for different dates on the same Condition', () => {
    const base = { code: { text: 'Hypertension' } };
    const h1 = fingerprintResource('Condition', JSON.stringify({ ...base, onsetDateTime: '2024-01-01' }));
    const h2 = fingerprintResource('Condition', JSON.stringify({ ...base, onsetDateTime: '2024-06-01' }));
    expect(h1).not.toBe(h2);
  });

  it('returns different hashes for different Observation values', () => {
    const base = { code: { text: 'Blood pressure' }, effectiveDateTime: '2024-01-01' };
    const h1 = fingerprintResource('Observation', JSON.stringify({ ...base, valueQuantity: { value: 120, unit: 'mmHg' } }));
    const h2 = fingerprintResource('Observation', JSON.stringify({ ...base, valueQuantity: { value: 140, unit: 'mmHg' } }));
    expect(h1).not.toBe(h2);
  });

  it('prefixes the hash with the resource type', () => {
    const h = fingerprintResource('AllergyIntolerance', JSON.stringify({ code: { text: 'Peanuts' } }));
    expect(h).toMatch(/^AllergyIntolerance:/);
  });

  it('handles Immunization', () => {
    const h = fingerprintResource('Immunization', JSON.stringify({
      vaccineCode: { text: 'Influenza vaccine' },
      occurrenceDateTime: '2023-10-01',
    }));
    expect(h).toMatch(/^Immunization:/);
  });

  it('handles Procedure', () => {
    const h = fingerprintResource('Procedure', JSON.stringify({
      code: { text: 'Appendectomy' },
      performedDateTime: '2022-03-15',
    }));
    expect(h).toMatch(/^Procedure:/);
  });

  it('handles DiagnosticReport', () => {
    const h = fingerprintResource('DiagnosticReport', JSON.stringify({
      code: { text: 'CBC' },
      effectiveDateTime: '2024-02-01',
      conclusion: 'Normal',
    }));
    expect(h).toMatch(/^DiagnosticReport:/);
  });

  it('produces unsigned 32-bit hash (no negative sign)', () => {
    // generate many fingerprints to ensure >>> 0 keeps values positive
    const types = ['Condition', 'Observation', 'MedicationStatement', 'AllergyIntolerance'];
    for (const type of types) {
      const h = fingerprintResource(type, JSON.stringify({ code: { text: 'Test' } }));
      expect(h).not.toMatch(/-/); // hex portion must not be negative
    }
  });

  it('falls back to resourceType:uuid on invalid JSON', () => {
    const h = fingerprintResource('Condition', 'not-valid-json');
    expect(h).toMatch(/^Condition:[0-9a-f-]+$/);
  });

  it('handles MedicationStatement', () => {
    const json = JSON.stringify({
      medicationCodeableConcept: { text: 'Metformin 500mg' },
      dosage: [{ text: 'Once daily' }],
    });
    const h1 = fingerprintResource('MedicationStatement', json);
    const h2 = fingerprintResource('MedicationStatement', json);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^MedicationStatement:/);
  });
});

// ─── extractTextContent ───────────────────────────────────────────────────────

describe('extractTextContent()', () => {
  it('extracts Condition fields', () => {
    const json = JSON.stringify({
      code: { text: 'Type 2 Diabetes', coding: [{ display: 'T2DM' }] },
      note: [{ text: 'Well controlled' }],
      clinicalStatus: { coding: [{ code: 'active' }] },
    });
    const text = extractTextContent(json, 'Condition');
    expect(text).toContain('Condition');
    expect(text).toContain('Type 2 Diabetes');
    expect(text).toContain('T2DM');
    expect(text).toContain('Well controlled');
    expect(text).toContain('active');
  });

  it('extracts Observation fields', () => {
    const json = JSON.stringify({
      code: { text: 'Glucose', coding: [{ display: 'Blood glucose' }] },
      valueString: '95 mg/dL',
      valueQuantity: { unit: 'mg/dL' },
    });
    const text = extractTextContent(json, 'Observation');
    expect(text).toContain('Glucose');
    expect(text).toContain('95 mg/dL');
    expect(text).toContain('mg/dL');
  });

  it('extracts Medication fields', () => {
    const json = JSON.stringify({
      medicationCodeableConcept: { text: 'Lisinopril', coding: [{ display: 'Lisinopril 10mg' }] },
    });
    expect(extractTextContent(json, 'MedicationStatement')).toContain('Lisinopril');
    expect(extractTextContent(json, 'MedicationRequest')).toContain('Lisinopril');
  });

  it('extracts AllergyIntolerance fields', () => {
    const json = JSON.stringify({
      code: { text: 'Penicillin' },
      reaction: [{ description: 'Anaphylaxis' }],
    });
    const text = extractTextContent(json, 'AllergyIntolerance');
    expect(text).toContain('Penicillin');
    expect(text).toContain('Anaphylaxis');
  });

  it('extracts Immunization fields', () => {
    const json = JSON.stringify({
      vaccineCode: { text: 'COVID-19 vaccine', coding: [{ display: 'BNT162b2' }] },
    });
    const text = extractTextContent(json, 'Immunization');
    expect(text).toContain('COVID-19 vaccine');
    expect(text).toContain('BNT162b2');
  });

  it('extracts DiagnosticReport fields', () => {
    const json = JSON.stringify({
      code: { text: 'Lipid panel' },
      conclusion: 'Cholesterol elevated',
      presentedForm: [{ title: 'Lab results' }],
    });
    const text = extractTextContent(json, 'DiagnosticReport');
    expect(text).toContain('Lipid panel');
    expect(text).toContain('Cholesterol elevated');
    expect(text).toContain('Lab results');
  });

  it('falls back to default branch for unknown resource types', () => {
    const json = JSON.stringify({ code: { text: 'Something' }, text: { div: '<div>Free text</div>' } });
    const text = extractTextContent(json, 'UnknownType');
    expect(text).toContain('Something');
    expect(text).toContain('Free text'); // HTML tags stripped
  });

  it('returns resourceType on parse failure', () => {
    expect(extractTextContent('bad-json', 'Condition')).toBe('Condition');
  });

  it('skips empty/whitespace-only values', () => {
    const json = JSON.stringify({ code: { text: '' } });
    const text = extractTextContent(json, 'Condition');
    // should at least contain the resource type itself
    expect(text).toBe('Condition');
  });
});
