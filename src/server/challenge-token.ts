import { SignJWT, jwtVerify } from 'jose';

const JWT_ISSUER = 'pluma';
const CHALLENGE_TTL_SECONDS = 5 * 60;

let cachedSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  }
  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

export async function signChallengeToken(
  audience: string,
  payload: Record<string, string>,
  ttl = CHALLENGE_TTL_SECONDS,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getJwtSecret());
}

export async function verifyChallengeToken(
  audience: string,
  token: string,
): Promise<Record<string, string> | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience,
    });
    return payload as Record<string, string>;
  } catch {
    return null;
  }
}
