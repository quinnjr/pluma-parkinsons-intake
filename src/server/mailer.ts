// Thin email-delivery shim. No SMTP integration yet — the operator reads codes
// and links from server logs, or (for password resets) generates links via the
// admin endpoint for out-of-band delivery. Swap `console.log` for an SMTP/SES
// call when production email is wired.

export type OneTimeKind = 'verify' | 'reset';

export function deliverOneTimeCode(kind: OneTimeKind, email: string, payload: string): void {
  const label = kind === 'verify' ? '[verify-email]' : '[password-reset]';
  console.log(`${label} ${email} → ${payload}`);
}
