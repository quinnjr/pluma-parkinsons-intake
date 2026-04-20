import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AdminApiService } from './admin-api.service';

describe('AdminApiService', () => {
  let api: AdminApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    api = TestBed.inject(AdminApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listSubmissions', async () => {
    const p = api.listSubmissions();
    httpMock.expectOne('/api/admin/submissions').flush({ ok: true, submissions: [{ id: 's1' }] });
    await expect(p).resolves.toEqual([{ id: 's1' }]);
  });

  it('getSubmission', async () => {
    const p = api.getSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({ ok: true, submission: { id: 's1' } });
    await expect(p).resolves.toMatchObject({ id: 's1' });
  });

  it('getByLookupCode encodes the code', async () => {
    const p = api.getByLookupCode('abc/def');
    httpMock.expectOne(`/api/admin/submissions/by-lookup/${encodeURIComponent('abc/def')}`).flush({
      ok: true, submission: { id: 's1' },
    });
    await p;
  });

  it('deleteSubmission', async () => {
    const p = api.deleteSubmission('s1');
    httpMock.expectOne('/api/admin/submissions/s1').flush({ ok: true });
    await p;
  });

  it('listUsers', async () => {
    const p = api.listUsers();
    httpMock.expectOne('/api/admin/users').flush({ ok: true, users: [{ id: 'u1' }] });
    await expect(p).resolves.toEqual([{ id: 'u1' }]);
  });

  it('confirmUser', async () => {
    const p = api.confirmUser('u1');
    const req = httpMock.expectOne('/api/admin/users/u1/confirm');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, user: { id: 'u1', confirmed: true } });
    await expect(p).resolves.toMatchObject({ confirmed: true });
  });

  it('deleteUser', async () => {
    const p = api.deleteUser('u1');
    httpMock.expectOne('/api/admin/users/u1').flush({ ok: true });
    await p;
  });
});
