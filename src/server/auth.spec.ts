// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  COOKIE_NAME,
  clearAuthCookie,
  hashPassword,
  isRole,
  readCookie,
  requireAuth,
  requireRole,
  setAuthCookie,
  signJwt,
  signMfaChallenge,
  verifyJwt,
  verifyMfaChallenge,
  verifyPassword,
  type AuthPayload,
} from './auth.js';

describe('isRole', () => {
  it('accepts the three canonical roles', () => {
    expect(isRole('root')).toBe(true);
    expect(isRole('researcher')).toBe(true);
    expect(isRole('patient')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isRole('admin')).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(123)).toBe(false);
    expect(isRole('')).toBe(false);
  });
});

describe('password hashing', () => {
  it('verifies a password against its hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$argon2/);
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('pw-1');
    expect(await verifyPassword(hash, 'pw-2')).toBe(false);
  });

  it('returns false (not throws) when the hash is malformed', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('JWT round-trip', () => {
  const payload: AuthPayload = { sub: 'u1', email: 'a@b.c', role: 'patient', confirmed: true };

  it('signs and verifies a well-formed payload', async () => {
    const token = await signJwt(payload);
    const verified = await verifyJwt(token);
    expect(verified).toEqual(payload);
  });

  it('returns null on garbage', async () => {
    expect(await verifyJwt('garbage.token.here')).toBeNull();
  });

  it('returns null when shape is malformed (missing role)', async () => {
    // A valid JWT signed with our secret but lacking `role`.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode('x'.repeat(64));
    const token = await new SignJWT({ sub: 'u1', email: 'a@b.c', confirmed: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('pluma')
      .setAudience('pluma-admin')
      .setExpirationTime('1h')
      .sign(secret);
    expect(await verifyJwt(token)).toBeNull();
  });
});

describe('MFA challenge', () => {
  it('signs + verifies a userId', async () => {
    const token = await signMfaChallenge('user-1');
    expect(await verifyMfaChallenge(token)).toBe('user-1');
  });

  it('returns null on a non-MFA-audience token', async () => {
    const authJwt = await signJwt({ sub: 'u', email: 'a@b.c', role: 'patient', confirmed: true });
    expect(await verifyMfaChallenge(authJwt)).toBeNull();
  });

  it('returns null on garbage', async () => {
    expect(await verifyMfaChallenge('not-a-jwt')).toBeNull();
  });
});

describe('cookie helpers', () => {
  function makeRes() {
    const calls = { cookie: [] as unknown[], clearCookie: [] as unknown[] };
    const res = {
      cookie: (name: string, value: string, opts: unknown) => {
        calls.cookie.push({ name, value, opts });
      },
      clearCookie: (name: string, opts: unknown) => {
        calls.clearCookie.push({ name, opts });
      },
    } as unknown as Response;
    return { res, calls };
  }

  it('setAuthCookie uses HttpOnly + SameSite=strict', () => {
    const { res, calls } = makeRes();
    setAuthCookie(res, 'tok');
    expect(calls.cookie).toHaveLength(1);
    const call = calls.cookie[0] as { name: string; value: string; opts: Record<string, unknown> };
    expect(call.name).toBe(COOKIE_NAME);
    expect(call.value).toBe('tok');
    expect(call.opts['httpOnly']).toBe(true);
    expect(call.opts['sameSite']).toBe('strict');
    expect(call.opts['path']).toBe('/');
  });

  it('clearAuthCookie clears by name at path /', () => {
    const { res, calls } = makeRes();
    clearAuthCookie(res);
    expect(calls.clearCookie).toHaveLength(1);
  });

  it('readCookie extracts the named value from a header string', () => {
    expect(readCookie('a=1; b=2', 'b')).toBe('2');
    expect(readCookie(COOKIE_NAME + '=tok.en.foo', COOKIE_NAME)).toBe('tok.en.foo');
  });

  it('readCookie returns undefined for missing header or name', () => {
    expect(readCookie(undefined, 'anything')).toBeUndefined();
    expect(readCookie('a=1', 'b')).toBeUndefined();
  });

  it('readCookie preserves = within the cookie value', () => {
    expect(readCookie('tok=aa=bb=', 'tok')).toBe('aa=bb=');
  });
});

describe('requireAuth / requireRole middleware', () => {
  function invoke(handler: (req: Request, res: Response, next: NextFunction) => void, auth: unknown) {
    const req = { auth } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();
    handler(req, res, next);
    return { status, json, next };
  }

  it('requireAuth lets confirmed users through', () => {
    const { next } = invoke(requireAuth, {
      sub: 'u', email: 'a@b.c', role: 'patient', confirmed: true,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requireAuth rejects missing auth with 401', () => {
    const { status, next } = invoke(requireAuth, null);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('requireAuth rejects unconfirmed users with 403', () => {
    const { status, next } = invoke(requireAuth, {
      sub: 'u', email: 'a@b.c', role: 'patient', confirmed: false,
    });
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('requireRole allows the matching role', () => {
    const { next } = invoke(requireRole('root', 'researcher'), {
      sub: 'u', email: 'a@b.c', role: 'researcher', confirmed: true,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requireRole rejects wrong role with 403', () => {
    const { status, next } = invoke(requireRole('root'), {
      sub: 'u', email: 'a@b.c', role: 'patient', confirmed: true,
    });
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('requireRole rejects unauthenticated with 401', () => {
    const { status } = invoke(requireRole('patient'), null);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('requireRole rejects unconfirmed with 403', () => {
    const { status } = invoke(requireRole('patient'), {
      sub: 'u', email: 'a@b.c', role: 'patient', confirmed: false,
    });
    expect(status).toHaveBeenCalledWith(403);
  });
});
