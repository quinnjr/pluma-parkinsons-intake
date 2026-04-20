import { describe, expect, it } from 'vitest';
import { generateLinkToken, generateSixDigitCode, sha256Hex } from './one-time-token.js';

describe('sha256Hex', () => {
  it('returns the known hash for a known input', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces 64-char lowercase hex', () => {
    const hex = sha256Hex('anything');
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

describe('generateLinkToken', () => {
  it('returns a URL-safe base64 token whose hash matches sha256Hex(token)', () => {
    const t = generateLinkToken(1000);
    expect(t.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.tokenHash).toBe(sha256Hex(t.token));
  });

  it('sets expiresAt roughly ttlMs in the future', () => {
    const before = Date.now();
    const t = generateLinkToken(60_000);
    const after = Date.now();
    const expiresMs = t.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 60_000);
    expect(expiresMs).toBeLessThanOrEqual(after + 60_000);
  });

  it('emits distinct tokens on successive calls', () => {
    const a = generateLinkToken(1000);
    const b = generateLinkToken(1000);
    expect(a.token).not.toBe(b.token);
  });
});

describe('generateSixDigitCode', () => {
  it('emits a 6-digit zero-padded decimal code', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateSixDigitCode(1000);
      expect(t.token).toMatch(/^\d{6}$/);
    }
  });

  it('hash matches sha256Hex(token)', () => {
    const t = generateSixDigitCode(1000);
    expect(t.tokenHash).toBe(sha256Hex(t.token));
  });

  it('honors ttlMs on expiresAt', () => {
    const before = Date.now();
    const t = generateSixDigitCode(120_000);
    expect(t.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
  });
});
