jest.mock('~/llm/provider-registry', () => ({
  providerRegistry: {
    getProvider:          jest.fn(),
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

import { normalizeTextToFhir, normalizePdfToFhir } from '../fhir.normalizer';
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

describe('normalizeTextToFhir()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('openai');
      if (key === 'active_model')    return Promise.resolve('gpt-4o-mini');
      return Promise.resolve(null);
    });
  });

  it('returns a parsed FHIR bundle from a valid LLM response', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai'));
    const result = await normalizeTextToFhir('Patient has diabetes and hypertension.');
    expect(result.resourceType).toBe('Bundle');
    expect(result.entry).toHaveLength(1);
    expect(result.entry[0].resource.resourceType).toBe('Condition');
  });

  it('strips markdown fences from LLM response before parsing', async () => {
    const fencedBundle = '```json\n' + VALID_BUNDLE + '\n```';
    mockGetProvider.mockResolvedValue(makeProvider('openai', jest.fn().mockResolvedValue(fencedBundle)));
    const result = await normalizeTextToFhir('Some record text');
    expect(result.resourceType).toBe('Bundle');
  });

  it('throws on invalid JSON from LLM', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai', jest.fn().mockResolvedValue('not valid json')));
    await expect(normalizeTextToFhir('Some text')).rejects.toThrow(/LLM returned invalid JSON/);
  });

  it('throws when LLM returns valid JSON but not a FHIR Bundle', async () => {
    mockGetProvider.mockResolvedValue(makeProvider('openai', jest.fn().mockResolvedValue('{"foo": "bar"}')));
    await expect(normalizeTextToFhir('Some text')).rejects.toThrow(/LLM returned invalid FHIR Bundle/);
  });

  it('throws when no provider is configured', async () => {
    mockGetProvider.mockResolvedValue(null);
    mockGetConfigured.mockResolvedValue([]);
    await expect(normalizeTextToFhir('Some text')).rejects.toThrow(/No API key configured/);
  });

  it('falls back to first configured provider when active provider has no key', async () => {
    // active provider returns null, but anthropic is configured
    mockGetProvider
      .mockResolvedValueOnce(null)          // openai has no key
      .mockResolvedValueOnce(makeProvider('anthropic'));
    mockGetConfigured.mockResolvedValue(['anthropic']);
    const result = await normalizeTextToFhir('Some text');
    expect(result.resourceType).toBe('Bundle');
  });

  it('truncates input text to 12,000 chars', async () => {
    const longText = 'x'.repeat(20_000);
    const provider = makeProvider('openai');
    mockGetProvider.mockResolvedValue(provider);
    await normalizeTextToFhir(longText);
    const calledText = (provider.complete as jest.Mock).mock.calls[0][0].messages[1].content;
    expect(calledText.length).toBeLessThanOrEqual(12_000);
  });
});

describe('normalizePdfToFhir()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('gemini');
      if (key === 'active_model')    return Promise.resolve('gemini-1.5-flash');
      return Promise.resolve(null);
    });
  });

  it('throws when active provider is not Gemini', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('openai');
      if (key === 'active_model')    return Promise.resolve('gpt-4o-mini');
      return Promise.resolve(null);
    });
    mockGetProvider.mockResolvedValue(makeProvider('openai'));
    await expect(normalizePdfToFhir('/path/to/file.pdf')).rejects.toThrow(/Gemini API key/);
  });

  it('reads the file as Base64 and passes _pdfBase64 to provider', async () => {
    const geminiProvider = makeProvider('gemini');
    mockGetProvider.mockResolvedValue(geminiProvider);
    mockReadAsString.mockResolvedValue('AAABBBBCCC=');

    await normalizePdfToFhir('/path/to/file.pdf');

    expect(mockReadAsString).toHaveBeenCalledWith('/path/to/file.pdf', expect.objectContaining({
      encoding: expect.stringContaining('base64'),
    }));
    const callArg = (geminiProvider.complete as jest.Mock).mock.calls[0][0];
    expect(callArg._pdfBase64).toBe('AAABBBBCCC=');
  });

  it('returns a parsed FHIR bundle from Gemini response', async () => {
    const geminiProvider = makeProvider('gemini');
    mockGetProvider.mockResolvedValue(geminiProvider);
    mockReadAsString.mockResolvedValue('base64data');

    const result = await normalizePdfToFhir('/path/to/file.pdf');
    expect(result.resourceType).toBe('Bundle');
  });
});
