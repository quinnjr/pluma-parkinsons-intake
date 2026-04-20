import { randomBytes } from 'node:crypto';
import { sha256Hex } from './one-time-token.js';

export const RECOVERY_CODE_COUNT = 10;
// Two groups of 5 lowercase alphanumerics separated by a dash. ~46 bits of
// entropy per code, enough to resist online guessing with the per-user rate
// limit already in place on the MFA challenge path.
const HALF_LENGTH = 5;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 chars, ambiguous (0/o, 1/l) removed

export interface RecoveryCode {
  code: string;      // display form, e.g. "qr2t8-kmnb4"
  codeHash: string;
}

export function generateRecoveryCodes(): RecoveryCode[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomAlphabet(HALF_LENGTH * 2);
    return {
      code: `${raw.slice(0, HALF_LENGTH)}-${raw.slice(HALF_LENGTH)}`,
      codeHash: sha256Hex(raw),
    };
  });
}

// Users will re-type these out of an email/notes app where formatting or case
// can drift. Normalize to the canonical hash input: lowercase, strip anything
// outside the alphabet.
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(normalized: string): string {
  return sha256Hex(normalized);
}

function randomAlphabet(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}
