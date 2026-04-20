import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AuthService, type AuthedUser } from '../../shared/auth.service';
import { AdminApiService } from '../admin-api.service';

const root: AuthedUser = {
  id: 'u1', email: 'root@x.com', role: 'root', confirmed: true, mfaEnabled: false,
};
const researcher: AuthedUser = { ...root, role: 'researcher', email: 'r@x.com' };

describe('DashboardComponent', () => {
  let cmp: DashboardComponent;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DashboardComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.setAuthenticatedUser(root);
    auth.ready.set(true);
    cmp = TestBed.createComponent(DashboardComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('creates and exposes role-derived computeds', () => {
    expect(cmp.isRoot()).toBe(true);
    expect(cmp.confirmed()).toBe(true);
  });

  it('switchTab lazy-loads users when needed', async () => {
    const api = TestBed.inject(AdminApiService);
    const spy = vi.spyOn(api, 'listUsers').mockResolvedValue([root]);
    cmp.switchTab('users');
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
  });

  it('switchTab does not re-fetch users if already loaded', async () => {
    const api = TestBed.inject(AdminApiService);
    cmp.users.set([root]);
    const spy = vi.spyOn(api, 'listUsers');
    cmp.switchTab('users');
    expect(spy).not.toHaveBeenCalled();
  });

  it('switchTab to users is a no-op for non-root', async () => {
    auth.setAuthenticatedUser(researcher);
    const api = TestBed.inject(AdminApiService);
    const spy = vi.spyOn(api, 'listUsers');
    cmp.switchTab('users');
    expect(spy).not.toHaveBeenCalled();
  });

  it('refreshSubmissions populates signal on success', async () => {
    const p = cmp.refreshSubmissions();
    httpMock.expectOne('/api/admin/submissions').flush({ ok: true, submissions: [{ id: 's1' }] });
    await p;
    expect(cmp.submissions()).toEqual([{ id: 's1' }]);
    expect(cmp.recordsLoading()).toBe(false);
    expect(cmp.recordsError()).toBeNull();
  });

  it('refreshSubmissions sets error on failure', async () => {
    const p = cmp.refreshSubmissions();
    httpMock.expectOne('/api/admin/submissions').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.recordsError()).toMatch(/Could not load/);
  });

  it('viewSubmission populates selected signal', async () => {
    const p = cmp.viewSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({
      ok: true,
      submission: { id: 's1', lookupCode: 'x', markdown: '#', sections: [], schemaVersion: '1', createdAt: '' },
    });
    await p;
    expect(cmp.selected()?.id).toBe('s1');
  });

  it('viewSubmission sets error on failure', async () => {
    const p = cmp.viewSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.recordsError()).toMatch(/Could not load/);
  });

  it('lookupByCode no-ops on empty input', async () => {
    cmp.lookupInput.set('   ');
    await cmp.lookupByCode();
    httpMock.expectNone((r) => r.url.includes('by-lookup'));
  });

  it('lookupByCode 404 shows specific message', async () => {
    cmp.lookupInput.set('abc');
    const p = cmp.lookupByCode();
    httpMock.expectOne('/api/admin/submissions/by-lookup/abc').flush({}, { status: 404, statusText: 'x' });
    await p;
    expect(cmp.recordsError()).toMatch(/No submission/);
  });

  it('lookupByCode other errors show generic message', async () => {
    cmp.lookupInput.set('abc');
    const p = cmp.lookupByCode();
    httpMock.expectOne('/api/admin/submissions/by-lookup/abc').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.recordsError()).toMatch(/Lookup failed/);
  });

  it('closeSelected clears the selection', () => {
    cmp.selected.set({ id: 's1' } as unknown as never);
    cmp.closeSelected();
    expect(cmp.selected()).toBeNull();
  });

  it('deleteSubmission removes from list', async () => {
    cmp.submissions.set([{ id: 's1' }, { id: 's2' }] as unknown as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({ ok: true });
    await p;
    expect(cmp.submissions()).toHaveLength(1);
  });

  it('deleteSubmission clears selected if it matches', async () => {
    cmp.submissions.set([{ id: 's1' }] as unknown as never);
    cmp.selected.set({ id: 's1' } as unknown as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({ ok: true });
    await p;
    expect(cmp.selected()).toBeNull();
  });

  it('deleteSubmission respects confirm-cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await cmp.deleteSubmission('s1');
    httpMock.expectNone((r) => r.url.includes('submissions/s1'));
  });

  it('deleteSubmission sets error on server failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.recordsError()).toMatch(/Delete failed/);
  });

  it('downloadSelectedMarkdown no-ops when nothing selected', () => {
    cmp.selected.set(null);
    expect(() => cmp.downloadSelectedMarkdown()).not.toThrow();
  });

  it('downloadSelectedMarkdown triggers blob flow when selected', () => {
    cmp.selected.set({ lookupCode: 'abc', markdown: '# x' } as unknown as never);
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    cmp.downloadSelectedMarkdown();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refreshUsers populates on success', async () => {
    const p = cmp.refreshUsers();
    httpMock.expectOne('/api/admin/users').flush({ ok: true, users: [root] });
    await p;
    expect(cmp.users()).toEqual([root]);
  });

  it('refreshUsers sets error on failure', async () => {
    const p = cmp.refreshUsers();
    httpMock.expectOne('/api/admin/users').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.usersError()).toMatch(/Could not load/);
  });

  it('confirmUser updates the user in the list', async () => {
    cmp.users.set([{ ...researcher, confirmed: false }]);
    const p = cmp.confirmUser(researcher.id);
    httpMock.expectOne(`/api/admin/users/${researcher.id}/confirm`).flush({
      ok: true, user: { ...researcher, confirmed: true },
    });
    await p;
    expect(cmp.users()[0]!.confirmed).toBe(true);
  });

  it('confirmUser sets error on failure', async () => {
    const p = cmp.confirmUser('u');
    httpMock.expectOne('/api/admin/users/u/confirm').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.usersError()).toMatch(/Confirm failed/);
  });

  it('deleteUser removes user on confirm', async () => {
    cmp.users.set([researcher]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteUser(researcher.id, researcher.email);
    httpMock.expectOne(`/api/admin/users/${researcher.id}`).flush({ ok: true });
    await p;
    expect(cmp.users()).toEqual([]);
  });

  it('deleteUser respects cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await cmp.deleteUser('x', 'x@y');
    httpMock.expectNone((r) => r.url.includes('users/x'));
  });

  it('deleteUser sets error on failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteUser('x', 'x@y');
    httpMock.expectOne('/api/admin/users/x').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.usersError()).toMatch(/Delete failed/);
  });

  it('logout calls AuthService.logout and navigates', async () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate');
    const p = cmp.logout();
    httpMock.expectOne('/api/auth/logout').flush({ ok: true });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/login']);
  });
});
