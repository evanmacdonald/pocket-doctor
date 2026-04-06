jest.mock('~/db/client', () => require('../../__mocks__/db-client'));
jest.mock('~/db/repositories/audit.repository', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/backup/crypto.service', () => ({
  encrypt: jest.fn().mockReturnValue({ v: 1, salt: 'salt', iv: 'iv', ct: 'ct', tag: 'tag' }),
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType:       { UTF8: 'utf8', Base64: 'base64' },
  cacheDirectory:     '/mock/cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync:        jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

import { exportHealthData } from '../export.service';
import { mockDb, resetMockDb } from '../../__mocks__/db-client';
import { logEvent } from '~/db/repositories/audit.repository';
import { encrypt } from '~/backup/crypto.service';
// Pull mocked references directly from the jest.mock factories above
// (using require to avoid top-level jest-mock hoisting issues)
const mockEncrypt  = encrypt as jest.Mock;
const mockLogEvent = logEvent as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockFileSystem = require('expo-file-system/legacy') as {
  cacheDirectory: string;
  writeAsStringAsync: jest.Mock;
  deleteAsync: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockSharing = require('expo-sharing') as { shareAsync: jest.Mock };

describe('exportHealthData()', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();

    // All DB queries return empty arrays by default
    (mockDb.query.fhirResources.findMany as jest.Mock).mockResolvedValue([]);
    (mockDb.query.documents.findMany     as jest.Mock).mockResolvedValue([]);
    (mockDb.query.chatSessions.findMany  as jest.Mock).mockResolvedValue([]);
    (mockDb.query.chatMessages.findMany  as jest.Mock).mockResolvedValue([]);
    (mockDb.query.appSettings.findMany   as jest.Mock).mockResolvedValue([]);
    (mockDb.query.auditLog.findMany      as jest.Mock).mockResolvedValue([]);
  });

  it('calls encrypt with the bundle JSON', async () => {
    await exportHealthData('test-passphrase');
    expect(mockEncrypt).toHaveBeenCalledTimes(1);
    const plaintext = mockEncrypt.mock.calls[0][0];
    const passphrase = mockEncrypt.mock.calls[0][1];
    expect(passphrase).toBe('test-passphrase');
    const bundle = JSON.parse(plaintext);
    expect(bundle.version).toBe('1.0');
    expect(bundle.payload).toBeDefined();
  });

  it('writes the encrypted output to the cache directory', async () => {
    await exportHealthData('pass');
    expect(MockFileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
    const [path] = MockFileSystem.writeAsStringAsync.mock.calls[0];
    expect(path).toContain(MockFileSystem.cacheDirectory);
    expect(path).toContain('.pdexport');
  });

  it('calls shareAsync with the written file path', async () => {
    await exportHealthData('pass');
    expect(MockSharing.shareAsync).toHaveBeenCalledTimes(1);
    const sharedPath = MockSharing.shareAsync.mock.calls[0][0];
    expect(sharedPath).toContain('.pdexport');
  });

  it('deletes the temp file after sharing', async () => {
    await exportHealthData('pass');
    expect(MockFileSystem.deleteAsync).toHaveBeenCalledTimes(1);
    const [deletedPath] = MockFileSystem.deleteAsync.mock.calls[0];
    expect(deletedPath).toContain('.pdexport');
  });

  it('logs an export_created audit event', async () => {
    await exportHealthData('pass');
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'export_created',
    }));
  });

  it('strips filePath from document rows before encrypting', async () => {
    (mockDb.query.documents.findMany as jest.Mock).mockResolvedValue([
      { id: 'doc-1', filename: 'test.pdf', filePath: '/private/path/test.pdf', ingestionStatus: 'done' },
    ]);
    await exportHealthData('pass');
    const plaintext = mockEncrypt.mock.calls[0][0];
    const bundle = JSON.parse(plaintext);
    expect(bundle.payload.documents[0].filePath).toBeUndefined();
    expect(bundle.payload.documents[0].filename).toBe('test.pdf');
  });
});
