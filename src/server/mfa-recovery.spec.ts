import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './mfa-recovery.js';
import { sha256Hex } from './one-time-token.js';

describe('generateRecoveryCodes', () => {
  const codes = generateRecoveryCodes();

  it('returns exactly RECOVERY_CODE_COUNT codes', () => {
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('each code is 5-5 lowercase alphanumerics separated by a dash', () => {
    for (const { code } of codes) {
      expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    }
  });

  it('codes are unique across a batch', () => {
    const unique = new Set(codes.map((c) => c.code));
    expect(unique.size).toBe(codes.length);
  });

  it('code alphabet excludes ambiguous chars (0, 1, l, o)', () => {
    for (const { code } of codes) {
      expect(code).not.toMatch(/[01lo]/);
    }
  });

  it('codeHash matches sha256 of the normalized (dash-stripped) value', () => {
    for (const { code, codeHash } of codes) {
      expect(codeHash).toBe(sha256Hex(code.replace('-', '')));
    }
  });
});

describe('normalizeRecoveryCode', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeRecoveryCode(' QR2T8-KMNB4 ')).toBe('qr2t8kmnb4');
    expect(normalizeRecoveryCode('qr2t8 kmnb4')).toBe('qr2t8kmnb4');
    expect(normalizeRecoveryCode('qr2t8_kmnb4')).toBe('qr2t8kmnb4');
  });

  it('preserves digits and letters', () => {
    expect(normalizeRecoveryCode('abc123')).toBe('abc123');
  });
});

describe('hashRecoveryCode', () => {
  it('matches sha256Hex on the normalized form', () => {
    const normalized = normalizeRecoveryCode('qr2t8-kmnb4');
    expect(hashRecoveryCode(normalized)).toBe(sha256Hex(normalized));
  });
});
