import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { signChallengeToken, verifyChallengeToken } from './challenge-token.js';

export type Role = 'root' | 'researcher' | 'patient';
const ALL_ROLES: readonly Role[] = ['root', 'researcher', 'patient'];

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ALL_ROLES as readonly string[]).includes(v);
}

export interface AuthPayload {
  sub: string;
  email: string;
  role: Role;
  confirmed: boolean;
}

export const COOKIE_NAME = 'pluma_jwt';
const JWT_ISSUER = 'pluma';
const JWT_AUDIENCE = 'pluma-admin';
// § 164.312(a)(2)(iii) automatic logoff. 8 hours balances the PHI-risk of
// long-lived sessions against usability for a clinician filling out intake.
// Overridable via env for operators with stricter policies.
const JWT_TTL_SECONDS = Number(process.env['JWT_TTL_SECONDS'] ?? 8 * 60 * 60);

function getJwtSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export async function signJwt(payload: AuthPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

const MFA_CHALLENGE_AUDIENCE = 'pluma-mfa-challenge';

export function signMfaChallenge(userId: string) {
  return signChallengeToken(MFA_CHALLENGE_AUDIENCE, { sub: userId });
}

export async function verifyMfaChallenge(token: string): Promise<string | null> {
  const p = await verifyChallengeToken(MFA_CHALLENGE_AUDIENCE, token);
  return p && typeof p['sub'] === 'string' ? p['sub'] : null;
}

export async function verifyJwt(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (
      typeof payload['sub'] !== 'string' ||
      typeof payload['email'] !== 'string' ||
      !isRole(payload['role']) ||
      typeof payload['confirmed'] !== 'boolean'
    ) {
      return null;
    }
    return {
      sub: payload['sub'],
      email: payload['email'],
      role: payload['role'],
      confirmed: payload['confirmed'],
    };
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: JWT_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

import { errBody } from './errors.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json(errBody('auth', 'unauthenticated'));
    return;
  }
  if (!req.auth.confirmed) {
    res.status(403).json(errBody('auth', 'pending confirmation'));
    return;
  }
  next();
}

export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json(errBody('auth', 'unauthenticated'));
      return;
    }
    if (!req.auth.confirmed) {
      res.status(403).json(errBody('auth', 'pending confirmation'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json(errBody('auth', 'role not allowed'));
      return;
    }
    next();
  };
}
