// Mock for expo-file-system and expo-file-system/legacy
export const documentDirectory = '/mock/documents/';
export const cacheDirectory    = '/mock/cache/';

export const EncodingType = {
  UTF8:   'utf8',
  Base64: 'base64',
} as const;

export const readAsStringAsync  = jest.fn().mockResolvedValue('');
export const writeAsStringAsync = jest.fn().mockResolvedValue(undefined);
export const deleteAsync        = jest.fn().mockResolvedValue(undefined);
export const getInfoAsync       = jest.fn().mockResolvedValue({ exists: true, isDirectory: false, size: 0 });
export const makeDirectoryAsync = jest.fn().mockResolvedValue(undefined);
export const copyAsync          = jest.fn().mockResolvedValue(undefined);
