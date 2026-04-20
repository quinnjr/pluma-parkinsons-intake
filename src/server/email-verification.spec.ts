import { describe, expect, it } from 'vitest';
import {
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_TTL_MS,
  generateVerificationCode,
  hashCode,
} from './email-verification.js';
import { sha256Hex } from './one-time-token.js';

describe('email-verification', () => {
  it('exposes reasonable TTL + attempt caps', () => {
    expect(VERIFICATION_TTL_MS).toBe(30 * 60 * 1000);
    expect(VERIFICATION_MAX_ATTEMPTS).toBe(5);
  });

  it('generateVerificationCode returns a 6-digit code hashed with sha256', () => {
    const c = generateVerificationCode();
    expect(c.token).toMatch(/^\d{6}$/);
    expect(c.tokenHash).toBe(sha256Hex(c.token));
  });

  it('hashCode matches sha256Hex', () => {
    expect(hashCode('123456')).toBe(sha256Hex('123456'));
  });
});
