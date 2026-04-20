import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PatientDashboardComponent } from './patient-dashboard.component';
import { AuthService, type AuthedUser } from '../../shared/auth.service';

const patient: AuthedUser = {
  id: 'u1', email: 'p@x.com', role: 'patient', confirmed: true, mfaEnabled: false,
};

const fullSub = {
  id: 's1', lookupCode: 'abc', markdown: '# original', sections: [],
  schemaVersion: '1.1.0', createdAt: '2026-01-01',
  ageBand: '60-69', sexAtBirth: 'male', zipCode: '33130',
};

describe('PatientDashboardComponent', () => {
  let cmp: PatientDashboardComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientDashboardComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    auth.setAuthenticatedUser(patient);
    auth.ready.set(true);
    cmp = TestBed.createComponent(PatientDashboardComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('refresh populates list on success', async () => {
    const p = cmp.refresh();
    httpMock.expectOne('/api/patient/submissions').flush({
      ok: true, submissions: [{ id: 's1', lookupCode: 'abc' }],
    });
    await p;
    expect(cmp.submissions()).toHaveLength(1);
  });

  it('refresh sets error on failure', async () => {
    const p = cmp.refresh();
    httpMock.expectOne('/api/patient/submissions').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.listError()).toMatch(/Could not load/);
  });

  it('view populates selected with kind=view', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true, submission: fullSub });
    await p;
    expect(cmp.selected()!.kind).toBe('view');
  });

  it('view sets error on failure', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.detailError()).toMatch(/Could not load/);
  });

  it('startEdit / cancelEdit toggle the state kind', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true, submission: fullSub });
    await p;
    cmp.startEdit();
    expect(cmp.selected()!.kind).toBe('edit');
    cmp.cancelEdit();
    expect(cmp.selected()!.kind).toBe('view');
  });

  it('patch updates the editing form', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true, submission: fullSub });
    await p;
    cmp.startEdit();
    cmp.patch('markdown', '# changed');
    const s = cmp.selected()!;
    expect(s.kind === 'edit' && s.markdown === '# changed').toBe(true);
  });

  it('patch no-ops when not in edit mode', async () => {
    cmp.patch('markdown', 'x');
    expect(cmp.selected()).toBeNull();
  });

  it('saveEdit PUTs changes and flips back to view', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true, submission: fullSub });
    await p;
    cmp.startEdit();
    cmp.patch('markdown', '# new');
    const save = cmp.saveEdit();
    const req = httpMock.expectOne('/api/patient/submissions/s1');
    expect(req.request.method).toBe('PUT');
    req.flush({ ok: true, submission: { ...fullSub, markdown: '# new' } });
    await save;
    expect(cmp.selected()!.kind).toBe('view');
    expect(cmp.selected()!.data.markdown).toBe('# new');
  });

  it('saveEdit sets error on failure', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true, submission: fullSub });
    await p;
    cmp.startEdit();
    const save = cmp.saveEdit();
    httpMock.expectOne('/api/patient/submissions/s1').flush(
      { ok: false, errors: [{ field: 'markdown', reason: 'bad' }] },
      { status: 400, statusText: 'x' },
    );
    await save;
    expect(cmp.detailError()).toBe('bad');
  });

  it('saveEdit no-ops outside edit mode or when saving', async () => {
    cmp.selected.set(null);
    await cmp.saveEdit();
    httpMock.expectNone((r) => r.url.includes('submissions'));
  });

  it('downloadSelected invokes URL.createObjectURL when selected', async () => {
    const p = cmp.view('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true, submission: fullSub });
    await p;
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    cmp.downloadSelected();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('downloadSelected no-ops when nothing selected', () => {
    cmp.selected.set(null);
    expect(() => cmp.downloadSelected()).not.toThrow();
  });

  it('deleteSubmission respects confirm-cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await cmp.deleteSubmission('s1');
    httpMock.expectNone((r) => r.url.includes('submissions'));
  });

  it('deleteSubmission removes the row + clears selected when matching', async () => {
    cmp.submissions.set([{ id: 's1' }] as unknown as never);
    cmp.selected.set({ kind: 'view', data: { id: 's1' } as unknown as never });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteSubmission('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({ ok: true });
    await p;
    expect(cmp.submissions()).toEqual([]);
    expect(cmp.selected()).toBeNull();
  });

  it('deleteSubmission sets error on failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteSubmission('s1');
    httpMock.expectOne('/api/patient/submissions/s1').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.listError()).toMatch(/Delete failed/);
  });

  it('closeSelected clears', () => {
    cmp.selected.set({ kind: 'view', data: fullSub } as unknown as never);
    cmp.closeSelected();
    expect(cmp.selected()).toBeNull();
  });

  it('claim no-ops on empty input', async () => {
    cmp.claimInput.set('  ');
    await cmp.claim();
    httpMock.expectNone((r) => r.url.includes('claim'));
  });

  it('claim refreshes on success', async () => {
    cmp.claimInput.set('code1');
    const p = cmp.claim();
    httpMock.expectOne('/api/patient/submissions/claim').flush({ ok: true, claimed: { id: 's1', lookupCode: 'code1' } });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    httpMock.expectOne('/api/patient/submissions').flush({ ok: true, submissions: [] });
    await p;
    expect(cmp.claimInput()).toBe('');
  });

  it('claim 404 sets specific message', async () => {
    cmp.claimInput.set('x');
    const p = cmp.claim();
    httpMock.expectOne('/api/patient/submissions/claim').flush({}, { status: 404, statusText: 'x' });
    await p;
    expect(cmp.claimError()).toMatch(/No record/);
  });

  it('claim 409 sets specific message', async () => {
    cmp.claimInput.set('x');
    const p = cmp.claim();
    httpMock.expectOne('/api/patient/submissions/claim').flush({}, { status: 409, statusText: 'x' });
    await p;
    expect(cmp.claimError()).toMatch(/already claimed/);
  });

  it('claim other error falls back', async () => {
    cmp.claimInput.set('x');
    const p = cmp.claim();
    httpMock.expectOne('/api/patient/submissions/claim').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.claimError()).toMatch(/Claim failed/);
  });

  it('deleteMyAccount respects cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await cmp.deleteMyAccount();
    httpMock.expectNone((r) => r.url.includes('auth/me'));
  });

  it('deleteMyAccount on success logs out and routes to /', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate');
    const p = cmp.deleteMyAccount();
    httpMock.expectOne('/api/auth/me').flush({ ok: true });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    httpMock.expectOne('/api/auth/logout').flush({ ok: true });
    await p;
    expect(nav).toHaveBeenCalledWith(['/']);
  });

  it('deleteMyAccount sets error on failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = cmp.deleteMyAccount();
    httpMock.expectOne('/api/auth/me').flush({}, { status: 500, statusText: 'x' });
    await p;
    expect(cmp.listError()).toMatch(/Account deletion failed/);
  });

  it('logout navigates to /admin/login', async () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate');
    const p = cmp.logout();
    httpMock.expectOne('/api/auth/logout').flush({ ok: true });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/login']);
  });
});
