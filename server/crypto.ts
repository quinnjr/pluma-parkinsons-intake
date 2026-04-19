import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Envelope layout (base64): version(1) || iv(12) || tag(16) || ciphertext(n)
const CIPHER = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 0x01;

const SALT_LABEL = 'pluma-parkinsons-intake/kdf-v1';

export class CryptoService {
  private readonly key: Buffer;

  constructor(secret: string, saltLabel: string = SALT_LABEL) {
    if (!secret || secret.length < 16) {
      throw new Error(
        'ENCRYPTION_SECRET must be set and at least 16 characters. Generate one with `openssl rand -base64 32`.',
      );
    }
    this.key = scryptSync(secret, saltLabel, KEY_LEN);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(CIPHER, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]).toString('base64');
  }

  decrypt(envelope: string): string {
    const buf = Buffer.from(envelope, 'base64');
    if (buf.length < 1 + IV_LEN + TAG_LEN) throw new Error('Ciphertext envelope too short');
    const version = buf[0];
    if (version !== VERSION) throw new Error(`Unsupported envelope version: ${version}`);
    const iv = buf.subarray(1, 1 + IV_LEN);
    const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const ct = buf.subarray(1 + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(CIPHER, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}

export function cryptoFromEnv(): CryptoService {
  const secret = process.env['ENCRYPTION_SECRET'];
  if (!secret) {
    throw new Error(
      'ENCRYPTION_SECRET is not set. Add it to .env (e.g. ENCRYPTION_SECRET=$(openssl rand -base64 32)).',
    );
  }
  return new CryptoService(secret);
}
