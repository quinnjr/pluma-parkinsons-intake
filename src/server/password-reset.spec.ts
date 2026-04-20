import { describe, expect, it } from 'vitest';
import { RESET_TTL_MS, generateResetToken, hashResetToken } from './password-reset.js';
import { sha256Hex } from './one-time-token.js';

describe('password-reset', () => {
  it('uses a 1-hour TTL', () => {
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('generateResetToken returns a base64url token hashed with sha256', () => {
    const t = generateResetToken();
    expect(t.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.tokenHash).toBe(sha256Hex(t.token));
  });

  it('hashResetToken matches sha256Hex', () => {
    expect(hashResetToken('raw-token')).toBe(sha256Hex('raw-token'));
  });
});
