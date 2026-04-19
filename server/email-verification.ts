import { generateSixDigitCode, sha256Hex, type OneTimeToken } from './one-time-token.js';

export const VERIFICATION_TTL_MS = 30 * 60 * 1000; // 30m
export const VERIFICATION_MAX_ATTEMPTS = 5;

export function generateVerificationCode(): OneTimeToken {
  return generateSixDigitCode(VERIFICATION_TTL_MS);
}

export function hashCode(code: string): string {
  return sha256Hex(code);
}
