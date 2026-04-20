import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { convertToParamMap } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ResetPasswordComponent } from './reset-password.component';

function setup(token: string | null) {
  const route = {
    snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) },
  } as unknown as ActivatedRoute;
  TestBed.configureTestingModule({
    imports: [ResetPasswordComponent, HttpClientTestingModule],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ActivatedRoute, useValue: route },
    ],
  });
  return {
    cmp: TestBed.createComponent(ResetPasswordComponent).componentInstance,
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('ResetPasswordComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('reads token from query params', () => {
    const { cmp } = setup('tok');
    expect(cmp.token()).toBe('tok');
  });

  it('isValid requires match + length', () => {
    const { cmp } = setup('tok');
    cmp.password.set('short');
    cmp.confirm.set('short');
    expect(cmp.isValid()).toBe(false);
    cmp.password.set('LongEnoughPassword1');
    cmp.confirm.set('LongEnoughPassword2');
    expect(cmp.isValid()).toBe(false);
    cmp.confirm.set('LongEnoughPassword1');
    expect(cmp.isValid()).toBe(true);
  });

  it('submits and flips success on 200', async () => {
    const { cmp, httpMock } = setup('tok');
    cmp.password.set('LongEnoughPassword1');
    cmp.confirm.set('LongEnoughPassword1');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/reset-password').flush({ ok: true });
    await p;
    expect(cmp.success()).toBe(true);
  });

  it('shows invalid-link message on 401', async () => {
    const { cmp, httpMock } = setup('tok');
    cmp.password.set('LongEnoughPassword1');
    cmp.confirm.set('LongEnoughPassword1');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/reset-password').flush({}, { status: 401, statusText: 'x' });
    await p;
    expect(cmp.errorMessage()).toMatch(/invalid or has expired/i);
  });

  it('falls back to firstErrorReason for other errors', async () => {
    const { cmp, httpMock } = setup('tok');
    cmp.password.set('LongEnoughPassword1');
    cmp.confirm.set('LongEnoughPassword1');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/reset-password').flush(
      { ok: false, errors: [{ field: 'pw', reason: 'weak' }] },
      { status: 400, statusText: 'x' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('weak');
  });

  it('no-ops when invalid', async () => {
    const { cmp, httpMock } = setup('tok');
    cmp.password.set('short');
    await cmp.onSubmit();
    httpMock.expectNone('/api/auth/reset-password');
  });
});
