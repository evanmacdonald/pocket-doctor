jest.mock('~/db/client', () => require('../../../__mocks__/db-client'));

import { upsertFhirResource, getFhirResourceById, getFhirResourcesByType, softDeleteFhirResource } from '../fhir.repository';
import { mockDb, resetMockDb } from '../../../__mocks__/db-client';

const sampleResource = {
  resourceType: 'Condition',
  resourceJson: JSON.stringify({ code: { text: 'Hypertension' }, onsetDateTime: '2024-01-01' }),
  sourceDocumentId: 'doc-1',
};

const savedRow = {
  id: 'res-1',
  resourceType: 'Condition',
  resourceJson: sampleResource.resourceJson,
  contentHash:  'Condition:abc123',
  isDeleted:    0,
  createdAt:    1000,
  updatedAt:    1000,
  sourceDocumentId: 'doc-1',
  portalId:     null,
  effectiveDate: null,
  resourceId:   null,
};

describe('upsertFhirResource()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('returns existing row without inserting when contentHash matches', async () => {
    // findFirst returns an existing row → dedup path
    (mockDb.query.fhirResources.findFirst as jest.Mock).mockResolvedValueOnce(savedRow);

    const result = await upsertFhirResource(sampleResource);
    expect(result).toEqual(savedRow);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('inserts a new row when no duplicate exists', async () => {
    // First findFirst (dedup check) returns undefined; second findFirst (after insert) returns saved row
    (mockDb.query.fhirResources.findFirst as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(savedRow);

    const result = await upsertFhirResource(sampleResource);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(result).toEqual(savedRow);
  });

  it('throws if the saved row cannot be retrieved after insert', async () => {
    (mockDb.query.fhirResources.findFirst as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined); // save failed

    await expect(upsertFhirResource(sampleResource)).rejects.toThrow(
      /Failed to retrieve FHIR resource after upsert/
    );
  });
});

describe('getFhirResourceById()', () => {
  beforeEach(() => resetMockDb());

  it('calls findFirst', async () => {
    (mockDb.query.fhirResources.findFirst as jest.Mock).mockResolvedValueOnce(savedRow);
    const result = await getFhirResourceById('res-1');
    expect(result).toEqual(savedRow);
    expect(mockDb.query.fhirResources.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when not found', async () => {
    (mockDb.query.fhirResources.findFirst as jest.Mock).mockResolvedValueOnce(undefined);
    expect(await getFhirResourceById('missing')).toBeUndefined();
  });
});

describe('getFhirResourcesByType()', () => {
  beforeEach(() => resetMockDb());

  it('calls findMany with the given resource type', async () => {
    (mockDb.query.fhirResources.findMany as jest.Mock).mockResolvedValueOnce([savedRow]);
    const results = await getFhirResourcesByType('Condition');
    expect(results).toEqual([savedRow]);
    expect(mockDb.query.fhirResources.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when none found', async () => {
    (mockDb.query.fhirResources.findMany as jest.Mock).mockResolvedValueOnce([]);
    expect(await getFhirResourcesByType('Observation')).toEqual([]);
  });
});

describe('softDeleteFhirResource()', () => {
  beforeEach(() => resetMockDb());

  it('calls update with isDeleted: 1', async () => {
    await softDeleteFhirResource('res-1');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    const setArg = (mockDb.update as jest.Mock).mock.results[0].value.set.mock.calls[0][0];
    expect(setArg).toMatchObject({ isDeleted: 1 });
  });
});
