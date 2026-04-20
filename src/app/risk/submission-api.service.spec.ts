import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SubmissionApiService } from './submission-api.service';
import type { AnonymizedPayload } from './risk.model';

const payload: AnonymizedPayload = {
  schemaVersion: '1.1.0',
  generatedAt: '2026-01-01T00:00:00Z',
  zipCode: '33130',
  ageBand: '60-69',
  sexAtBirth: 'male',
  markdown: '# x',
  sections: [],
  livedInStates: [],
};

describe('SubmissionApiService', () => {
  let api: SubmissionApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [SubmissionApiService],
    });
    api = TestBed.inject(SubmissionApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs the payload as-is to /api/submissions', async () => {
    const p = api.create(payload);
    const req = httpMock.expectOne('/api/submissions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ ok: true, id: 's1', lookupCode: 'ab', createdAt: '2026-01-01' });
    await expect(p).resolves.toEqual({
      ok: true, id: 's1', lookupCode: 'ab', createdAt: '2026-01-01',
    });
  });

  it('forwards a server-side error envelope', async () => {
    const p = api.create(payload);
    const req = httpMock.expectOne('/api/submissions');
    req.flush({ ok: false, errors: [{ field: 'x', reason: 'bad' }] });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ field: 'x', reason: 'bad' });
  });
});
