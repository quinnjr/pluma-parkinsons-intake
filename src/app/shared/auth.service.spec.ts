import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AuthService, type AuthedUser } from './auth.service';

const user: AuthedUser = {
  id: 'u1',
  email: 'alice@example.com',
  role: 'patient',
  confirmed: true,
  mfaEnabled: false,
};

describe('AuthService', () => {
  let auth: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    auth = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('loadMe', () => {
    it('sets user on success and flips ready', async () => {
      const p = auth.loadMe();
      httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
      await p;
      expect(auth.ready()).toBe(true);
      expect(auth.user()).toEqual(user);
    });

    it('leaves user null on failure and still flips ready', async () => {
      const p = auth.loadMe();
      httpMock.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
      await p;
      expect(auth.ready()).toBe(true);
      expect(auth.user()).toBeNull();
    });

    it('short-circuits when ready is already true', async () => {
      const p1 = auth.loadMe();
      httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
      await p1;
      const p2 = auth.loadMe();
      httpMock.expectNone('/api/auth/me');
      await p2;
    });

    it('coalesces concurrent calls into a single request', async () => {
      const p1 = auth.loadMe();
      const p2 = auth.loadMe();
      httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
      await Promise.all([p1, p2]);
      expect(auth.user()).toEqual(user);
    });
  });

  describe('refreshMe', () => {
    it('updates user', async () => {
      const p = auth.refreshMe();
      httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
      await p;
      expect(auth.user()).toEqual(user);
    });

    it('swallows errors silently', async () => {
      const p = auth.refreshMe();
      httpMock.expectOne('/api/auth/me').flush({}, { status: 500, statusText: 'x' });
      await p;
    });
  });

  describe('login', () => {
    it('returns { kind: success } and sets user on plain login', async () => {
      const p = auth.login('a@b.c', 'pw');
      httpMock.expectOne('/api/auth/login').flush({ ok: true, user });
      const r = await p;
      expect(r.kind).toBe('success');
      expect(auth.user()).toEqual(user);
    });

    it('returns { kind: mfa } when challenge is required', async () => {
      const p = auth.login('a@b.c', 'pw');
      httpMock.expectOne('/api/auth/login').flush({
        ok: true, mfaRequired: true, challengeToken: 'tok',
      });
      const r = await p;
      expect(r.kind).toBe('mfa');
      if (r.kind === 'mfa') expect(r.challengeToken).toBe('tok');
      expect(auth.user()).toBeNull();
    });

    it('throws on unexpected response shape', async () => {
      const p = auth.login('a@b.c', 'pw');
      httpMock.expectOne('/api/auth/login').flush({ ok: true });
      await expect(p).rejects.toThrow();
    });
  });

  it('loginWithMfa sets user and resolves to the user', async () => {
    const p = auth.loginWithMfa('ct', '123456');
    httpMock.expectOne('/api/auth/login/mfa').flush({ ok: true, user });
    await expect(p).resolves.toEqual(user);
    expect(auth.user()).toEqual(user);
  });

  it('signup calls /auth/signup and returns user', async () => {
    const p = auth.signup('a@b.c', 'pw');
    httpMock.expectOne('/api/auth/signup').flush({ ok: true, user });
    await expect(p).resolves.toEqual(user);
  });

  it('signupPatient includes optional lookupCode in body', async () => {
    const p = auth.signupPatient('a@b.c', 'pw', 'abc123');
    const req = httpMock.expectOne('/api/auth/signup/patient');
    expect(req.request.body).toEqual({ email: 'a@b.c', password: 'pw', lookupCode: 'abc123' });
    req.flush({ ok: true, user, claimed: { id: 's1', lookupCode: 'abc123' } });
    const { user: u, claimed } = await p;
    expect(u).toEqual(user);
    expect(claimed).toEqual({ id: 's1', lookupCode: 'abc123' });
  });

  it('signupPatient omits lookupCode when not provided', async () => {
    const p = auth.signupPatient('a@b.c', 'pw');
    const req = httpMock.expectOne('/api/auth/signup/patient');
    expect(req.request.body).toEqual({ email: 'a@b.c', password: 'pw' });
    req.flush({ ok: true, user });
    const { claimed } = await p;
    expect(claimed).toBeNull();
  });

  it('verifyEmail sets user', async () => {
    const p = auth.verifyEmail('a@b.c', '123456');
    httpMock.expectOne('/api/auth/verify-email').flush({ ok: true, user });
    await p;
    expect(auth.user()).toEqual(user);
  });

  it('resendVerification calls the endpoint', async () => {
    const p = auth.resendVerification('a@b.c');
    httpMock.expectOne('/api/auth/resend-verification').flush({ ok: true });
    await p;
  });

  it('logout clears user', async () => {
    auth.setAuthenticatedUser(user);
    const p = auth.logout();
    httpMock.expectOne('/api/auth/logout').flush({ ok: true });
    await p;
    expect(auth.user()).toBeNull();
  });

  it('logout clears user even if network errors', async () => {
    auth.setAuthenticatedUser(user);
    const p = auth.logout();
    httpMock.expectOne('/api/auth/logout').flush({}, { status: 500, statusText: 'x' });
    await p.catch(() => {});
    expect(auth.user()).toBeNull();
  });

  it('mfaSetup returns setup info', async () => {
    const p = auth.mfaSetup();
    httpMock.expectOne('/api/auth/mfa/setup').flush({
      ok: true, secret: 'S', otpauthUrl: 'otp', qrDataUrl: 'data:',
    });
    await expect(p).resolves.toEqual({ secret: 'S', otpauthUrl: 'otp', qrDataUrl: 'data:' });
  });

  it('mfaEnable refreshes user and returns recovery codes', async () => {
    const p = auth.mfaEnable('123456');
    httpMock.expectOne('/api/auth/mfa/enable').flush({ ok: true, recoveryCodes: ['a-b'] });
    // Yield so the await in mfaEnable lets refreshMe() kick off its GET.
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
    await expect(p).resolves.toEqual(['a-b']);
    expect(auth.user()).toEqual(user);
  });

  it('mfaRegenerateRecoveryCodes returns new codes (no refresh)', async () => {
    const p = auth.mfaRegenerateRecoveryCodes('123456');
    httpMock.expectOne('/api/auth/mfa/regenerate-codes').flush({
      ok: true, recoveryCodes: ['x', 'y'],
    });
    await expect(p).resolves.toEqual(['x', 'y']);
  });

  it('mfaDisable refreshes user', async () => {
    const p = auth.mfaDisable('123456');
    httpMock.expectOne('/api/auth/mfa/disable').flush({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
    await p;
  });

  it('setAuthenticatedUser writes user directly', () => {
    auth.setAuthenticatedUser(user);
    expect(auth.user()).toEqual(user);
  });

  it('requestPasswordReset / resetPassword hit the right endpoints', async () => {
    const p1 = auth.requestPasswordReset('a@b.c');
    httpMock.expectOne('/api/auth/request-reset').flush({ ok: true });
    await p1;

    const p2 = auth.resetPassword('tok', 'newpw');
    httpMock.expectOne('/api/auth/reset-password').flush({ ok: true });
    await p2;
  });
});
