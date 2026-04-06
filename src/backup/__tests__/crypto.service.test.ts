// crypto.service.ts uses `import ... from 'crypto'` which jest.config.js maps
// to Node's own crypto via src/__mocks__/crypto.ts. Tests here run real AES-256-GCM
// with zero native module dependencies.

import { encrypt, decrypt, EncryptedBundle } from '../crypto.service';

describe('encrypt() / decrypt()', () => {
  const passphrase = 'correct-horse-battery-staple';
  const plaintext  = 'Hello, World! This is a medical record.';

  it('encrypt() returns a bundle with expected fields', () => {
    const bundle = encrypt(plaintext, passphrase);
    expect(bundle.v).toBe(1);
    expect(typeof bundle.salt).toBe('string');
    expect(typeof bundle.iv).toBe('string');
    expect(typeof bundle.ct).toBe('string');
    expect(typeof bundle.tag).toBe('string');
  });

  it('all fields are base64-encoded strings', () => {
    const bundle = encrypt(plaintext, passphrase);
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    expect(bundle.salt).toMatch(base64Regex);
    expect(bundle.iv).toMatch(base64Regex);
    expect(bundle.ct).toMatch(base64Regex);
    expect(bundle.tag).toMatch(base64Regex);
  });

  it('round-trips correctly — decrypt(encrypt(p, k), k) === p', () => {
    const bundle = encrypt(plaintext, passphrase);
    expect(decrypt(bundle, passphrase)).toBe(plaintext);
  });

  it('two encryptions of the same input use different salt and IV', () => {
    const b1 = encrypt(plaintext, passphrase);
    const b2 = encrypt(plaintext, passphrase);
    expect(b1.salt).not.toBe(b2.salt);
    expect(b1.iv).not.toBe(b2.iv);
  });

  it('wrong passphrase throws on decrypt', () => {
    const bundle = encrypt(plaintext, passphrase);
    expect(() => decrypt(bundle, 'wrong-passphrase')).toThrow();
  });

  it('tampered ciphertext throws on decrypt', () => {
    const bundle = encrypt(plaintext, passphrase);
    const tampered: EncryptedBundle = {
      ...bundle,
      ct: Buffer.from('AAAA' + bundle.ct, 'base64').toString('base64'),
    };
    expect(() => decrypt(tampered, passphrase)).toThrow();
  });

  it('unsupported bundle version throws immediately', () => {
    const bundle = { v: 99, salt: '', iv: '', ct: '', tag: '' };
    expect(() => decrypt(bundle as EncryptedBundle, passphrase)).toThrow('Unsupported bundle version: 99');
  });

  it('round-trips a large payload (100 KB)', () => {
    const large = 'x'.repeat(100_000);
    const bundle = encrypt(large, passphrase);
    expect(decrypt(bundle, passphrase)).toBe(large);
  });

  it('round-trips Unicode content', () => {
    const unicode = '日本語テスト — Ärztliche Befunde — Données médicales';
    expect(decrypt(encrypt(unicode, passphrase), passphrase)).toBe(unicode);
  });
});
