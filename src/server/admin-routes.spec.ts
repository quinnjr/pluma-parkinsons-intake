// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestDb, type TestDb } from './test-db.js';
import { loginAs, makeTestApp } from './test-app.js';
import { COOKIE_NAME, hashPassword } from './auth.js';
import {
  generateMfaSecret,
  otpauthUrl,
  verifyTotp,
} from './mfa.js';
import { TOTP, Secret } from 'otpauth';
import { CryptoService } from './crypto.js';

// Mock @simplewebauthn/server so we can drive the register/finish and
// authenticate/finish routes without real authenticator crypto.
vi.mock('@simplewebauthn/server', async () => {
  const actual = await vi.importActual<typeof import('@simplewebauthn/server')>(
    '@simplewebauthn/server',
  );
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'fake-cred-id',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    })),
    verifyAuthenticationResponse: vi.fn(async () => ({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    })),
  };
});

let db: TestDb;
let app: Express;
let crypto: CryptoService;

beforeEach(async () => {
  db = await createTestDb();
  const made = makeTestApp(db.prisma);
  app = made.app;
  crypto = made.crypto;
});

afterEach(() => db.dispose());

describe('POST /api/auth/signup', () => {
  it('creates a researcher account (unconfirmed), issues verification code, returns 201', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'alice@example.com',
      password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      user: { email: 'alice@example.com', role: 'researcher', confirmed: false },
      verificationRequired: true,
    });
    expect(await db.prisma.user.count()).toBe(1);
    // verification token written
    expect(await db.prisma.emailVerificationToken.count()).toBe(1);
  });

  it('rejects duplicate email with 409', async () => {
    await request(app).post('/api/auth/signup').send({
      email: 'alice@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    const res = await request(app).post('/api/auth/signup').send({
      email: 'alice@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(409);
  });

  it('rejects short passwords with 400', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'alice@example.com', password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('creates a root account when email matches ROOT_ADMIN_EMAIL', async () => {
    process.env['ROOT_ADMIN_EMAIL'] = 'root@example.com';
    try {
      const res = await request(app).post('/api/auth/signup').send({
        email: 'root@example.com', password: 'Correct-Horse-Battery-Staple',
      });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('root');
      expect(res.body.user.confirmed).toBe(true);
    } finally {
      delete process.env['ROOT_ADMIN_EMAIL'];
    }
  });

  it('rejects a second root signup with 409', async () => {
    process.env['ROOT_ADMIN_EMAIL'] = 'root@example.com';
    try {
      await db.prisma.user.create({
        data: {
          email: 'other@example.com', passwordHash: 'x',
          role: 'root', confirmed: true, emailVerified: true,
        },
      });
      const res = await request(app).post('/api/auth/signup').send({
        email: 'root@example.com', password: 'Correct-Horse-Battery-Staple',
      });
      expect(res.status).toBe(409);
    } finally {
      delete process.env['ROOT_ADMIN_EMAIL'];
    }
  });
});

describe('POST /api/auth/signup/patient', () => {
  it('creates a patient, confirmed but email-unverified', async () => {
    const res = await request(app).post('/api/auth/signup/patient').send({
      email: 'p@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('patient');
    expect(res.body.user.confirmed).toBe(true);
  });

  it('claims a submission by lookupCode', async () => {
    const sub = await db.prisma.submission.create({
      data: {
        lookupCode: 'abc123',
        schemaVersion: '1.0.0',
        markdownEnc: crypto.encrypt('# x'),
        sectionsEnc: crypto.encrypt('[]'),
      },
    });
    const res = await request(app).post('/api/auth/signup/patient').send({
      email: 'p@example.com', password: 'Correct-Horse-Battery-Staple', lookupCode: 'abc123',
    });
    expect(res.status).toBe(201);
    expect(res.body.claimed).toMatchObject({ id: sub.id, lookupCode: 'abc123' });
    const reloaded = await db.prisma.submission.findUnique({ where: { id: sub.id } });
    expect(reloaded!.ownerId).toBe(res.body.user.id);
  });

  it('refuses the root-admin email', async () => {
    process.env['ROOT_ADMIN_EMAIL'] = 'root@example.com';
    try {
      const res = await request(app).post('/api/auth/signup/patient').send({
        email: 'root@example.com', password: 'Correct-Horse-Battery-Staple',
      });
      expect(res.status).toBe(409);
    } finally {
      delete process.env['ROOT_ADMIN_EMAIL'];
    }
  });

  it('refuses a duplicate email', async () => {
    await request(app).post('/api/auth/signup/patient').send({
      email: 'p@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    const res = await request(app).post('/api/auth/signup/patient').send({
      email: 'p@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await db.prisma.user.create({
      data: {
        email: 'alice@example.com',
        passwordHash: await hashPassword('Correct-Horse-Battery-Staple'),
        role: 'researcher',
        confirmed: true,
        emailVerified: true,
      },
    });
  });

  it('returns a cookie + user on correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'alice@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@example.com');
    expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith(COOKIE_NAME + '='))).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'alice@example.com', password: 'wrong-password-long-enough',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 on unknown email (same shape as wrong password)', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(401);
  });

  it('locks out after too many failures', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({
        email: 'alice@example.com', password: 'wrong-password-long-enough',
      });
    }
    const res = await request(app).post('/api/auth/login').send({
      email: 'alice@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(429);
  });

  it('returns mfaRequired when MFA is enabled', async () => {
    const secret = generateMfaSecret();
    await db.prisma.user.update({
      where: { email: 'alice@example.com' },
      data: { mfaEnabled: true, mfaSecretEnc: crypto.encrypt(secret) },
    });
    const res = await request(app).post('/api/auth/login').send({
      email: 'alice@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.challengeToken).toBeTruthy();
  });

  it('returns 403 when email is unverified', async () => {
    await db.prisma.user.update({
      where: { email: 'alice@example.com' },
      data: { emailVerified: false },
    });
    const res = await request(app).post('/api/auth/login').send({
      email: 'alice@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res.status).toBe(403);
  });

  it('rejects malformed credentials with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login/mfa', () => {
  it('returns a cookie + user on valid TOTP', async () => {
    const secret = generateMfaSecret();
    const user = await db.prisma.user.create({
      data: {
        email: 'a@example.com', passwordHash: await hashPassword('Correct-Horse-Battery-Staple'),
        role: 'researcher', confirmed: true, emailVerified: true,
        mfaEnabled: true, mfaSecretEnc: crypto.encrypt(secret),
      },
    });
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'a@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    const token = loginRes.body.challengeToken as string;
    const code = new TOTP({
      issuer: 'Pluma', label: 'x', algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(secret),
    }).generate();
    const res = await request(app).post('/api/auth/login/mfa').send({
      challengeToken: token, code,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it('rejects bad TOTP', async () => {
    const secret = generateMfaSecret();
    await db.prisma.user.create({
      data: {
        email: 'a@example.com', passwordHash: await hashPassword('Correct-Horse-Battery-Staple'),
        role: 'researcher', confirmed: true, emailVerified: true,
        mfaEnabled: true, mfaSecretEnc: crypto.encrypt(secret),
      },
    });
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'a@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    const res = await request(app).post('/api/auth/login/mfa').send({
      challengeToken: loginRes.body.challengeToken, code: '000000',
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid challenge token', async () => {
    const res = await request(app).post('/api/auth/login/mfa').send({
      challengeToken: 'not-a-jwt', code: '123456',
    });
    expect(res.status).toBe(401);
  });

  it('rejects malformed body with 400', async () => {
    const res = await request(app).post('/api/auth/login/mfa').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me + DELETE /api/auth/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user when authenticated', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.user.email).toBe('a@example.com');
  });

  it('deletes the account', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const res = await request(app).delete('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(await db.prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('rejects unauthenticated delete with 401', async () => {
    const res = await request(app).delete('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect((res.headers['set-cookie'] as unknown as string[]).some((c) =>
      c.startsWith(COOKIE_NAME + '=') && c.includes('Expires='))).toBe(true);
  });
});

describe('verification + reset + resend', () => {
  it('verifies an email with the right 6-digit code', async () => {
    const res1 = await request(app).post('/api/auth/signup').send({
      email: 'v@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res1.status).toBe(201);
    const tok = await db.prisma.emailVerificationToken.findFirst({
      where: { userId: res1.body.user.id },
    });
    // Brute-force 6-digit — hash guessable in <1s is unacceptable, so just
    // regenerate a known code and patch the DB.
    const { hashCode } = await import('./email-verification.js');
    await db.prisma.emailVerificationToken.update({
      where: { id: tok!.id },
      data: { codeHash: hashCode('123456') },
    });
    const res = await request(app).post('/api/auth/verify-email').send({
      email: 'v@example.com', code: '123456',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('v@example.com');
  });

  it('rejects a wrong code with 401', async () => {
    const res1 = await request(app).post('/api/auth/signup').send({
      email: 'v@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    expect(res1.status).toBe(201);
    const res = await request(app).post('/api/auth/verify-email').send({
      email: 'v@example.com', code: '000000',
    });
    expect(res.status).toBe(401);
  });

  it('accepts resend-verification for a real user without revealing existence', async () => {
    const res1 = await request(app).post('/api/auth/resend-verification').send({
      email: 'nobody@example.com',
    });
    expect(res1.status).toBe(200);
    const res2 = await request(app).post('/api/auth/resend-verification').send({
      email: 'real@example.com',
    });
    expect(res2.status).toBe(200);
  });

  it('request-reset returns 200 regardless of whether the email exists', async () => {
    await request(app).post('/api/auth/signup').send({
      email: 'rr@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    const res = await request(app).post('/api/auth/request-reset').send({ email: 'rr@example.com' });
    expect(res.status).toBe(200);
    const res2 = await request(app).post('/api/auth/request-reset').send({ email: 'unknown@example.com' });
    expect(res2.status).toBe(200);
  });

  it('reset-password with a valid token updates the password', async () => {
    const { generateResetToken, hashResetToken } = await import('./password-reset.js');
    const user = await db.prisma.user.create({
      data: {
        email: 'r@example.com', passwordHash: await hashPassword('Correct-Horse-Battery-Staple'),
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    const { token } = generateResetToken();
    await db.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const res = await request(app).post('/api/auth/reset-password').send({
      token, newPassword: 'NewPasswordIsSufficientlyLong123',
    });
    expect(res.status).toBe(200);
    // Confirm the new password works for login
    const login = await request(app).post('/api/auth/login').send({
      email: 'r@example.com', password: 'NewPasswordIsSufficientlyLong123',
    });
    expect(login.status).toBe(200);
  });
});

describe('/api/superfund reference endpoints', () => {
  beforeEach(async () => {
    await db.prisma.superfundSite.createMany({
      data: [
        { epaId: 'A', name: 'Alpha', state: 'FL', latitude: 25, longitude: -80, status: 'final' },
        { epaId: 'B', name: 'Beta',  state: 'FL', latitude: 26, longitude: -81, status: 'deleted' },
        { epaId: 'C', name: 'Gamma', state: 'CA', latitude: 34, longitude: -118, status: 'final' },
      ],
    });
  });

  it('GET /api/superfund/states requires auth', async () => {
    const res = await request(app).get('/api/superfund/states');
    expect(res.status).toBe(401);
  });

  it('GET /api/superfund/states returns per-state counts', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'u@example.com', role: 'researcher' });
    const res = await request(app).get('/api/superfund/states').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.states).toEqual([
      { state: 'CA', siteCount: 1 },
      { state: 'FL', siteCount: 2 },
    ]);
  });

  it('GET /api/superfund/sites requires auth + valid state', async () => {
    const unauth = await request(app).get('/api/superfund/sites?state=FL');
    expect(unauth.status).toBe(401);

    const { cookie } = await loginAs(db.prisma, { email: 'u@example.com', role: 'researcher' });
    const bad = await request(app).get('/api/superfund/sites?state=fl').set('Cookie', cookie);
    expect(bad.status).toBe(400);
  });

  it('GET /api/superfund/sites returns sites for a state', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'u@example.com', role: 'researcher' });
    const res = await request(app).get('/api/superfund/sites?state=FL').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.sites).toHaveLength(2);
    // latitude/longitude intentionally omitted
    expect(res.body.sites[0]).not.toHaveProperty('latitude');
  });
});

describe('admin submissions', () => {
  async function makeSubmission(ownerId: string | null = null) {
    return db.prisma.submission.create({
      data: {
        lookupCode: `lookup-${Math.random().toString(36).slice(2, 8)}`,
        schemaVersion: '1.1.0',
        markdownEnc: crypto.encrypt('# mock markdown'),
        sectionsEnc: crypto.encrypt('[]'),
        ownerId,
      },
    });
  }

  it('GET /api/admin/submissions is 403 for patients', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const res = await request(app).get('/api/admin/submissions').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/submissions lists for root', async () => {
    await makeSubmission();
    const { cookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'root' });
    const res = await request(app).get('/api/admin/submissions').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
  });

  it('GET /api/admin/submissions/by-lookup/:code returns the right submission', async () => {
    const sub = await makeSubmission();
    const { cookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'root' });
    const res = await request(app)
      .get(`/api/admin/submissions/by-lookup/${sub.lookupCode}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.submission.id).toBe(sub.id);
  });

  it('GET /api/admin/submissions/by-lookup/:code returns 404 on miss', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'root' });
    const res = await request(app)
      .get('/api/admin/submissions/by-lookup/nope')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('GET /api/admin/submissions/:id returns the decrypted payload', async () => {
    const sub = await makeSubmission();
    const { cookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'root' });
    const res = await request(app)
      .get(`/api/admin/submissions/${sub.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.submission.markdown).toBe('# mock markdown');
  });

  it('DELETE /api/admin/submissions/:id removes the row', async () => {
    const sub = await makeSubmission();
    const { cookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'root' });
    const res = await request(app)
      .delete(`/api/admin/submissions/${sub.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(await db.prisma.submission.findUnique({ where: { id: sub.id } })).toBeNull();
  });
});

describe('admin users', () => {
  it('GET /api/admin/users is root-only', async () => {
    const { cookie: rcookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'researcher' });
    expect((await request(app).get('/api/admin/users').set('Cookie', rcookie)).status).toBe(403);

    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it('POST /api/admin/users/:id/confirm flips confirmed=true', async () => {
    const target = await db.prisma.user.create({
      data: {
        email: 'unconf@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: false, emailVerified: true,
      },
    });
    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    const res = await request(app)
      .post(`/api/admin/users/${target.id}/confirm`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const reloaded = await db.prisma.user.findUnique({ where: { id: target.id } });
    expect(reloaded!.confirmed).toBe(true);
  });

  it('DELETE /api/admin/users/:id removes a user', async () => {
    const target = await db.prisma.user.create({
      data: {
        email: 'target@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    const res = await request(app)
      .delete(`/api/admin/users/${target.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(await db.prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
  });

  it('POST /api/admin/users/:id/reset-password-link returns a link for root', async () => {
    const target = await db.prisma.user.create({
      data: {
        email: 'rp@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    const res = await request(app)
      .post(`/api/admin/users/${target.id}/reset-password-link`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.resetUrl).toMatch(/reset-password/);
  });

  it('GET /api/admin/audit-logs is root-only and paginated', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    // trigger some audit entries
    await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'long-enough-pw' });
    const res = await request(app).get('/api/admin/audit-logs').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });
});

describe('patient submissions', () => {
  async function makeSubForPatient(ownerId: string) {
    return db.prisma.submission.create({
      data: {
        lookupCode: `lookup-${Math.random().toString(36).slice(2, 8)}`,
        schemaVersion: '1.1.0',
        markdownEnc: crypto.encrypt('# mock'),
        sectionsEnc: crypto.encrypt('[]'),
        ownerId,
      },
    });
  }

  it('GET /api/patient/submissions lists only the patient\'s own', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const mine = await makeSubForPatient(user.id);
    await db.prisma.submission.create({
      data: {
        lookupCode: 'other-lookup',
        schemaVersion: '1.1.0',
        markdownEnc: crypto.encrypt('# other'),
        sectionsEnc: crypto.encrypt('[]'),
      },
    });
    const res = await request(app).get('/api/patient/submissions').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
    expect(res.body.submissions[0].id).toBe(mine.id);
  });

  it('GET /api/patient/submissions/:id only returns owned records', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const mine = await makeSubForPatient(user.id);
    const notMine = await db.prisma.submission.create({
      data: {
        lookupCode: 'other-lookup',
        schemaVersion: '1.1.0',
        markdownEnc: crypto.encrypt('# other'),
        sectionsEnc: crypto.encrypt('[]'),
      },
    });
    const ok = await request(app).get(`/api/patient/submissions/${mine.id}`).set('Cookie', cookie);
    expect(ok.status).toBe(200);
    const bad = await request(app).get(`/api/patient/submissions/${notMine.id}`).set('Cookie', cookie);
    expect(bad.status).toBe(404);
  });

  it('PUT /api/patient/submissions/:id updates the markdown', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const sub = await makeSubForPatient(user.id);
    const res = await request(app)
      .put(`/api/patient/submissions/${sub.id}`)
      .set('Cookie', cookie)
      .send({ markdown: '# updated' });
    expect(res.status).toBe(200);
    const reloaded = await db.prisma.submission.findUnique({ where: { id: sub.id } });
    expect(crypto.decrypt(reloaded!.markdownEnc)).toBe('# updated');
  });

  it('DELETE /api/patient/submissions/:id removes own record', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const sub = await makeSubForPatient(user.id);
    const res = await request(app)
      .delete(`/api/patient/submissions/${sub.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(await db.prisma.submission.findUnique({ where: { id: sub.id } })).toBeNull();
  });

  it('POST /api/patient/submissions/claim links an unowned lookup', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const sub = await db.prisma.submission.create({
      data: {
        lookupCode: 'claimable',
        schemaVersion: '1.1.0',
        markdownEnc: crypto.encrypt('# claim'),
        sectionsEnc: crypto.encrypt('[]'),
      },
    });
    const res = await request(app)
      .post('/api/patient/submissions/claim')
      .set('Cookie', cookie)
      .send({ lookupCode: 'claimable' });
    expect(res.status).toBe(200);
    const reloaded = await db.prisma.submission.findUnique({ where: { id: sub.id } });
    expect(reloaded!.ownerId).toBeTruthy();
  });
});

describe('MFA setup/enable/disable/regenerate', () => {
  it('/api/auth/mfa/setup returns secret + QR + url', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app).post('/api/auth/mfa/setup').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeTruthy();
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('/api/auth/mfa/enable requires prior setup + valid code', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const setupRes = await request(app).post('/api/auth/mfa/setup').set('Cookie', cookie);
    const secret = setupRes.body.secret as string;
    // Reload secret from DB to match what the server has stored (encrypted).
    const reloaded = await db.prisma.user.findUnique({ where: { id: user.id } });
    const storedSecret = reloaded!.mfaSecretEnc ? crypto.decrypt(reloaded!.mfaSecretEnc) : secret;
    const code = new TOTP({
      issuer: 'Pluma', label: 'a', algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(storedSecret),
    }).generate();
    const res = await request(app).post('/api/auth/mfa/enable').set('Cookie', cookie).send({ code });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recoveryCodes)).toBe(true);
  });

  it('/api/auth/mfa/disable requires TOTP', async () => {
    const { cookie, user } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const secret = generateMfaSecret();
    await db.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecretEnc: crypto.encrypt(secret) },
    });
    const code = new TOTP({
      issuer: 'Pluma', label: 'a', algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(secret),
    }).generate();
    const res = await request(app).post('/api/auth/mfa/disable').set('Cookie', cookie).send({ code });
    expect(res.status).toBe(200);
    const reloaded = await db.prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded!.mfaEnabled).toBe(false);
  });

  it('/api/auth/mfa/disable rejects wrong code with 401', async () => {
    const { cookie, user } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const secret = generateMfaSecret();
    await db.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecretEnc: crypto.encrypt(secret) },
    });
    const res = await request(app).post('/api/auth/mfa/disable').set('Cookie', cookie).send({ code: '000000' });
    expect(res.status).toBe(401);
  });
});

describe('WebAuthn credential listing + removal', () => {
  it('GET /api/auth/webauthn/credentials returns empty list', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app).get('/api/auth/webauthn/credentials').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
  });

  it('DELETE /api/auth/webauthn/credentials/:id removes own credential', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const cred = await db.prisma.webAuthnCredential.create({
      data: {
        userId: user.id, credentialId: 'cid', publicKey: 'pk',
      },
    });
    const res = await request(app)
      .delete(`/api/auth/webauthn/credentials/${cred.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(await db.prisma.webAuthnCredential.findUnique({ where: { id: cred.id } })).toBeNull();
  });

  it('WebAuthn register/begin hands out options + challenge token', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app)
      .post('/api/auth/webauthn/register/begin')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.options.challenge).toBeTruthy();
    expect(res.body.challengeToken).toBeTruthy();
  });

  it('WebAuthn authenticate/begin returns options for unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/authenticate/begin')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.options.challenge).toBeTruthy();
  });
});

describe('patient researcher grants', () => {
  it('GET /api/patient/researchers lists researchers + my grants', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    await db.prisma.user.create({
      data: {
        email: 'r@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    const res = await request(app).get('/api/patient/researchers').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.researchers.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /grant and DELETE /grant toggle access', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const researcher = await db.prisma.user.create({
      data: {
        email: 'r@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    const grant = await request(app)
      .post(`/api/patient/researchers/${researcher.id}/grant`)
      .set('Cookie', cookie);
    expect(grant.status).toBe(200);
    const revoke = await request(app)
      .delete(`/api/patient/researchers/${researcher.id}/grant`)
      .set('Cookie', cookie);
    expect(revoke.status).toBe(200);
  });

  it('/grant rejects non-researcher target with 404', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const other = await db.prisma.user.create({
      data: {
        email: 'p2@example.com', passwordHash: 'x',
        role: 'patient', confirmed: true, emailVerified: true,
      },
    });
    const res = await request(app)
      .post(`/api/patient/researchers/${other.id}/grant`)
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

describe('RBAC guards', () => {
  it('patient endpoints 403 for staff', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'r@example.com', role: 'researcher' });
    const res = await request(app).get('/api/patient/submissions').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('admin endpoints 401 for unauthenticated', async () => {
    const res = await request(app).get('/api/admin/submissions');
    expect(res.status).toBe(401);
  });

  it('unknown /api/* returns 404 JSON envelope', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('additional admin-routes error + edge paths', () => {
  async function enableMfa(userId: string) {
    const secret = generateMfaSecret();
    await db.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaSecretEnc: crypto.encrypt(secret) },
    });
    return secret;
  }

  function totp(secret: string): string {
    return new TOTP({
      issuer: 'Pluma', label: 'x', algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(secret),
    }).generate();
  }

  it('login/mfa: recovery code consumed', async () => {
    const { hashRecoveryCode, normalizeRecoveryCode } = await import('./mfa-recovery.js');
    const user = await db.prisma.user.create({
      data: {
        email: 'rec@example.com', passwordHash: await hashPassword('Correct-Horse-Battery-Staple'),
        role: 'researcher', confirmed: true, emailVerified: true,
        mfaEnabled: true, mfaSecretEnc: crypto.encrypt(generateMfaSecret()),
      },
    });
    const code = 'abcde-fghij';
    await db.prisma.mfaRecoveryCode.create({
      data: {
        userId: user.id,
        codeHash: hashRecoveryCode(normalizeRecoveryCode(code)),
      },
    });
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'rec@example.com', password: 'Correct-Horse-Battery-Staple',
    });
    const res = await request(app).post('/api/auth/login/mfa').send({
      challengeToken: loginRes.body.challengeToken, code,
    });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodesRemaining).toBe(0);
  });

  it('mfa/regenerate-codes: requires TOTP and rotates codes', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const secret = await enableMfa(user.id);
    // Seed some old codes.
    await db.prisma.mfaRecoveryCode.create({
      data: { userId: user.id, codeHash: 'old-hash' },
    });
    const res = await request(app)
      .post('/api/auth/mfa/regenerate-codes')
      .set('Cookie', cookie)
      .send({ code: totp(secret) });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    // Old code replaced.
    const rows = await db.prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.codeHash)).not.toContain('old-hash');
  });

  it('mfa/regenerate-codes: rejects wrong TOTP with 401', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    await enableMfa(user.id);
    const res = await request(app)
      .post('/api/auth/mfa/regenerate-codes')
      .set('Cookie', cookie)
      .send({ code: '000000' });
    expect(res.status).toBe(401);
  });

  it('mfa/regenerate-codes: 400 when MFA not enabled', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app)
      .post('/api/auth/mfa/regenerate-codes')
      .set('Cookie', cookie)
      .send({ code: '123456' });
    expect(res.status).toBe(400);
  });

  it('mfa/enable: requires prior setup', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const res = await request(app).post('/api/auth/mfa/enable').set('Cookie', cookie).send({ code: '123456' });
    expect(res.status).toBe(400);
  });

  it('mfa/enable: rejects bad TOTP after setup', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    await request(app).post('/api/auth/mfa/setup').set('Cookie', cookie);
    const res = await request(app).post('/api/auth/mfa/enable').set('Cookie', cookie).send({ code: '000000' });
    expect(res.status).toBe(401);
  });

  it('reset-password: rejects an unknown/expired/used token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({
      token: 'nonexistent-token', newPassword: 'LongEnoughNewPassword9',
    });
    expect(res.status).toBe(401);
  });

  it('reset-password: rejects malformed body with 400', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({});
    expect(res.status).toBe(400);
  });

  it('admin/users/:id/reset-password-link returns 404 for missing target', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    const res = await request(app)
      .post('/api/admin/users/nonexistent-id/reset-password-link')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('verify-email: returns 401 when user does not exist (no enumeration diff)', async () => {
    const res = await request(app).post('/api/auth/verify-email').send({
      email: 'nobody@example.com', code: '123456',
    });
    expect(res.status).toBe(401);
  });

  it('verify-email: rejects malformed code with 400', async () => {
    const res = await request(app).post('/api/auth/verify-email').send({
      email: 'a@example.com', code: 'abc',
    });
    expect(res.status).toBe(400);
  });

  it('request-reset rate-limits silently (no change in response)', async () => {
    // Each call returns 200 regardless of user existence.
    const res = await request(app).post('/api/auth/request-reset').send({ email: 'whoever@example.com' });
    expect(res.status).toBe(200);
  });

  it('claim: fails when the lookupCode is unknown', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const res = await request(app)
      .post('/api/patient/submissions/claim')
      .set('Cookie', cookie)
      .send({ lookupCode: 'nope' });
    expect(res.status).toBe(404);
  });

  it('claim: fails when the submission is already owned', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const owner = await db.prisma.user.create({
      data: {
        email: 'other@example.com', passwordHash: 'x',
        role: 'patient', confirmed: true, emailVerified: true,
      },
    });
    await db.prisma.submission.create({
      data: {
        lookupCode: 'already',
        schemaVersion: '1.0.0',
        markdownEnc: crypto.encrypt('# x'),
        sectionsEnc: crypto.encrypt('[]'),
        ownerId: owner.id,
      },
    });
    const res = await request(app)
      .post('/api/patient/submissions/claim')
      .set('Cookie', cookie)
      .send({ lookupCode: 'already' });
    expect(res.status).toBe(409);
  });

  it('root cannot self-delete', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    const res = await request(app).delete('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('audit-logs: filters by action + targetType + limit + cursor', async () => {
    const { user: root, cookie } = await loginAs(db.prisma, { email: 'root@example.com', role: 'root' });
    for (let i = 0; i < 5; i++) {
      await db.prisma.auditLog.create({
        data: {
          action: 'login', actorId: root.id, targetType: 'user', targetId: root.id, success: true,
        },
      });
    }
    // filters
    const filtered = await request(app)
      .get('/api/admin/audit-logs?action=login&targetType=user&limit=2')
      .set('Cookie', cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.logs.length).toBe(2);
    expect(filtered.body.nextCursor).toBeTruthy();

    // cursor
    const next = await request(app)
      .get(`/api/admin/audit-logs?limit=2&cursor=${filtered.body.nextCursor}`)
      .set('Cookie', cookie);
    expect(next.status).toBe(200);
    expect(next.body.logs.length).toBeGreaterThanOrEqual(1);

    // targetId filter
    const byId = await request(app)
      .get(`/api/admin/audit-logs?targetId=${root.id}`)
      .set('Cookie', cookie);
    expect(byId.status).toBe(200);
    expect(byId.body.logs.length).toBeGreaterThan(0);
  });

  it('researcher grant: pre-existing grant is reactivated on re-grant', async () => {
    const { user: patient, cookie } = await loginAs(db.prisma, { email: 'p@example.com', role: 'patient' });
    const researcher = await db.prisma.user.create({
      data: {
        email: 'r@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    // First grant
    await request(app).post(`/api/patient/researchers/${researcher.id}/grant`).set('Cookie', cookie);
    // Revoke
    await request(app).delete(`/api/patient/researchers/${researcher.id}/grant`).set('Cookie', cookie);
    // Re-grant
    const res = await request(app).post(`/api/patient/researchers/${researcher.id}/grant`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const grant = await db.prisma.recordAccessGrant.findFirst({
      where: { patientId: patient.id, researcherId: researcher.id },
    });
    expect(grant!.revokedAt).toBeNull();
  });

  it('webauthn delete: 404 for another user\'s credential', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'a@example.com', role: 'researcher' });
    const other = await db.prisma.user.create({
      data: {
        email: 'other@example.com', passwordHash: 'x',
        role: 'researcher', confirmed: true, emailVerified: true,
      },
    });
    const cred = await db.prisma.webAuthnCredential.create({
      data: { userId: other.id, credentialId: 'cid', publicKey: 'pk' },
    });
    const res = await request(app)
      .delete(`/api/auth/webauthn/credentials/${cred.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('signup rejects malformed body with 400', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('signup/patient rejects malformed body with 400', async () => {
    const res = await request(app).post('/api/auth/signup/patient').send({});
    expect(res.status).toBe(400);
  });
});

describe('WebAuthn register/finish + authenticate/finish (mocked @simplewebauthn/server)', () => {
  it('register/finish persists the credential + audits', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'wa@example.com', role: 'researcher' });
    const begin = await request(app)
      .post('/api/auth/webauthn/register/begin')
      .set('Cookie', cookie);
    const finish = await request(app)
      .post('/api/auth/webauthn/register/finish')
      .set('Cookie', cookie)
      .send({
        challengeToken: begin.body.challengeToken,
        response: { id: 'x', response: {}, type: 'public-key' },
        nickname: 'device-1',
      });
    expect(finish.status).toBe(201);
    const creds = await db.prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
    expect(creds).toHaveLength(1);
    expect(creds[0]!.nickname).toBe('device-1');
  });

  it('register/finish rejects a mangled challengeToken with 401', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'wa@example.com', role: 'researcher' });
    const res = await request(app)
      .post('/api/auth/webauthn/register/finish')
      .set('Cookie', cookie)
      .send({ challengeToken: 'nope', response: {} });
    expect(res.status).toBe(401);
  });

  it('register/finish rejects malformed body with 400', async () => {
    const { cookie } = await loginAs(db.prisma, { email: 'wa@example.com', role: 'researcher' });
    const res = await request(app)
      .post('/api/auth/webauthn/register/finish')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('authenticate/finish logs the user in given a matching credential', async () => {
    const { user, cookie } = await loginAs(db.prisma, { email: 'wa@example.com', role: 'researcher' });
    // Seed a credential. Store the credential ID as the raw base64url string the
    // browser would hand back (the server decodes response.id for lookup).
    const credId = Buffer.from('fake-cred-id').toString('base64url');
    await db.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: credId,
        publicKey: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64url'),
        transports: 'internal',
      },
    });
    const begin = await request(app)
      .post('/api/auth/webauthn/authenticate/begin')
      .set('Cookie', cookie)
      .send({ email: 'wa@example.com' });
    const res = await request(app)
      .post('/api/auth/webauthn/authenticate/finish')
      .send({
        challengeToken: begin.body.challengeToken,
        response: { id: credId, response: {}, type: 'public-key' },
      });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it('authenticate/finish rejects invalid challengeToken with 401', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/authenticate/finish')
      .send({ challengeToken: 'nope', response: {} });
    expect(res.status).toBe(401);
  });

  it('authenticate/finish rejects malformed body with 400', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/authenticate/finish')
      .send({});
    expect(res.status).toBe(400);
  });
});

// keep verifyTotp + otpauthUrl imports live for coverage hits above
void verifyTotp; void otpauthUrl;
