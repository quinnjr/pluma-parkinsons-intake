import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PatientApiService } from './patient-api.service';

describe('PatientApiService', () => {
  let api: PatientApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    api = TestBed.inject(PatientApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listSubmissions unwraps submissions[]', async () => {
    const p = api.listSubmissions();
    httpMock.expectOne('/api/patient/submissions').flush({ ok: true, submissions: [{ id: 's1' }] });
    await expect(p).resolves.toEqual([{ id: 's1' }]);
  });

  it('getSubmission unwraps submission', async () => {
    const p = api.getSubmission('s1');
    httpMock.expectOne('/api/patient/submissions/s1')
      .flush({ ok: true, submission: { id: 's1', markdown: '#' } });
    await expect(p).resolves.toMatchObject({ id: 's1' });
  });

  it('updateSubmission PUTs the patch and returns the updated row', async () => {
    const p = api.updateSubmission('s1', { markdown: '# new' });
    const req = httpMock.expectOne('/api/patient/submissions/s1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ markdown: '# new' });
    req.flush({ ok: true, submission: { id: 's1', markdown: '# new' } });
    await expect(p).resolves.toMatchObject({ markdown: '# new' });
  });

  it('deleteSubmission DELETEs the right path', async () => {
    const p = api.deleteSubmission('s1');
    const req = httpMock.expectOne('/api/patient/submissions/s1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true });
    await p;
  });

  it('claim POSTs lookupCode and unwraps claimed', async () => {
    const p = api.claim('abc');
    const req = httpMock.expectOne('/api/patient/submissions/claim');
    expect(req.request.body).toEqual({ lookupCode: 'abc' });
    req.flush({ ok: true, claimed: { id: 's1', lookupCode: 'abc' } });
    await expect(p).resolves.toEqual({ id: 's1', lookupCode: 'abc' });
  });

  it('deleteMyAccount hits /api/auth/me', async () => {
    const p = api.deleteMyAccount();
    httpMock.expectOne('/api/auth/me').flush({ ok: true });
    await p;
  });

  it('listResearchers unwraps researchers[]', async () => {
    const p = api.listResearchers();
    httpMock.expectOne('/api/patient/researchers')
      .flush({ ok: true, researchers: [{ id: 'r1', email: 'r@x.com', granted: false }] });
    await expect(p).resolves.toHaveLength(1);
  });

  it('grantResearcher POSTs /grant', async () => {
    const p = api.grantResearcher('r1');
    const req = httpMock.expectOne('/api/patient/researchers/r1/grant');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true });
    await p;
  });

  it('revokeResearcher DELETEs /grant', async () => {
    const p = api.revokeResearcher('r1');
    const req = httpMock.expectOne('/api/patient/researchers/r1/grant');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true });
    await p;
  });
});
