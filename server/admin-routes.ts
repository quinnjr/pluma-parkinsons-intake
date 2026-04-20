import { Router, type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../src/prisma/client.js';
import type { CryptoService } from './crypto.js';
import {
  COOKIE_NAME,
  type Role,
  clearAuthCookie,
  hashPassword,
  readCookie,
  requireAuth,
  requireRole,
  setAuthCookie,
  signJwt,
  signMfaChallenge,
  verifyJwt,
  verifyMfaChallenge,
  verifyPassword,
} from './auth.js';
import {
  EMAIL_RE,
  ZIP_RE,
  checkPiiKeys,
  nullable,
} from './anonymize.js';
import { audit, recentFailureCount } from './audit.js';
import { generateMfaSecret, otpauthUrl, qrDataUrl, verifyTotp } from './mfa.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './mfa-recovery.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  parseTransports,
  rpConfig,
  signAuthenticationChallenge,
  signRegistrationChallenge,
  verifyAuthenticationChallenge,
  verifyRegistrationChallenge,
} from './webauthn.js';
import { generateResetToken, hashResetToken } from './password-reset.js';
import {
  VERIFICATION_MAX_ATTEMPTS,
  generateVerificationCode,
  hashCode,
} from './email-verification.js';
import { deliverOneTimeCode } from './mailer.js';
import { errBody, issuesToErrors } from './errors.js';

// § 164.308(a)(5)(ii)(D) login monitoring. More than this many failed
// attempts for an email inside LOGIN_WINDOW_MS → lock the account out.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Verified Argon2id envelope for a dummy password. The login handler runs
// `verifyPassword` against this hash when the email doesn't exist, so the
// response time matches the real-user path and account-enumeration by timing
// is blocked. Must be a real parseable envelope — a malformed constant would
// make argon2 throw instantly and defeat the defense.
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$MtI4Na8hiXWUMSBLj+QRBw$hbHUM88aS+/yQbCfmroiM0spUP7R4ol+feioa+UahiM';

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(12).max(256),
});

const patientSignupSchema = credentialsSchema.extend({
  lookupCode: z.string().min(1).max(128).optional(),
});

// Sections + schemaVersion are intentionally absent from this patch — editing
// the markdown shouldn't wipe out the original structured section data.
const submissionPatchSchema = z
  .object({
    markdown: z
      .string()
      .min(1, 'missing')
      .refine((v) => !EMAIL_RE.test(v), { message: 'contains an email address' })
      .optional(),
    zipCode: nullable(z.string().regex(ZIP_RE, 'must be 5 digits or 5+4 format')).optional(),
    ageBand: nullable(z.string()).optional(),
    sexAtBirth: nullable(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

// Express 5 types route params as `string | string[]`; every route in this
// module takes single-segment params.
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function issueCookieForUser(
  res: Response,
  user: { id: string; email: string; role: Role; confirmed: boolean },
): Promise<void> {
  return signJwt({
    sub: user.id,
    email: user.email,
    role: user.role,
    confirmed: user.confirmed,
  }).then((token) => {
    setAuthCookie(res, token);
  });
}

// Compose the submission-ownership filter for the calling staff user:
//   root        → no filter (implicit access to everything)
//   researcher  → only records whose owner has granted them a live access row
function scopeForStaff(req: Request) {
  if (req.auth!.role === 'root') return {};
  return {
    owner: {
      grantsFromPatient: {
        some: { researcherId: req.auth!.sub, revokedAt: null },
      },
    },
  } as const;
}

// Supersedes any earlier outstanding codes for this user in a single tx so a
// resend invalidates the prior code.
async function issueVerificationCode(
  prisma: PrismaClient,
  userId: string,
  email: string,
): Promise<void> {
  const { token: code, tokenHash: codeHash, expiresAt } = generateVerificationCode();
  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerificationToken.create({ data: { userId, codeHash, expiresAt } }),
  ]);
  deliverOneTimeCode('verify', email, `code ${code} (expires ${expiresAt.toISOString()})`);
}

// Resolve the token on every request, then re-load the user from the DB so
// role flips, confirmation, and deletions take effect immediately instead of
// waiting for the JWT to expire.
export function makeLoadAuth(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (token) {
      const payload = await verifyJwt(token);
      if (payload) {
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (user) {
          req.auth = {
            sub: user.id,
            email: user.email,
            role: user.role as Role,
            confirmed: user.confirmed,
          };
        }
      }
    }
    next();
  };
}

export function adminRouter(prisma: PrismaClient, crypto: CryptoService): Router {
  const router = Router();

  // ---------- Signup / login / me / logout ----------

  router.post('/api/auth/signup', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const { email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json(errBody('email', 'already registered'));
      return;
    }

    const rootEmailRaw = process.env['ROOT_ADMIN_EMAIL'];
    const rootEmail = rootEmailRaw?.toLowerCase().trim();
    const isRootEmail = Boolean(rootEmail) && email === rootEmail;

    let role: Role = 'researcher';
    let confirmed = false;
    if (isRootEmail) {
      const rootExists = await prisma.user.findFirst({ where: { role: 'root' } });
      if (rootExists) {
        res.status(409).json(errBody('email', 'root account already exists'));
        return;
      }
      role = 'root';
      confirmed = true;
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, role, confirmed, emailVerified: false },
      select: { id: true, email: true, role: true, confirmed: true, createdAt: true },
    });
    await issueVerificationCode(prisma, user.id, user.email);
    await audit(prisma, {
      action: 'signup',
      req,
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, role: user.role },
    });
    // No cookie until the email code is verified.
    res.status(201).json({ ok: true, user, verificationRequired: true });
  });

  router.post('/api/auth/signup/patient', async (req, res) => {
    const parsed = patientSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const { email, password, lookupCode } = parsed.data;

    const rootEmail = process.env['ROOT_ADMIN_EMAIL']?.toLowerCase().trim();
    if (rootEmail && email === rootEmail) {
      res.status(409).json(errBody('email', 'reserved'));
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json(errBody('email', 'already registered'));
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, role: 'patient', confirmed: true, emailVerified: false },
      select: { id: true, email: true, role: true, confirmed: true, createdAt: true },
    });

    let claimed: { id: string; lookupCode: string } | null = null;
    if (lookupCode) {
      // Atomic: only claims rows where ownerId is still null.
      const rows = await prisma.submission.updateManyAndReturn({
        where: { lookupCode, ownerId: null },
        data: { ownerId: user.id },
        select: { id: true, lookupCode: true },
      });
      if (rows.length > 0) claimed = rows[0]!;
    }

    await issueVerificationCode(prisma, user.id, user.email);
    await audit(prisma, {
      action: 'signup_patient',
      req,
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, claimedSubmissionId: claimed?.id ?? null },
    });
    // No session cookie until the email code is verified.
    res.status(201).json({ ok: true, user, claimed, verificationRequired: true });
  });

  router.post('/api/auth/login', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(errBody('credentials', 'invalid'));
      return;
    }
    const { email, password } = parsed.data;

    // Account lockout — too many recent failures for this email → 429.
    const recentFailures = await recentFailureCount(prisma, {
      action: 'login_failed',
      targetType: 'email',
      targetId: email,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (recentFailures >= LOGIN_MAX_FAILURES) {
      await audit(prisma, {
        action: 'login_rate_limited',
        req,
        targetType: 'email',
        targetId: email,
        success: false,
        actorEmail: email,
      });
      res.status(429).json(errBody('credentials', 'too many attempts — try again later'));
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Always verify against a real Argon2id envelope so response time matches
    // the real-user path regardless of whether the email exists.
    const ok = await verifyPassword(user?.passwordHash ?? DUMMY_ARGON2_HASH, password);
    if (!user || !ok) {
      await audit(prisma, {
        action: 'login_failed',
        req,
        targetType: 'email',
        targetId: email,
        success: false,
        actorEmail: email,
      });
      res.status(401).json(errBody('credentials', 'invalid'));
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json(errBody('email', 'verification required'));
      return;
    }

    // If MFA is armed for this user, stop here and hand out a short-lived
    // challenge token. The real session cookie is only issued after the TOTP
    // code check in POST /api/auth/login/mfa.
    if (user.mfaEnabled) {
      const challengeToken = await signMfaChallenge(user.id);
      res.json({ ok: true, mfaRequired: true, challengeToken });
      return;
    }

    await issueCookieForUser(res, { ...user, role: user.role as Role });
    req.auth = { sub: user.id, email: user.email, role: user.role as Role, confirmed: user.confirmed };
    await audit(prisma, {
      action: 'login',
      req,
      targetType: 'user',
      targetId: user.id,
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        confirmed: user.confirmed,
        createdAt: user.createdAt,
      },
    });
  });

  router.post('/api/auth/login/mfa', async (req, res) => {
    const parsed = z.object({
      challengeToken: z.string().min(1),
      // Accept either a 6-digit TOTP or a recovery passcode the user typed
      // out of their saved list. Normalization happens server-side.
      code: z.string().min(1).max(64),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const userId = await verifyMfaChallenge(parsed.data.challengeToken);
    if (!userId) {
      res.status(401).json(errBody('challengeToken', 'invalid or expired'));
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecretEnc) {
      res.status(401).json(errBody('mfa', 'invalid state'));
      return;
    }

    // Try TOTP first if the input looks like a 6-digit code; otherwise treat
    // it as a recovery passcode.
    const raw = parsed.data.code.trim();
    let verifiedVia: 'totp' | 'recovery' | null = null;
    if (/^\d{6}$/.test(raw)) {
      const secret = crypto.decrypt(user.mfaSecretEnc);
      if (verifyTotp(secret, raw)) verifiedVia = 'totp';
    } else {
      const normalized = normalizeRecoveryCode(raw);
      if (normalized.length > 0) {
        // Atomic: mark the matching passcode used in one update so a concurrent
        // attacker can't race the mark-as-used step.
        const consumed = await prisma.mfaRecoveryCode.updateMany({
          where: { userId: user.id, codeHash: hashRecoveryCode(normalized), usedAt: null },
          data: { usedAt: new Date() },
        });
        if (consumed.count > 0) verifiedVia = 'recovery';
      }
    }

    if (!verifiedVia) {
      await audit(prisma, {
        action: 'mfa_challenge_failed',
        req,
        targetType: 'user',
        targetId: user.id,
        success: false,
        actorEmail: user.email,
      });
      res.status(401).json(errBody('code', 'invalid'));
      return;
    }

    await issueCookieForUser(res, { ...user, role: user.role as Role });
    req.auth = { sub: user.id, email: user.email, role: user.role as Role, confirmed: user.confirmed };
    if (verifiedVia === 'recovery') {
      await audit(prisma, {
        action: 'mfa_recovery_used',
        req,
        targetType: 'user',
        targetId: user.id,
      });
    }
    await audit(prisma, {
      action: 'login',
      req,
      targetType: 'user',
      targetId: user.id,
      metadata: { via: verifiedVia },
    });
    const remaining = await prisma.mfaRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        confirmed: user.confirmed,
        createdAt: user.createdAt,
      },
      recoveryCodesRemaining: remaining,
    });
  });

  // ---------- MFA enrollment ----------

  router.post('/api/auth/mfa/setup', requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user) {
      res.status(401).json(errBody('auth', 'unauthenticated'));
      return;
    }
    if (user.mfaEnabled) {
      res.status(409).json(errBody('mfa', 'already enabled'));
      return;
    }
    const secret = generateMfaSecret();
    const url = otpauthUrl(secret, user.email);
    const qr = await qrDataUrl(url);
    // Persist the (encrypted) secret immediately but keep mfaEnabled=false
    // until the user proves they scanned the QR by posting a valid code.
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: crypto.encrypt(secret) },
    });
    res.json({ ok: true, secret, otpauthUrl: url, qrDataUrl: qr });
  });

  router.post('/api/auth/mfa/enable', requireAuth, async (req, res) => {
    const parsed = z.object({ code: z.string().regex(/^\d{6}$/, 'must be 6 digits') }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user?.mfaSecretEnc) {
      res.status(400).json(errBody('mfa', 'not set up'));
      return;
    }
    if (user.mfaEnabled) {
      res.status(409).json(errBody('mfa', 'already enabled'));
      return;
    }
    const secret = crypto.decrypt(user.mfaSecretEnc);
    if (!verifyTotp(secret, parsed.data.code)) {
      res.status(401).json(errBody('code', 'invalid'));
      return;
    }
    // Enable MFA and issue an initial set of recovery passcodes atomically.
    // We return the plaintext codes ONCE — only their hashes are persisted.
    const codes = generateRecoveryCodes();
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } }),
      prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: user.id, codeHash: c.codeHash })),
      }),
    ]);
    await audit(prisma, { action: 'mfa_enabled', req, targetType: 'user', targetId: user.id });
    res.json({ ok: true, recoveryCodes: codes.map((c) => c.code) });
  });

  router.post('/api/auth/mfa/regenerate-codes', requireAuth, async (req, res) => {
    // Replacing the passcode set is sensitive — require a fresh TOTP so a
    // stolen cookie alone can't rotate the user's recovery codes.
    const parsed = z.object({ code: z.string().regex(/^\d{6}$/, 'must be 6 digits') }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user?.mfaEnabled || !user.mfaSecretEnc) {
      res.status(400).json(errBody('mfa', 'not enabled'));
      return;
    }
    const secret = crypto.decrypt(user.mfaSecretEnc);
    if (!verifyTotp(secret, parsed.data.code)) {
      res.status(401).json(errBody('code', 'invalid'));
      return;
    }
    const codes = generateRecoveryCodes();
    await prisma.$transaction([
      prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: user.id, codeHash: c.codeHash })),
      }),
    ]);
    await audit(prisma, {
      action: 'mfa_recovery_regenerated',
      req,
      targetType: 'user',
      targetId: user.id,
    });
    res.json({ ok: true, recoveryCodes: codes.map((c) => c.code) });
  });

  router.post('/api/auth/mfa/disable', requireAuth, async (req, res) => {
    // Require the current TOTP code to disable MFA — prevents a stolen cookie
    // from being used to turn the second factor off.
    const parsed = z.object({ code: z.string().regex(/^\d{6}$/, 'must be 6 digits') }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user?.mfaEnabled || !user.mfaSecretEnc) {
      res.status(400).json(errBody('mfa', 'not enabled'));
      return;
    }
    const secret = crypto.decrypt(user.mfaSecretEnc);
    if (!verifyTotp(secret, parsed.data.code)) {
      res.status(401).json(errBody('code', 'invalid'));
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecretEnc: null },
    });
    await audit(prisma, { action: 'mfa_disabled', req, targetType: 'user', targetId: user.id });
    res.json({ ok: true });
  });

  // ---------- Password reset ----------

  router.post('/api/auth/request-reset', async (req, res) => {
    const parsed = z.object({
      email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
    }).safeParse(req.body);
    // Always return 200 regardless of success to prevent account enumeration.
    if (!parsed.success) {
      res.json({ ok: true });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user) {
      const { token, tokenHash, expiresAt } = generateResetToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
      deliverOneTimeCode('reset', user.email, `/admin/reset-password?token=${token}`);
      await audit(prisma, {
        action: 'password_reset_requested',
        req,
        targetType: 'user',
        targetId: user.id,
        actorEmail: user.email,
      });
    }
    res.json({ ok: true });
  });

  router.post('/api/auth/reset-password', async (req, res) => {
    const parsed = z.object({
      token: z.string().min(1),
      newPassword: z.string().min(12).max(256),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const tokenHash = hashResetToken(parsed.data.token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      res.status(401).json(errBody('token', 'invalid or expired'));
      return;
    }
    const newHash = await hashPassword(parsed.data.newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Retire any other outstanding reset tokens for this user — a password
      // reset voids all stale links regardless of who sent them.
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, NOT: { id: record.id } },
        data: { usedAt: new Date() },
      }),
    ]);
    await audit(prisma, {
      action: 'password_reset',
      req,
      targetType: 'user',
      targetId: record.userId,
    });
    res.json({ ok: true });
  });

  router.post('/api/admin/users/:id/reset-password-link', requireRole('root'), async (req, res) => {
    const targetId = param(req, 'id');
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    const { token, tokenHash, expiresAt } = generateResetToken();
    await prisma.passwordResetToken.create({
      data: { userId: target.id, tokenHash, expiresAt },
    });
    await audit(prisma, {
      action: 'password_reset_requested',
      req,
      targetType: 'user',
      targetId: target.id,
      metadata: { admin_generated: true },
    });
    res.json({
      ok: true,
      resetUrl: `/admin/reset-password?token=${token}`,
      expiresAt,
    });
  });

  router.post('/api/auth/verify-email', async (req, res) => {
    const parsed = z.object({
      email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
      code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const { email, code } = parsed.data;

    // Rate-limit verification attempts by email: a 6-digit code is only
    // 1,000,000 combinations; without a cap an attacker could brute-force.
    const recentFailures = await recentFailureCount(prisma, {
      action: 'email_verification_failed',
      targetType: 'email',
      targetId: email,
      windowMs: 15 * 60 * 1000,
    });
    if (recentFailures >= VERIFICATION_MAX_ATTEMPTS) {
      res.status(429).json(errBody('code', 'too many attempts — request a new code'));
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json(errBody('code', 'invalid'));
      return;
    }
    const token = await prisma.emailVerificationToken.findFirst({
      where: {
        userId: user.id,
        codeHash: hashCode(code),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!token) {
      await audit(prisma, {
        action: 'email_verification_failed',
        req,
        targetType: 'email',
        targetId: email,
        success: false,
        actorEmail: email,
      });
      res.status(401).json(errBody('code', 'invalid'));
      return;
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
      prisma.emailVerificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      // Retire any other outstanding codes for this user.
      prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null, NOT: { id: token.id } },
        data: { usedAt: new Date() },
      }),
    ]);
    // If the account doesn't need MFA + is confirmed, log them in directly.
    if (user.confirmed && !user.mfaEnabled) {
      await issueCookieForUser(res, { ...user, role: user.role as Role });
      req.auth = { sub: user.id, email: user.email, role: user.role as Role, confirmed: user.confirmed };
    }
    await audit(prisma, {
      action: 'email_verified',
      req,
      targetType: 'user',
      targetId: user.id,
      actorEmail: user.email,
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        confirmed: user.confirmed,
      },
    });
  });

  router.post('/api/auth/resend-verification', async (req, res) => {
    const parsed = z.object({
      email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
    }).safeParse(req.body);
    // Always respond 200 — no enumeration.
    if (!parsed.success) {
      res.json({ ok: true });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user && !user.emailVerified) {
      await issueVerificationCode(prisma, user.id, user.email);
    }
    res.json({ ok: true });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const actorId = req.auth?.sub;
    clearAuthCookie(res);
    if (actorId) {
      await audit(prisma, { action: 'logout', req, targetType: 'user', targetId: actorId });
    }
    res.json({ ok: true });
  });

  router.get('/api/auth/me', async (req, res) => {
    if (!req.auth) {
      res.status(401).json(errBody('auth', 'unauthenticated'));
      return;
    }
    const row = await prisma.user.findUnique({
      where: { id: req.auth.sub },
      select: { id: true, email: true, role: true, confirmed: true, mfaEnabled: true },
    });
    if (!row) {
      res.status(401).json(errBody('auth', 'unauthenticated'));
      return;
    }
    res.json({ ok: true, user: row });
  });

  router.delete('/api/auth/me', requireAuth, async (req, res) => {
    if (!req.auth) {
      res.status(401).json(errBody('auth', 'unauthenticated'));
      return;
    }
    if (req.auth.role === 'root') {
      res.status(400).json(errBody('auth', 'root cannot self-delete'));
      return;
    }
    const actorId = req.auth.sub;
    // Submission.ownerId → User.id has onDelete: Cascade, so deleting a
    // patient also deletes every submission they own.
    await prisma.user.delete({ where: { id: actorId } });
    clearAuthCookie(res);
    await audit(prisma, {
      action: 'account_delete',
      req,
      targetType: 'user',
      targetId: actorId,
    });
    res.json({ ok: true });
  });

  // --- Superfund reference data (public EPA data, auth-gated, not audited) ---

  router.get('/api/superfund/states', requireAuth, async (_req, res) => {
    const rows = await prisma.superfundSite.groupBy({
      by: ['state'],
      _count: { _all: true },
      orderBy: { state: 'asc' },
    });
    const states = rows.map((r) => ({ state: r.state, siteCount: r._count._all }));
    res.json({ ok: true, states });
  });

  const stateQuerySchema = z.object({
    state: z.string().regex(/^[A-Z]{2}$/, 'must be 2 uppercase letters'),
  });

  router.get('/api/superfund/sites', requireAuth, async (req, res) => {
    const parsed = stateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const sites = await prisma.superfundSite.findMany({
      where: { state: parsed.data.state },
      select: {
        id: true,
        epaId: true,
        name: true,
        city: true,
        county: true,
        zipCode: true,
        status: true,
        contaminants: true,
        epaUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ ok: true, sites });
  });

  // ---------- Submissions: staff (root + researcher) ----------

  const requireStaff = requireRole('root', 'researcher');

  router.get('/api/admin/submissions', requireStaff, async (req, res) => {
    const rows = await prisma.submission.findMany({
      where: scopeForStaff(req),
      select: {
        id: true,
        lookupCode: true,
        ownerId: true,
        createdAt: true,
        schemaVersion: true,
        ageBand: true,
        sexAtBirth: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, submissions: rows });
  });

  router.get('/api/admin/submissions/by-lookup/:code', requireStaff, async (req, res) => {
    const row = await prisma.submission.findFirst({
      where: { lookupCode: param(req, 'code'), ...scopeForStaff(req) },
    });
    if (!row) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'submission_view',
      req,
      targetType: 'submission',
      targetId: row.id,
      metadata: { via: 'lookup_code' },
    });
    sendDecrypted(res, row, crypto);
  });

  router.get('/api/admin/submissions/:id', requireStaff, async (req, res) => {
    const row = await prisma.submission.findFirst({
      where: { id: param(req, 'id'), ...scopeForStaff(req) },
    });
    if (!row) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'submission_view',
      req,
      targetType: 'submission',
      targetId: row.id,
    });
    sendDecrypted(res, row, crypto);
  });

  router.delete('/api/admin/submissions/:id', requireStaff, async (req, res) => {
    const targetId = param(req, 'id');
    const result = await prisma.submission.deleteMany({
      where: { id: targetId, ...scopeForStaff(req) },
    });
    if (result.count === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'submission_delete',
      req,
      targetType: 'submission',
      targetId,
    });
    res.json({ ok: true });
  });

  // ---------- Users: root only ----------

  router.get('/api/admin/users', requireRole('root'), async (_req, res) => {
    const rows = await prisma.user.findMany({
      select: { id: true, email: true, role: true, confirmed: true, createdAt: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ ok: true, users: rows });
  });

  router.post('/api/admin/users/:id/confirm', requireRole('root'), async (req, res) => {
    // Atomic: excludes root (root is always confirmed by construction) and
    // returns nothing if the id doesn't match a non-root user.
    const rows = await prisma.user.updateManyAndReturn({
      where: { id: param(req, 'id'), NOT: { role: 'root' } },
      data: { confirmed: true },
      select: { id: true, email: true, role: true, confirmed: true, createdAt: true },
    });
    if (rows.length === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'user_confirm',
      req,
      targetType: 'user',
      targetId: rows[0]!.id,
      metadata: { email: rows[0]!.email, role: rows[0]!.role },
    });
    res.json({ ok: true, user: rows[0] });
  });

  router.delete('/api/admin/users/:id', requireRole('root'), async (req, res) => {
    if (!req.auth) {
      res.status(401).json(errBody('auth', 'unauthenticated'));
      return;
    }
    const targetId = param(req, 'id');
    if (targetId === req.auth.sub) {
      res.status(400).json(errBody('body', 'cannot delete yourself'));
      return;
    }
    // Atomic: refuses to delete root via compound where.
    const result = await prisma.user.deleteMany({
      where: { id: targetId, NOT: { role: 'root' } },
    });
    if (result.count === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'user_delete',
      req,
      targetType: 'user',
      targetId,
    });
    res.json({ ok: true });
  });

  // ---------- Patient self-service ----------

  const requirePatient = requireRole('patient');

  router.get('/api/patient/submissions', requirePatient, async (req, res) => {
    const rows = await prisma.submission.findMany({
      where: { ownerId: req.auth!.sub },
      select: {
        id: true,
        lookupCode: true,
        createdAt: true,
        schemaVersion: true,
        ageBand: true,
        sexAtBirth: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, submissions: rows });
  });

  router.get('/api/patient/submissions/:id', requirePatient, async (req, res) => {
    // Ownership is part of the query so a hit-or-miss is indistinguishable
    // from ownership mismatch — no existence leak.
    const row = await prisma.submission.findFirst({
      where: { id: param(req, 'id'), ownerId: req.auth!.sub },
    });
    if (!row) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'submission_view',
      req,
      targetType: 'submission',
      targetId: row.id,
    });
    sendDecrypted(res, row, crypto);
  });

  router.put('/api/patient/submissions/:id', requirePatient, async (req, res) => {
    const piiErrors = checkPiiKeys(req.body);
    if (piiErrors.length > 0) {
      res.status(400).json({ ok: false, errors: piiErrors });
      return;
    }
    const parsed = submissionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const patch = parsed.data;
    const data: {
      ageBand?: string | null;
      sexAtBirth?: string | null;
      zipCodeEnc?: string | null;
      markdownEnc?: string;
    } = {};
    if ('ageBand' in patch) data.ageBand = patch.ageBand ?? null;
    if ('sexAtBirth' in patch) data.sexAtBirth = patch.sexAtBirth ?? null;
    if ('zipCode' in patch) data.zipCodeEnc = patch.zipCode ? crypto.encrypt(patch.zipCode) : null;
    if ('markdown' in patch && patch.markdown) data.markdownEnc = crypto.encrypt(patch.markdown);

    // Atomic ownership-scoped update; returns [] if nothing matched.
    const rows = await prisma.submission.updateManyAndReturn({
      where: { id: param(req, 'id'), ownerId: req.auth!.sub },
      data,
    });
    if (rows.length === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'submission_edit',
      req,
      targetType: 'submission',
      targetId: rows[0]!.id,
      metadata: { fields: Object.keys(data) },
    });
    sendDecrypted(res, rows[0]!, crypto);
  });

  router.delete('/api/patient/submissions/:id', requirePatient, async (req, res) => {
    const targetId = param(req, 'id');
    const result = await prisma.submission.deleteMany({
      where: { id: targetId, ownerId: req.auth!.sub },
    });
    if (result.count === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'submission_delete',
      req,
      targetType: 'submission',
      targetId,
    });
    res.json({ ok: true });
  });

  router.post('/api/patient/submissions/claim', requirePatient, async (req, res) => {
    const parsed = z.object({ lookupCode: z.string().min(1).max(128) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    // Atomic: only matches unclaimed rows; prevents race-condition double-claim.
    const rows = await prisma.submission.updateManyAndReturn({
      where: { lookupCode: parsed.data.lookupCode, ownerId: null },
      data: { ownerId: req.auth!.sub },
      select: { id: true, lookupCode: true },
    });
    if (rows.length === 0) {
      // Could be not-found OR already-claimed — a separate probe distinguishes.
      const existed = await prisma.submission.count({
        where: { lookupCode: parsed.data.lookupCode },
      });
      if (existed === 0) {
        res.status(404).json(errBody('lookupCode', 'not found'));
      } else {
        res.status(409).json(errBody('lookupCode', 'already claimed'));
      }
      return;
    }
    await audit(prisma, {
      action: 'submission_claim',
      req,
      targetType: 'submission',
      targetId: rows[0]!.id,
    });
    res.json({ ok: true, claimed: rows[0] });
  });

  // ---------- WebAuthn / passkeys ----------

  router.get('/api/auth/webauthn/credentials', requireAuth, async (req, res) => {
    const rows = await prisma.webAuthnCredential.findMany({
      where: { userId: req.auth!.sub },
      select: {
        id: true,
        nickname: true,
        deviceType: true,
        backedUp: true,
        transports: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, credentials: rows });
  });

  router.delete('/api/auth/webauthn/credentials/:id', requireAuth, async (req, res) => {
    const result = await prisma.webAuthnCredential.deleteMany({
      where: { id: param(req, 'id'), userId: req.auth!.sub },
    });
    if (result.count === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'webauthn_removed',
      req,
      targetType: 'user',
      targetId: req.auth!.sub,
      metadata: { credentialRecordId: param(req, 'id') },
    });
    res.json({ ok: true });
  });

  router.post('/api/auth/webauthn/register/begin', requireAuth, async (req, res) => {
    const { rpID, rpName } = rpConfig();
    const existing = await prisma.webAuthnCredential.findMany({
      where: { userId: req.auth!.sub },
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: req.auth!.email,
      userID: new TextEncoder().encode(req.auth!.sub),
      attestationType: 'none',
      // Prevent re-registering the same authenticator twice.
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });
    const challengeToken = await signRegistrationChallenge(req.auth!.sub, options.challenge);
    res.json({ ok: true, options, challengeToken });
  });

  router.post('/api/auth/webauthn/register/finish', requireAuth, async (req, res) => {
    const parsed = z.object({
      challengeToken: z.string().min(1),
      response: z.unknown(),
      nickname: z.string().max(64).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const challenge = await verifyRegistrationChallenge(parsed.data.challengeToken);
    if (!challenge || challenge.userId !== req.auth!.sub) {
      res.status(401).json(errBody('challengeToken', 'invalid or expired'));
      return;
    }
    const { rpID, origins } = rpConfig();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.response as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
      });
    } catch (err) {
      await audit(prisma, {
        action: 'webauthn_challenge_failed',
        req,
        targetType: 'user',
        targetId: req.auth!.sub,
        success: false,
        metadata: { phase: 'register', message: (err as Error).message },
      });
      res.status(400).json(errBody('response', 'attestation invalid'));
      return;
    }
    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json(errBody('response', 'attestation not verified'));
      return;
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await prisma.webAuthnCredential.create({
      data: {
        userId: req.auth!.sub,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports?.join(',') ?? null,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        nickname: parsed.data.nickname ?? null,
      },
    });
    await audit(prisma, {
      action: 'webauthn_registered',
      req,
      targetType: 'user',
      targetId: req.auth!.sub,
    });
    res.status(201).json({ ok: true });
  });

  router.post('/api/auth/webauthn/authenticate/begin', async (req, res) => {
    const parsed = z.object({
      email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const { rpID } = rpConfig();
    let userId: string | undefined;
    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;
    if (parsed.data.email) {
      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
        include: {
          webauthnCredentials: { select: { credentialId: true, transports: true } },
        },
      });
      // Don't leak whether the email exists. Still issue a challenge — the
      // browser will surface "no matching passkey" on its own.
      if (user && user.webauthnCredentials.length > 0) {
        userId = user.id;
        allowCredentials = user.webauthnCredentials.map((c) => ({
          id: c.credentialId,
          transports:
            parseTransports(c.transports),
        }));
      }
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      ...(allowCredentials ? { allowCredentials } : {}),
    });
    const challengeToken = await signAuthenticationChallenge(options.challenge, userId);
    res.json({ ok: true, options, challengeToken });
  });

  router.post('/api/auth/webauthn/authenticate/finish', async (req, res) => {
    const parsed = z.object({
      challengeToken: z.string().min(1),
      response: z.unknown(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const challenge = await verifyAuthenticationChallenge(parsed.data.challengeToken);
    if (!challenge) {
      res.status(401).json(errBody('challengeToken', 'invalid or expired'));
      return;
    }

    // Rate-limit webauthn authentication the same way as password logins.
    // The target is either the bound email or the raw credential id.
    const rateTarget = challenge.userId ?? 'webauthn';
    const recentFails = await recentFailureCount(prisma, {
      action: 'webauthn_challenge_failed',
      targetType: 'user',
      targetId: rateTarget,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (recentFails >= LOGIN_MAX_FAILURES) {
      res.status(429).json(errBody('auth', 'too many attempts — try again later'));
      return;
    }

    const response = parsed.data.response as AuthenticationResponseJSON;
    const credential = await prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });
    if (!credential) {
      await audit(prisma, {
        action: 'webauthn_challenge_failed',
        req,
        targetType: 'email',
        targetId: challenge.userId ?? 'unknown',
        success: false,
        metadata: { phase: 'authenticate', reason: 'credential not found' },
      });
      res.status(401).json(errBody('response', 'invalid'));
      return;
    }
    // If the challenge was bound to a specific user (named-email flow), make
    // sure the credential the browser picked belongs to that user.
    if (challenge.userId && challenge.userId !== credential.userId) {
      res.status(401).json(errBody('response', 'invalid'));
      return;
    }
    if (!credential.user.emailVerified) {
      res.status(403).json(errBody('email', 'verification required'));
      return;
    }
    const { rpID, origins } = rpConfig();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
          counter: credential.counter,
          transports: parseTransports(credential.transports),
        },
      });
    } catch (err) {
      await audit(prisma, {
        action: 'webauthn_challenge_failed',
        req,
        targetType: 'user',
        targetId: credential.userId,
        success: false,
        metadata: { phase: 'authenticate', message: (err as Error).message },
      });
      res.status(401).json(errBody('response', 'invalid'));
      return;
    }
    if (!verification.verified) {
      res.status(401).json(errBody('response', 'invalid'));
      return;
    }
    // Advance the signature counter + timestamp this credential's use.
    await prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });
    const user = credential.user;
    await issueCookieForUser(res, { ...user, role: user.role as Role });
    req.auth = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      confirmed: user.confirmed,
    };
    await audit(prisma, {
      action: 'webauthn_authenticated',
      req,
      targetType: 'user',
      targetId: user.id,
    });
    await audit(prisma, {
      action: 'login',
      req,
      targetType: 'user',
      targetId: user.id,
      metadata: { via: 'webauthn' },
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        confirmed: user.confirmed,
        mfaEnabled: user.mfaEnabled,
        createdAt: user.createdAt,
      },
    });
  });

  // ---------- Patient → Researcher access grants ----------

  router.get('/api/patient/researchers', requirePatient, async (req, res) => {
    // Every confirmed researcher, annotated with whether this patient has
    // granted them live access. Root accounts aren't listed — root already
    // has implicit access to everything and isn't "grantable". Single query:
    // the 0-or-1 grant row for this (patient, researcher) pair comes back as
    // a filtered relation on the User row.
    const rows = await prisma.user.findMany({
      where: { role: 'researcher', confirmed: true },
      select: {
        id: true,
        email: true,
        createdAt: true,
        grantsToResearcher: {
          where: { patientId: req.auth!.sub },
          select: { grantedAt: true, revokedAt: true },
          take: 1,
        },
      },
      orderBy: { email: 'asc' },
    });
    res.json({
      ok: true,
      researchers: rows.map((r) => {
        const g = r.grantsToResearcher[0];
        return {
          id: r.id,
          email: r.email,
          createdAt: r.createdAt,
          granted: Boolean(g && g.revokedAt === null),
          grantedAt: g?.grantedAt ?? null,
        };
      }),
    });
  });

  router.post('/api/patient/researchers/:id/grant', requirePatient, async (req, res) => {
    const researcherId = param(req, 'id');
    const target = await prisma.user.findUnique({ where: { id: researcherId } });
    if (!target || target.role !== 'researcher' || !target.confirmed) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    // Upsert: re-granting a previously revoked row reactivates it.
    await prisma.recordAccessGrant.upsert({
      where: {
        patientId_researcherId: { patientId: req.auth!.sub, researcherId },
      },
      create: { patientId: req.auth!.sub, researcherId },
      update: { revokedAt: null, grantedAt: new Date() },
    });
    await audit(prisma, {
      action: 'grant_researcher',
      req,
      targetType: 'user',
      targetId: researcherId,
    });
    res.json({ ok: true });
  });

  router.delete('/api/patient/researchers/:id/grant', requirePatient, async (req, res) => {
    const researcherId = param(req, 'id');
    // Revoke only — keep the row so the audit trail of past access stays.
    const result = await prisma.recordAccessGrant.updateMany({
      where: { patientId: req.auth!.sub, researcherId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      res.status(404).json(errBody('body', 'not found'));
      return;
    }
    await audit(prisma, {
      action: 'revoke_researcher',
      req,
      targetType: 'user',
      targetId: researcherId,
    });
    res.json({ ok: true });
  });

  // ---------- Audit log (root only) ----------

  router.get('/api/admin/audit-logs', requireRole('root'), async (req, res) => {
    const limit = Math.min(Number(req.query['limit'] ?? 100), 500);
    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const targetType =
      typeof req.query['targetType'] === 'string' ? req.query['targetType'] : undefined;
    const targetId =
      typeof req.query['targetId'] === 'string' ? req.query['targetId'] : undefined;
    const action = typeof req.query['action'] === 'string' ? req.query['action'] : undefined;

    const rows = await prisma.auditLog.findMany({
      where: {
        ...(targetType ? { targetType } : {}),
        ...(targetId ? { targetId } : {}),
        ...(action ? { action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      ok: true,
      logs: page,
      nextCursor: hasMore ? page.at(-1)!.id : null,
    });
  });

  return router;
}

interface EncryptedRow {
  id: string;
  lookupCode: string;
  createdAt: Date;
  schemaVersion: string;
  ageBand: string | null;
  sexAtBirth: string | null;
  zipCodeEnc: string | null;
  markdownEnc: string;
  sectionsEnc: string;
}

function sendDecrypted(res: Response, row: EncryptedRow, crypto: CryptoService): void {
  try {
    res.json({
      ok: true,
      submission: {
        id: row.id,
        lookupCode: row.lookupCode,
        createdAt: row.createdAt,
        schemaVersion: row.schemaVersion,
        ageBand: row.ageBand,
        sexAtBirth: row.sexAtBirth,
        zipCode: row.zipCodeEnc ? crypto.decrypt(row.zipCodeEnc) : null,
        markdown: crypto.decrypt(row.markdownEnc),
        sections: JSON.parse(crypto.decrypt(row.sectionsEnc)),
      },
    });
  } catch (err) {
    console.error('[decrypt]', err);
    res.status(500).json(errBody('body', 'decryption failed'));
  }
}
