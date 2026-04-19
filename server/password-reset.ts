import { generateLinkToken, sha256Hex, type OneTimeToken } from './one-time-token.js';

export const RESET_TTL_MS = 60 * 60 * 1000; // 1h

export function generateResetToken(): OneTimeToken {
  return generateLinkToken(RESET_TTL_MS);
}

export function hashResetToken(token: string): string {
  return sha256Hex(token);
}
