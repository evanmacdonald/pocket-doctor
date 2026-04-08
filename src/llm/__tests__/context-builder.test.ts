jest.mock('~/db/repositories/fhir.repository', () => ({
  getAllFhirResources: jest.fn(),
}));

import { buildFullContext } from '../context-builder';
import { getAllFhirResources } from '~/db/repositories/fhir.repository';

const mockGetAll = getAllFhirResources as jest.Mock;

function makeResource(overrides: Partial<{
  id: string;
  resourceType: string;
  resourceJson: string;
  effectiveDate: string | null;
}> = {}) {
  return {
    id:           overrides.id ?? 'res-1',
    resourceType: overrides.resourceType ?? 'Condition',
    resourceJson: overrides.resourceJson ?? JSON.stringify({ code: { text: 'Hypertension' }, clinicalStatus: { coding: [{ code: 'active' }] } }),
    effectiveDate: overrides.effectiveDate ?? '2024-01-15',
    isDeleted:    0,
    createdAt:    1000,
    updatedAt:    1000,
    contentHash:  'hash',
    sourceDocumentId: null,
    portalId:     null,
    resourceId:   null,
  };
}

describe('buildFullContext()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty context message when no records exist', async () => {
    mockGetAll.mockResolvedValue([]);
    const { context, fhirIds } = await buildFullContext();
    expect(context).toContain('no health records on file');
    expect(fhirIds).toEqual([]);
  });

  it('includes a Condition resource in the context', async () => {
    mockGetAll.mockResolvedValue([makeResource()]);
    const { context, fhirIds } = await buildFullContext();
    expect(context).toContain('Condition');
    expect(context).toContain('Hypertension');
    expect(context).toContain('[active]');
    expect(fhirIds).toContain('res-1');
  });

  it('includes a section header for the resource type', async () => {
    mockGetAll.mockResolvedValue([
      makeResource({ id: 'obs-1', resourceType: 'Observation', resourceJson: JSON.stringify({ code: { text: 'Glucose' }, valueQuantity: { value: 95, unit: 'mg/dL' } }) }),
    ]);
    const { context } = await buildFullContext();
    expect(context).toContain('Observations & Lab Results');
    expect(context).toContain('Glucose');
  });

  it('includes the effectiveDate in the formatted line', async () => {
    mockGetAll.mockResolvedValue([makeResource({ effectiveDate: '2024-03-22' })]);
    const { context } = await buildFullContext();
    expect(context).toContain('2024-03-22');
  });

  it('formats Medication resource correctly', async () => {
    mockGetAll.mockResolvedValue([makeResource({
      id: 'med-1',
      resourceType: 'MedicationStatement',
      resourceJson: JSON.stringify({ medicationCodeableConcept: { text: 'Metformin' }, dosage: [{ text: 'Once daily' }] }),
    })]);
    const { context } = await buildFullContext();
    expect(context).toContain('Metformin');
    expect(context).toContain('Once daily');
  });

  it('formats Allergy resource correctly', async () => {
    mockGetAll.mockResolvedValue([makeResource({
      id: 'allergy-1',
      resourceType: 'AllergyIntolerance',
      resourceJson: JSON.stringify({ code: { text: 'Penicillin' }, reaction: [{ description: 'Rash' }] }),
    })]);
    const { context } = await buildFullContext();
    expect(context).toContain('Penicillin');
    expect(context).toContain('Rash');
  });

  it('truncates context at 40,000 chars — excluded records not in fhirIds', async () => {
    // Create many large resources to push past the 40k limit
    const bigJson = JSON.stringify({ code: { text: 'x'.repeat(2000) } });
    const resources = Array.from({ length: 30 }, (_, i) =>
      makeResource({ id: `res-${i}`, resourceJson: bigJson })
    );
    mockGetAll.mockResolvedValue(resources);

    const { context, fhirIds } = await buildFullContext();
    expect(context.length).toBeLessThanOrEqual(40_100); // small tolerance for header/footer
    expect(fhirIds.length).toBeLessThan(30); // some were truncated
  });

  it('returns all IDs when well within the char limit', async () => {
    const resources = ['res-1', 'res-2', 'res-3'].map(id => makeResource({ id }));
    mockGetAll.mockResolvedValue(resources);
    const { fhirIds } = await buildFullContext();
    expect(fhirIds).toEqual(['res-1', 'res-2', 'res-3']);
  });

  it('falls back to JSON snippet for unknown resource type', async () => {
    mockGetAll.mockResolvedValue([makeResource({
      resourceType: 'CustomResource',
      resourceJson: JSON.stringify({ code: { text: 'Foo' } }),
    })]);
    const { context } = await buildFullContext();
    expect(context).toContain('CustomResource');
  });

  it('returns [parse error] for malformed resourceJson', async () => {
    mockGetAll.mockResolvedValue([{ ...makeResource(), resourceJson: 'bad-json' }]);
    const { context } = await buildFullContext();
    expect(context).toContain('[parse error]');
  });
});
