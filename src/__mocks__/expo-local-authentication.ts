// Mock for expo-local-authentication (Face ID / Touch ID)
export const AuthenticationType = {
  FINGERPRINT:           1,
  FACIAL_RECOGNITION:    2,
  IRIS:                  3,
} as const;

export const authenticateAsync   = jest.fn().mockResolvedValue({ success: true });
export const hasHardwareAsync    = jest.fn().mockResolvedValue(true);
export const isEnrolledAsync     = jest.fn().mockResolvedValue(true);
export const supportedAuthenticationTypesAsync = jest.fn().mockResolvedValue([2]);
