import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SignupComponent } from './signup.component';
import type { AuthedUser } from '../../shared/auth.service';

const user: AuthedUser = {
  id: 'u', email: 'a@b.com', role: 'researcher', confirmed: false, mfaEnabled: false,
};

describe('SignupComponent', () => {
  let cmp: SignupComponent;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SignupComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    cmp = TestBed.createComponent(SignupComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('rejects too-short password locally', async () => {
    cmp.email.set('a@b.com');
    cmp.password.set('short');
    await cmp.onSubmit();
    expect(cmp.errorMessage()).toMatch(/at least 12/);
  });

  it('navigates to verify-email on success', async () => {
    const nav = vi.spyOn(router, 'navigate');
    cmp.email.set('a@b.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/signup').flush({ ok: true, user });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/verify-email'], { queryParams: { email: user.email } });
    expect(cmp.created()).toEqual(user);
  });

  it('on 409 conflict shows the server reason', async () => {
    cmp.email.set('a@b.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/signup').flush(
      { ok: false, errors: [{ field: 'email', reason: 'already registered' }] },
      { status: 409, statusText: 'Conflict' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('already registered');
  });

  it('on 500 shows generic error', async () => {
    cmp.email.set('a@b.com');
    cmp.password.set('Correct-Horse-Battery-Staple');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/signup').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/Could not create/);
  });

  it('no-ops while submitting', async () => {
    cmp.submitting.set(true);
    await cmp.onSubmit();
    httpMock.expectNone('/api/auth/signup');
  });
});
