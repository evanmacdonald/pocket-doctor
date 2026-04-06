jest.mock('~/db/client', () => require('../../__mocks__/db-client'));
jest.mock('~/db/repositories/audit.repository', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/backup/crypto.service', () => ({
  decrypt: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  deleteAsync:       jest.fn().mockResolvedValue(undefined),
}));

import { importHealthData } from '../import.service';
import { mockDb, mockSqlite, resetMockDb, indexFhirResourceFts } from '../../__mocks__/db-client';
import { logEvent } from '~/db/repositories/audit.repository';
import { decrypt } from '~/backup/crypto.service';

const mockDecrypt  = decrypt as jest.Mock;
const mockLogEvent = logEvent as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockPicker = require('expo-document-picker') as { getDocumentAsync: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockFileSystem = require('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
  deleteAsync: jest.Mock;
};

const mockPicker   = MockPicker.getDocumentAsync;
const mockReadFile = MockFileSystem.readAsStringAsync;
const mockDelete   = MockFileSystem.deleteAsync;

const VALID_PAYLOAD = {
  fhirResources: [{ id: 'res-1', resource_type: 'Condition', resource_json: '{}' }],
  documents:     [],
  chatSessions:  [],
  chatMessages:  [],
  appSettings:   [],
  auditLog:      [],
};

const VALID_BUNDLE_JSON = JSON.stringify({
  version:    '1.0',
  exportedAt: '2024-01-01T00:00:00.000Z',
  payload:    VALID_PAYLOAD,
});

function setupValidPick() {
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: '/mock/cache/export.pdexport' }],
  });
  mockReadFile.mockResolvedValue('{"v":1,"salt":"s","iv":"i","ct":"c","tag":"t"}');
  mockDecrypt.mockReturnValue(VALID_BUNDLE_JSON);
}

describe('importHealthData()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  it('returns null when user cancels the picker', async () => {
    mockPicker.mockResolvedValue({ canceled: true, assets: null });
    const result = await importHealthData('pass');
    expect(result).toBeNull();
  });

  it('throws "Wrong passphrase or corrupted file" when decrypt fails', async () => {
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: '/mock/file.pdexport' }] });
    mockReadFile.mockResolvedValue('{}');
    mockDecrypt.mockImplementation(() => { throw new Error('bad decrypt'); });
    await expect(importHealthData('wrong-pass')).rejects.toThrow(/Wrong passphrase or corrupted file/);
  });

  it('throws "Invalid export file format" for malformed bundle JSON', async () => {
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: '/mock/file.pdexport' }] });
    mockReadFile.mockResolvedValue('{}');
    mockDecrypt.mockReturnValue('{"invalid": "bundle"}'); // valid JSON but wrong shape
    await expect(importHealthData('pass')).rejects.toThrow(/Invalid export file format/);
  });

  it('returns fhirCount from the payload', async () => {
    setupValidPick();
    const result = await importHealthData('pass');
    expect(result).toEqual({ fhirCount: 1 });
  });

  it('in replace mode: calls execAsync to clear tables', async () => {
    setupValidPick();
    await importHealthData('pass', 'replace');
    expect(mockSqlite.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM fhir_resources')
    );
  });

  it('in merge mode: does NOT call execAsync for DELETE', async () => {
    setupValidPick();
    await importHealthData('pass', 'merge');
    const deleteCall = (mockSqlite.execAsync as jest.Mock).mock.calls.find(
      ([sql]: [string]) => sql.includes('DELETE')
    );
    expect(deleteCall).toBeUndefined();
  });

  it('calls indexFhirResourceFts for each restored FHIR resource', async () => {
    setupValidPick();
    await importHealthData('pass', 'replace');
    expect(indexFhirResourceFts).toHaveBeenCalledWith('res-1', 'Condition', expect.any(String));
  });

  it('logs an import_completed audit event', async () => {
    setupValidPick();
    await importHealthData('pass');
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'import_completed',
    }));
  });

  it('deletes the temp file after import', async () => {
    setupValidPick();
    await importHealthData('pass');
    expect(mockDelete).toHaveBeenCalledWith('/mock/cache/export.pdexport', expect.anything());
  });
});
