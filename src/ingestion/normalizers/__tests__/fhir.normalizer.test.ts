jest.mock('~/llm/provider-registry', () => ({
  providerRegistry: {
    getProvider:            jest.fn(),
    getConfiguredProviders: jest.fn(),
  },
}));
jest.mock('~/db/repositories/settings.repository', () => ({
  getSetting: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType:      { UTF8: 'utf8', Base64: 'base64' },
  readAsStringAsync: jest.fn().mockResolvedValue(''),
}));

import { normalizeDocumentToFhir } from '../fhir.normalizer';
import { providerRegistry } from '~/llm/provider-registry';
import { getSetting } from '~/db/repositories/settings.repository';

const mockGetProvider   = providerRegistry.getProvider as jest.Mock;
const mockGetConfigured = providerRegistry.getConfiguredProviders as jest.Mock;
const mockGetSetting    = getSetting as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockFileSystem = require('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};
const mockReadAsString = MockFileSystem.readAsStringAsync;

const VALID_BUNDLE = JSON.stringify({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    { resource: { resourceType: 'Condition', code: { text: 'Diabetes' } } },
  ],
});

function makeProvider(name: 'openai' | 'anthropic' | 'gemini', completeFn?: () => Promise<string>) {
  return {
    name,
    complete:    completeFn ?? jest.fn().mockResolvedValue(VALID_BUNDLE),
    stream:      jest.fn(),
    embed:       jest.fn(),
    validateKey: jest.fn(),
    listModels:  jest.fn().mockResolvedValue([`${name}-model-flash`]),
  };
}

function mockSettings(provider: string, model: string) {
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'ingestion_provider') return Promise.resolve(provider);
    if (key === 'ingestion_model')    return Promise.resolve(model);
    if (key === 'active_provider')    return Promise.resolve(provider);
    if (key === 'active_model')       return Promise.resolve(model);
    return Promise.resolve(null);
  });
}

describe('normalizeDocumentToFhir() — text input', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings('openai', 'gpt-4o-mini');
  });

  it('returns a parsed FHIR bundle from a valid LLM response', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai'));
    const result = await normalizeDocumentToFhir({ rawText: 'Patient has diabetes and hypertension.' });
    expect(result.resourceType).toBe('Bundle');
    expect(result.entry).toHaveLength(1);
    expect(result.entry[0].resource.resourceType).toBe('Condition');
  });

  it('strips markdown fences from LLM response before parsing', async () => {
    const fencedBundle = '```json\n' + VALID_BUNDLE + '\n```';
    mockGetProvider.mockResolvedValue(makeProvider('openai', jest.fn().mockResolvedValue(fencedBundle)));
    const result = await normalizeDocumentToFhir({ rawText: 'Some record text' });
    expect(result.resourceType).toBe('Bundle');
  });

  it('throws on invalid JSON from LLM', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai', jest.fn().mockResolvedValue('not valid json')));
    await expect(normalizeDocumentToFhir({ rawText: 'Some text' })).rejects.toThrow(/LLM returned invalid JSON/);
  });

  it('throws when LLM returns valid JSON but not a FHIR Bundle', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai', jest.fn().mockResolvedValue('{"foo": "bar"}')));
    await expect(normalizeDocumentToFhir({ rawText: 'Some text' })).rejects.toThrow(/LLM returned invalid FHIR Bundle/);
  });

  it('throws when no provider is configured', async () => {
    mockGetProvider.mockResolvedValue(null);
    mockGetConfigured.mockResolvedValue([]);
    await expect(normalizeDocumentToFhir({ rawText: 'Some text' })).rejects.toThrow(/No API key configured/);
  });

  it('falls back to active_provider when ingestion_provider has no key', async () => {
    // ingestion_provider (openai) returns null, but anthropic is configured as active
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'ingestion_provider') return Promise.resolve('openai');
      if (key === 'active_provider')    return Promise.resolve('anthropic');
      if (key === 'ingestion_model')    return Promise.resolve('gpt-4o-mini');
      return Promise.resolve(null);
    });
    mockGetProvider
      .mockResolvedValueOnce(null)                    // openai (ingestion) has no key
      .mockResolvedValueOnce(makeProvider('anthropic')); // anthropic (active) has one
    const result = await normalizeDocumentToFhir({ rawText: 'Some text' });
    expect(result.resourceType).toBe('Bundle');
  });

  it('truncates input text to 12,000 chars', async () => {
    const longText = 'x'.repeat(20_000);
    const provider = makeProvider('openai');
    mockGetProvider.mockResolvedValue(provider);
    await normalizeDocumentToFhir({ rawText: longText });
    const calledText = (provider.complete as jest.Mock).mock.calls[0][0].messages[1].content;
    expect(calledText.length).toBeLessThanOrEqual(12_000);
  });

  it('throws when no content is provided', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai'));
    await expect(normalizeDocumentToFhir({})).rejects.toThrow(/No document content provided/);
  });
});

describe('normalizeDocumentToFhir() — file input', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings('gemini', 'gemini-1.5-flash');
  });

  it('throws when provider is OpenAI and mimeType is application/pdf', async () => {
    mockSettings('openai', 'gpt-4o-mini');
    mockGetProvider.mockResolvedValue(makeProvider('openai'));
    await expect(
      normalizeDocumentToFhir({ filePath: '/path/to/file.pdf', mimeType: 'application/pdf' })
    ).rejects.toThrow(/Gemini or Anthropic/);
  });

  it('reads the file as Base64 and passes fileAttachment to provider', async () => {
    const geminiProvider = makeProvider('gemini');
    mockGetProvider.mockResolvedValue(geminiProvider);
    mockReadAsString.mockResolvedValue('AAABBBBCCC=');

    await normalizeDocumentToFhir({ filePath: '/path/to/file.pdf', mimeType: 'application/pdf' });

    expect(mockReadAsString).toHaveBeenCalledWith('/path/to/file.pdf', expect.objectContaining({
      encoding: expect.stringContaining('base64'),
    }));
    const callArg = (geminiProvider.complete as jest.Mock).mock.calls[0][0];
    expect(callArg.fileAttachment).toEqual({ base64: 'AAABBBBCCC=', mimeType: 'application/pdf' });
  });

  it('returns a parsed FHIR bundle from provider response', async () => {
    const geminiProvider = makeProvider('gemini');
    mockGetProvider.mockResolvedValue(geminiProvider);
    mockReadAsString.mockResolvedValue('base64data');

    const result = await normalizeDocumentToFhir({ filePath: '/path/to/file.pdf', mimeType: 'application/pdf' });
    expect(result.resourceType).toBe('Bundle');
  });

  it('passes image files to OpenAI via fileAttachment', async () => {
    mockSettings('openai', 'gpt-4o-mini');
    const openaiProvider = makeProvider('openai');
    mockGetProvider.mockResolvedValue(openaiProvider);
    mockReadAsString.mockResolvedValue('imagebase64');

    await normalizeDocumentToFhir({ filePath: '/path/to/scan.jpg', mimeType: 'image/jpeg' });

    const callArg = (openaiProvider.complete as jest.Mock).mock.calls[0][0];
    expect(callArg.fileAttachment).toEqual({ base64: 'imagebase64', mimeType: 'image/jpeg' });
  });
});
