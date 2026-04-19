import { createHash, randomBytes, randomInt } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface OneTimeToken {
  token: string;    // plaintext — goes to the user out-of-band; never stored
  tokenHash: string; // sha256 hex; what lives in the DB
  expiresAt: Date;
}

// High-entropy URL-safe token for password-reset links.
export function generateLinkToken(ttlMs: number): OneTimeToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) };
}

// 6-digit zero-padded decimal code for email verification.
export function generateSixDigitCode(ttlMs: number): OneTimeToken {
  const token = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return { token, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) };
}
