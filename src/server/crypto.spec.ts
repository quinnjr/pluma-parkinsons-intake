// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CryptoService, cryptoFromEnv } from './crypto.js';

describe('CryptoService', () => {
  it('round-trips a plaintext through encrypt → decrypt', () => {
    const svc = new CryptoService('x'.repeat(32));
    const ct = svc.encrypt('hello world');
    expect(ct).not.toBe('hello world');
    expect(svc.decrypt(ct)).toBe('hello world');
  });

  it('emits a different ciphertext every time (random IV)', () => {
    const svc = new CryptoService('x'.repeat(32));
    const a = svc.encrypt('same');
    const b = svc.encrypt('same');
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe('same');
    expect(svc.decrypt(b)).toBe('same');
  });

  it('decrypts correctly through a fresh instance with the same secret', () => {
    const secret = 'x'.repeat(32);
    const ct = new CryptoService(secret).encrypt('persisted');
    const fresh = new CryptoService(secret);
    expect(fresh.decrypt(ct)).toBe('persisted');
  });

  it('fails to decrypt with a wrong secret (auth-tag mismatch)', () => {
    const ct = new CryptoService('x'.repeat(32)).encrypt('secret');
    const wrong = new CryptoService('y'.repeat(32));
    expect(() => wrong.decrypt(ct)).toThrow();
  });

  it('throws on truncated envelopes', () => {
    const svc = new CryptoService('x'.repeat(32));
    expect(() => svc.decrypt('YQ==')).toThrow(/envelope too short/);
  });

  it('throws on unknown envelope version', () => {
    const svc = new CryptoService('x'.repeat(32));
    const goodCt = svc.encrypt('hi');
    const buf = Buffer.from(goodCt, 'base64');
    buf[0] = 0x99;
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow(/envelope version/);
  });

  it('rejects construction with a too-short secret', () => {
    expect(() => new CryptoService('short')).toThrow(/ENCRYPTION_SECRET/);
    expect(() => new CryptoService('')).toThrow(/ENCRYPTION_SECRET/);
  });

  it('accepts a custom saltLabel (different key → different output)', () => {
    const a = new CryptoService('x'.repeat(32), 'salt-a');
    const b = new CryptoService('x'.repeat(32), 'salt-b');
    const ct = a.encrypt('x');
    expect(() => b.decrypt(ct)).toThrow();
  });
});

describe('cryptoFromEnv', () => {
  it('returns a working CryptoService when ENCRYPTION_SECRET is set', () => {
    const svc = cryptoFromEnv();
    const ct = svc.encrypt('via env');
    expect(svc.decrypt(ct)).toBe('via env');
  });

  it('throws when ENCRYPTION_SECRET is unset', () => {
    const saved = process.env['ENCRYPTION_SECRET'];
    delete process.env['ENCRYPTION_SECRET'];
    try {
      expect(() => cryptoFromEnv()).toThrow(/ENCRYPTION_SECRET/);
    } finally {
      process.env['ENCRYPTION_SECRET'] = saved;
    }
  });
});
