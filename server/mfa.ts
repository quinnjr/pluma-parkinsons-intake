import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

const MFA_ISSUER = 'Pluma';

export function generateMfaSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: MFA_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function otpauthUrl(secret: string, label: string): string {
  return totpFor(secret, label).toString();
}

export async function qrDataUrl(otpauth: string): Promise<string> {
  return QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
}

// Accept one period of clock skew on either side.
export function verifyTotp(secret: string, code: string): boolean {
  const totp = totpFor(secret, 'verify');
  return totp.validate({ token: code, window: 1 }) !== null;
}
