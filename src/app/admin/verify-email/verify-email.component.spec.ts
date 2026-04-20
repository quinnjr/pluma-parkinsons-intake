import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { VerifyEmailComponent } from './verify-email.component';
import type { AuthedUser } from '../../shared/auth.service';

const user: AuthedUser = {
  id: 'u', email: 'a@b.com', role: 'researcher', confirmed: true, mfaEnabled: false,
};

function setup(email = 'a@b.com') {
  const route = {
    snapshot: { queryParamMap: convertToParamMap({ email }) },
  } as unknown as ActivatedRoute;
  TestBed.configureTestingModule({
    imports: [VerifyEmailComponent, HttpClientTestingModule],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ActivatedRoute, useValue: route },
    ],
  });
  return {
    cmp: TestBed.createComponent(VerifyEmailComponent).componentInstance,
    httpMock: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  };
}

describe('VerifyEmailComponent', () => {
  let cmp!: ReturnType<typeof setup>['cmp'];
  let httpMock!: ReturnType<typeof setup>['httpMock'];
  let router!: ReturnType<typeof setup>['router'];

  beforeEach(() => {
    const s = setup();
    cmp = s.cmp;
    httpMock = s.httpMock;
    router = s.router;
  });

  afterEach(() => httpMock.verify());

  it('prefills email from query param', () => {
    expect(cmp.email()).toBe('a@b.com');
  });

  it('verifies and routes researcher to /admin/login', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.code.set('123456');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/verify-email').flush({ ok: true, user });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/login']);
  });

  it('routes patient to /', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.code.set('123456');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/verify-email').flush({ ok: true, user: { ...user, role: 'patient' } });
    await p;
    expect(nav).toHaveBeenCalledWith(['/']);
  });

  it('on 401 shows invalid-code message', async () => {
    cmp.code.set('000000');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/verify-email').flush({}, { status: 401, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/invalid/i);
  });

  it('on 429 shows rate-limit message', async () => {
    cmp.code.set('123456');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/verify-email').flush({}, { status: 429, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/Too many attempts/i);
  });

  it('on other error uses firstErrorReason fallback', async () => {
    cmp.code.set('123456');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/verify-email').flush(
      { ok: false, errors: [{ field: 'code', reason: 'custom error' }] },
      { status: 400, statusText: 'x' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('custom error');
  });

  it('no-ops submit while already submitting', async () => {
    cmp.submitting.set(true);
    await cmp.onSubmit();
    httpMock.expectNone('/api/auth/verify-email');
  });

  it('resend hits endpoint and updates label', async () => {
    const p = cmp.resend();
    httpMock.expectOne('/api/auth/resend-verification').flush({ ok: true });
    await p;
    expect(cmp.resendLabel()).toMatch(/Code sent/);
  });

  it('resend no-ops while already sending', async () => {
    cmp.resending.set(true);
    await cmp.resend();
    httpMock.expectNone('/api/auth/resend-verification');
  });

  it('renders the form and the error banner', () => {
    const fixture = TestBed.createComponent(VerifyEmailComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Verify your email');
    fixture.componentInstance.errorMessage.set('boom');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('boom');
  });
});
