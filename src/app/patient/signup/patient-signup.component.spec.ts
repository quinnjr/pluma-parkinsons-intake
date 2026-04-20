import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PatientSignupComponent } from './patient-signup.component';

describe('PatientSignupComponent', () => {
  let cmp: PatientSignupComponent;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientSignupComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    cmp = TestBed.createComponent(PatientSignupComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('rejects short password locally', async () => {
    cmp.email.set('p@x.com');
    cmp.password.set('short');
    await cmp.onSubmit();
    expect(cmp.errorMessage()).toMatch(/at least 12/);
  });

  it('navigates to verify-email on success', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.email.set('p@x.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/signup/patient').flush({
      ok: true, user: { id: 'u', email: 'p@x.com', role: 'patient', confirmed: true, mfaEnabled: false },
    });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/verify-email'], { queryParams: { email: 'p@x.com' } });
  });

  it('on 409 shows server reason', async () => {
    cmp.email.set('p@x.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/signup/patient').flush(
      { ok: false, errors: [{ field: 'email', reason: 'already registered' }] },
      { status: 409, statusText: 'Conflict' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('already registered');
  });

  it('on 500 shows generic message', async () => {
    cmp.email.set('p@x.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/signup/patient').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/Could not create/);
  });

  it('no-ops while submitting', async () => {
    cmp.submitting.set(true);
    await cmp.onSubmit();
    httpMock.expectNone('/api/auth/signup/patient');
  });
});
