import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AuthService, type AuthedUser } from './auth.service';
import { authGuard } from './auth.guard';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

const patient: AuthedUser = {
  id: 'u1', email: 'p@x', role: 'patient', confirmed: true, mfaEnabled: false,
};
const researcher: AuthedUser = { ...patient, role: 'researcher', email: 'r@x' };

function runGuard(routeData: Record<string, unknown> | undefined): Promise<unknown> {
  const route = { data: routeData } as unknown as ActivatedRouteSnapshot;
  const state = { url: '/x' } as unknown as RouterStateSnapshot;
  return TestBed.runInInjectionContext(
    () => authGuard(route, state) as Promise<unknown>,
  );
}

describe('authGuard', () => {
  let httpMock: HttpTestingController;
  let router: Router;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => httpMock.verify());

  it('redirects unauthenticated callers to /admin/login', async () => {
    const p = runGuard(undefined);
    httpMock.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'x' });
    const result = await p;
    // createUrlTree returns a UrlTree; minimally verify it's not the boolean `true`
    expect(result).not.toBe(true);
    expect(router.serializeUrl(result as ReturnType<typeof router.createUrlTree>))
      .toContain('/admin/login');
  });

  it('allows through when auth matches required role', async () => {
    auth.setAuthenticatedUser(researcher);
    auth.ready.set(true);
    const result = await runGuard({ roles: ['root', 'researcher'] });
    expect(result).toBe(true);
  });

  it('redirects patient to /patient when a staff route is hit', async () => {
    auth.setAuthenticatedUser(patient);
    auth.ready.set(true);
    const result = await runGuard({ roles: ['root', 'researcher'] });
    expect(result).not.toBe(true);
    expect(router.serializeUrl(result as ReturnType<typeof router.createUrlTree>))
      .toContain('/patient');
  });

  it('redirects staff to /admin when a patient route is hit', async () => {
    auth.setAuthenticatedUser(researcher);
    auth.ready.set(true);
    const result = await runGuard({ roles: ['patient'] });
    expect(router.serializeUrl(result as ReturnType<typeof router.createUrlTree>))
      .toContain('/admin');
  });

  it('allows through when the route has no role requirement', async () => {
    auth.setAuthenticatedUser(patient);
    auth.ready.set(true);
    const result = await runGuard(undefined);
    expect(result).toBe(true);
  });

  it('triggers loadMe when not yet ready', async () => {
    const p = runGuard(undefined);
    httpMock.expectOne('/api/auth/me').flush({ ok: true, user: patient });
    await p;
    expect(auth.ready()).toBe(true);
    expect(auth.user()).toEqual(patient);
  });
});
