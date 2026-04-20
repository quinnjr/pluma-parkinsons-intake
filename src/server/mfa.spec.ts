import { describe, expect, it } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import { generateMfaSecret, otpauthUrl, qrDataUrl, verifyTotp } from './mfa.js';

describe('generateMfaSecret', () => {
  it('returns a base32 string', () => {
    const s = generateMfaSecret();
    expect(s).toMatch(/^[A-Z2-7]+=*$/);
  });

  it('produces distinct secrets on successive calls', () => {
    expect(generateMfaSecret()).not.toBe(generateMfaSecret());
  });
});

describe('otpauthUrl', () => {
  it('embeds the issuer, label, and secret', () => {
    const secret = generateMfaSecret();
    const url = otpauthUrl(secret, 'alice@example.com');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('issuer=Pluma');
    expect(url).toContain(encodeURIComponent('alice@example.com'));
    expect(url).toContain(`secret=${secret}`);
  });
});

describe('qrDataUrl', () => {
  it('returns a base64 PNG data URL', async () => {
    const url = await qrDataUrl('otpauth://totp/Pluma:test?secret=JBSWY3DPEHPK3PXP&issuer=Pluma');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(200);
  });
});

describe('verifyTotp', () => {
  it('accepts the current code generated from the same secret', () => {
    const secret = generateMfaSecret();
    const code = new TOTP({
      issuer: 'Pluma',
      label: 'verify',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    }).generate();
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('rejects an obviously wrong code', () => {
    const secret = generateMfaSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('rejects a 6-digit code from a different secret', () => {
    const a = generateMfaSecret();
    const b = generateMfaSecret();
    const codeFromB = new TOTP({
      issuer: 'Pluma',
      label: 'verify',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(b),
    }).generate();
    expect(verifyTotp(a, codeFromB)).toBe(false);
  });
});
