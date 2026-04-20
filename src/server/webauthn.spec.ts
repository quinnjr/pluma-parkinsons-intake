// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  parseTransports,
  rpConfig,
  signAuthenticationChallenge,
  signRegistrationChallenge,
  verifyAuthenticationChallenge,
  verifyRegistrationChallenge,
} from './webauthn.js';

describe('rpConfig', () => {
  it('returns an object with rpID/rpName/origins populated', () => {
    const cfg = rpConfig();
    expect(typeof cfg.rpID).toBe('string');
    expect(cfg.rpID.length).toBeGreaterThan(0);
    expect(typeof cfg.rpName).toBe('string');
    expect(cfg.origins.length).toBeGreaterThan(0);
    expect(cfg.origins.every((o) => typeof o === 'string' && o.length > 0)).toBe(true);
  });

  it('caches the config across calls', () => {
    expect(rpConfig()).toBe(rpConfig());
  });
});

describe('parseTransports', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(parseTransports(null)).toEqual([]);
    expect(parseTransports(undefined)).toEqual([]);
    expect(parseTransports('')).toEqual([]);
  });

  it('splits comma-separated tokens and drops empties', () => {
    expect(parseTransports('usb,ble,nfc')).toEqual(['usb', 'ble', 'nfc']);
    expect(parseTransports('usb,,internal')).toEqual(['usb', 'internal']);
  });
});

describe('registration challenge round-trip', () => {
  it('accepts a well-formed token', async () => {
    const token = await signRegistrationChallenge('u1', 'abc-challenge');
    const payload = await verifyRegistrationChallenge(token);
    expect(payload).toEqual({ userId: 'u1', challenge: 'abc-challenge' });
  });

  it('rejects garbage', async () => {
    expect(await verifyRegistrationChallenge('not-a-jwt')).toBeNull();
  });

  it('rejects an authentication-audience token', async () => {
    const authToken = await signAuthenticationChallenge('c');
    expect(await verifyRegistrationChallenge(authToken)).toBeNull();
  });
});

describe('authentication challenge round-trip', () => {
  it('accepts a token with only challenge', async () => {
    const token = await signAuthenticationChallenge('challenge-1');
    const payload = await verifyAuthenticationChallenge(token);
    expect(payload).toEqual({ challenge: 'challenge-1', userId: undefined });
  });

  it('accepts a token with userId', async () => {
    const token = await signAuthenticationChallenge('challenge-2', 'user-42');
    const payload = await verifyAuthenticationChallenge(token);
    expect(payload).toEqual({ challenge: 'challenge-2', userId: 'user-42' });
  });

  it('rejects garbage', async () => {
    expect(await verifyAuthenticationChallenge('not-a-jwt')).toBeNull();
  });
});
