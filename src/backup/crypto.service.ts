// ─── Encryption / Decryption Service ─────────────────────────────────────────
// Uses AES-256-GCM with PBKDF2 key derivation.
// react-native-quick-crypto provides the Node crypto-compatible API via JSI.

// @ts-ignore — react-native-quick-crypto is a drop-in crypto module
import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEYLEN     = 32;  // 256 bits
const PBKDF2_DIGEST     = 'sha256';
const SALT_BYTES        = 32;
const IV_BYTES          = 12;  // 96 bits — GCM standard

export interface EncryptedBundle {
  v:    number;
  salt: string;
  iv:   string;
  ct:   string;
  tag:  string;
}

/**
 * Encrypt a plaintext string with a user-supplied passphrase.
 * Returns a JSON-serialisable object containing all parameters needed for decryption.
 */
export function encrypt(plaintext: string, passphrase: string): EncryptedBundle {
  const salt = randomBytes(SALT_BYTES);
  const iv   = randomBytes(IV_BYTES);
  const key  = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    v:    1,
    salt: salt.toString('base64'),
    iv:   iv.toString('base64'),
    ct:   ct.toString('base64'),
    tag:  tag.toString('base64'),
  };
}

/**
 * Decrypt an EncryptedBundle with the same passphrase used to encrypt it.
 * Throws if the passphrase is wrong or the data has been tampered with.
 */
export function decrypt(bundle: EncryptedBundle, passphrase: string): string {
  if (bundle.v !== 1) throw new Error(`Unsupported bundle version: ${bundle.v}`);

  const salt = Buffer.from(bundle.salt, 'base64');
  const iv   = Buffer.from(bundle.iv,   'base64');
  const ct   = Buffer.from(bundle.ct,   'base64');
  const tag  = Buffer.from(bundle.tag,  'base64');

  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}
