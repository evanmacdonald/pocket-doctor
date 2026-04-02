import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, AppStateStatus } from 'react-native';

// ─── Biometric Lock Service ───────────────────────────────────────────────────
// Manages the in-memory lock state. The actual data/database is never wiped —
// this is purely a UI gate enforced on foreground resume.

class BiometricService {
  private _isLocked = true;
  private _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  /** Start listening to AppState changes. Call once at app startup. */
  initialize() {
    this._appStateSubscription = AppState.addEventListener(
      'change',
      this._handleAppStateChange
    );
  }

  destroy() {
    this._appStateSubscription?.remove();
  }

  private _handleAppStateChange = (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      this.lock();
    }
  };

  get isLocked() {
    return this._isLocked;
  }

  lock() {
    this._isLocked = true;
  }

  /**
   * Prompt Face ID / Touch ID / passcode.
   * Returns true if authentication succeeded.
   */
  async authenticate(): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled  = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      // Device has no biometrics enrolled — unlock directly.
      // In production, you'd want a PIN setup flow here.
      this._isLocked = false;
      return true;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage:          'Unlock Pocket Doctor',
      fallbackLabel:          'Use Passcode',
      disableDeviceFallback:  false,
      cancelLabel:            'Cancel',
    });

    if (result.success) {
      this._isLocked = false;
      return true;
    }

    return false;
  }

  /** Check what biometric types are available on this device */
  async getSupportedTypes(): Promise<LocalAuthentication.AuthenticationType[]> {
    return LocalAuthentication.supportedAuthenticationTypesAsync();
  }
}

export const biometricService = new BiometricService();
