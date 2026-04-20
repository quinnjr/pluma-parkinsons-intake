import { signChallengeToken, verifyChallengeToken } from './challenge-token.js';

// Relying-Party configuration. Computed once from env vars (they don't change
// at runtime). `rpId` is the effective domain that scopes credentials. `origin`
// supports a comma-separated list for dev/prod parity.
let _rp: { rpID: string; rpName: string; origins: string[] } | null = null;

export function rpConfig() {
  _rp ??= {
    rpID: process.env['WEBAUTHN_RP_ID'] ?? 'localhost',
    rpName: process.env['WEBAUTHN_RP_NAME'] ?? 'Pluma',
    origins: (process.env['WEBAUTHN_ORIGIN'] ?? 'http://localhost:4000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
  return _rp;
}

export function parseTransports(csv: string | null | undefined): AuthenticatorTransport[] {
  return (csv?.split(',').filter(Boolean) ?? []) as AuthenticatorTransport[];
}

const REG_AUDIENCE = 'pluma-webauthn-register';
const AUTH_AUDIENCE = 'pluma-webauthn-authenticate';

export function signRegistrationChallenge(userId: string, challenge: string) {
  return signChallengeToken(REG_AUDIENCE, { userId, challenge });
}

export async function verifyRegistrationChallenge(
  token: string,
): Promise<{ userId: string; challenge: string } | null> {
  const p = await verifyChallengeToken(REG_AUDIENCE, token);
  if (!p || typeof p['userId'] !== 'string' || typeof p['challenge'] !== 'string') return null;
  return { userId: p['userId'], challenge: p['challenge'] };
}

export function signAuthenticationChallenge(challenge: string, userId?: string) {
  return signChallengeToken(AUTH_AUDIENCE, userId ? { challenge, userId } : { challenge });
}

export async function verifyAuthenticationChallenge(
  token: string,
): Promise<{ challenge: string; userId?: string } | null> {
  const p = await verifyChallengeToken(AUTH_AUDIENCE, token);
  if (!p || typeof p['challenge'] !== 'string') return null;
  return {
    challenge: p['challenge'],
    userId: typeof p['userId'] === 'string' ? p['userId'] : undefined,
  };
}
