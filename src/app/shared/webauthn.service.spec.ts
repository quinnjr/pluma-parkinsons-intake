import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { WebAuthnService } from './webauthn.service';
import type { AuthedUser } from './auth.service';

// Mock @simplewebauthn/browser at module boundary.
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(async () => ({ id: 'att-1', response: {}, type: 'public-key' })),
  startAuthentication: vi.fn(async () => ({ id: 'assert-1', response: {}, type: 'public-key' })),
}));

const user: AuthedUser = {
  id: 'u1', email: 'a@b.c', role: 'patient', confirmed: true, mfaEnabled: false,
};

describe('WebAuthnService', () => {
  let svc: WebAuthnService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(WebAuthnService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listCredentials unwraps the credentials array', async () => {
    const p = svc.listCredentials();
    httpMock.expectOne('/api/auth/webauthn/credentials').flush({
      ok: true,
      credentials: [{
        id: 'c1', nickname: null, deviceType: null, backedUp: false,
        transports: null, createdAt: '2026-01-01', lastUsedAt: null,
      }],
    });
    const creds = await p;
    expect(creds).toHaveLength(1);
    expect(creds[0]!.id).toBe('c1');
  });

  it('removeCredential DELETEs the right path', async () => {
    const p = svc.removeCredential('c1');
    const req = httpMock.expectOne('/api/auth/webauthn/credentials/c1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true });
    await p;
  });

  async function yieldMicrotasks() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('registerBeginAndFinish invokes browser + posts attestation', async () => {
    const p = svc.registerBeginAndFinish('home');

    const begin = httpMock.expectOne('/api/auth/webauthn/register/begin');
    begin.flush({ ok: true, options: { challenge: 'c' }, challengeToken: 'ct' });

    await yieldMicrotasks();
    const finish = httpMock.expectOne('/api/auth/webauthn/register/finish');
    expect(finish.request.body).toMatchObject({
      challengeToken: 'ct',
      nickname: 'home',
    });
    finish.flush({ ok: true });
    await p;
  });

  it('authenticateBeginAndFinish returns the authenticated user', async () => {
    const p = svc.authenticateBeginAndFinish('a@b.c');

    const begin = httpMock.expectOne('/api/auth/webauthn/authenticate/begin');
    expect(begin.request.body).toEqual({ email: 'a@b.c' });
    begin.flush({ ok: true, options: { challenge: 'c' }, challengeToken: 'ct' });

    await yieldMicrotasks();
    const finish = httpMock.expectOne('/api/auth/webauthn/authenticate/finish');
    finish.flush({ ok: true, user });
    await expect(p).resolves.toEqual(user);
  });

  it('authenticateBeginAndFinish without email sends {} body', async () => {
    const p = svc.authenticateBeginAndFinish();

    const begin = httpMock.expectOne('/api/auth/webauthn/authenticate/begin');
    expect(begin.request.body).toEqual({});
    begin.flush({ ok: true, options: { challenge: 'c' }, challengeToken: 'ct' });

    await yieldMicrotasks();
    httpMock.expectOne('/api/auth/webauthn/authenticate/finish').flush({ ok: true, user });
    await p;
  });
});
