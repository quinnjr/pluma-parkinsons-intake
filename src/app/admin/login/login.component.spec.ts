import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService, type AuthedUser } from '../../shared/auth.service';
import { WebAuthnService } from '../../shared/webauthn.service';

const patient: AuthedUser = {
  id: 'u1', email: 'p@x.com', role: 'patient', confirmed: true, mfaEnabled: false,
};
const researcher: AuthedUser = { ...patient, role: 'researcher', email: 'r@x.com' };

describe('LoginComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<LoginComponent>>;
  let cmp: LoginComponent;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(LoginComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('creates', () => {
    expect(cmp).toBeTruthy();
  });

  it('logs a patient in and navigates to /', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.email.set('p@x.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({ ok: true, user: patient });
    await p;
    expect(nav).toHaveBeenCalledWith(['/']);
    expect(cmp.submitting()).toBe(false);
  });

  it('routes a researcher to /admin', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.email.set('r@x.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({ ok: true, user: researcher });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin']);
  });

  it('captures the MFA challenge token on kind==="mfa"', async () => {
    cmp.email.set('r@x.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({
      ok: true, mfaRequired: true, challengeToken: 'ct',
    });
    await p;
    expect(cmp.challengeToken()).toBe('ct');
  });

  it('on 401 shows invalid credentials message', async () => {
    cmp.email.set('r@x.com');
    cmp.password.set('wrong');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/Invalid email or password/);
  });

  it('on 429 shows rate-limit message', async () => {
    cmp.email.set('r@x.com');
    cmp.password.set('x');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({}, { status: 429, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/try again/i);
  });

  it('on 403 redirects to verify-email', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.email.set('u@x.com');
    cmp.password.set('x');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({}, { status: 403, statusText: 'x' });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/verify-email'], {
      queryParams: { email: 'u@x.com' },
    });
  });

  it('on generic error shows generic message', async () => {
    cmp.email.set('r@x.com');
    cmp.password.set('x');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/login').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/Could not log in/);
  });

  it('no-ops when already submitting', async () => {
    cmp.submitting.set(true);
    await cmp.onSubmit();
    httpMock.expectNone('/api/auth/login');
  });

  describe('onSubmitMfa', () => {
    it('no-ops without a challenge token', async () => {
      await cmp.onSubmitMfa();
      httpMock.expectNone('/api/auth/login/mfa');
    });

    it('on success navigates by role', async () => {
      const nav = vi.spyOn(router, 'navigate');
      cmp.challengeToken.set('ct');
      cmp.mfaCode.set('123456');
      const p = cmp.onSubmitMfa();
      httpMock.expectOne('/api/auth/login/mfa').flush({ ok: true, user: researcher });
      await p;
      expect(nav).toHaveBeenCalledWith(['/admin']);
    });

    it('on 401 shows invalid-code message', async () => {
      cmp.challengeToken.set('ct');
      cmp.mfaCode.set('000000');
      const p = cmp.onSubmitMfa();
      httpMock.expectOne('/api/auth/login/mfa').flush({}, { status: 401, statusText: 'x' });
      await p;
      expect(cmp.errorMessage()).toMatch(/Invalid code/);
    });

    it('on other error shows generic message', async () => {
      cmp.challengeToken.set('ct');
      cmp.mfaCode.set('x');
      const p = cmp.onSubmitMfa();
      httpMock.expectOne('/api/auth/login/mfa').flush({}, { status: 500, statusText: 'x' });
      await p;
      expect(cmp.errorMessage()).toMatch(/Could not verify/);
    });
  });

  describe('signInWithPasskey', () => {
    it('delegates to WebAuthnService and routes by role', async () => {
      const auth = TestBed.inject(AuthService);
      const wa = TestBed.inject(WebAuthnService);
      vi.spyOn(wa, 'authenticateBeginAndFinish').mockResolvedValue(patient);
      const setUser = vi.spyOn(auth, 'setAuthenticatedUser');
      const nav = vi.spyOn(router, 'navigate');
      await cmp.signInWithPasskey();
      expect(setUser).toHaveBeenCalledWith(patient);
      expect(nav).toHaveBeenCalledWith(['/']);
    });

    it('swallows AbortError silently (user cancelled)', async () => {
      const wa = TestBed.inject(WebAuthnService);
      const abort = new Error('user cancelled');
      abort.name = 'AbortError';
      vi.spyOn(wa, 'authenticateBeginAndFinish').mockRejectedValue(abort);
      await cmp.signInWithPasskey();
      expect(cmp.errorMessage()).toBeNull();
    });

    it('shows an error on real failure', async () => {
      const wa = TestBed.inject(WebAuthnService);
      vi.spyOn(wa, 'authenticateBeginAndFinish').mockRejectedValue(new Error('boom'));
      await cmp.signInWithPasskey();
      expect(cmp.errorMessage()).toMatch(/Passkey sign-in failed/);
    });

    it('no-ops when already busy', async () => {
      const wa = TestBed.inject(WebAuthnService);
      const spy = vi.spyOn(wa, 'authenticateBeginAndFinish');
      cmp.passkeyBusy.set(true);
      await cmp.signInWithPasskey();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('cancelMfa clears token + code + error', () => {
    cmp.challengeToken.set('t');
    cmp.mfaCode.set('123');
    cmp.password.set('x');
    cmp.errorMessage.set('oops');
    cmp.cancelMfa();
    expect(cmp.challengeToken()).toBeNull();
    expect(cmp.mfaCode()).toBe('');
    expect(cmp.password()).toBe('');
    expect(cmp.errorMessage()).toBeNull();
  });
});
