import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SuperfundService } from './superfund.service';

describe('SuperfundService', () => {
  let svc: SuperfundService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(SuperfundService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('loadStates', () => {
    it('populates the states signal on success', async () => {
      const p = svc.loadStates();
      httpMock.expectOne('/api/superfund/states').flush({
        ok: true,
        states: [{ state: 'FL', siteCount: 97 }],
      });
      await p;
      expect(svc.states()).toEqual([{ state: 'FL', siteCount: 97 }]);
    });

    it('is idempotent — a second call does not re-fetch', async () => {
      const p1 = svc.loadStates();
      httpMock.expectOne('/api/superfund/states').flush({ ok: true, states: [] });
      await p1;
      await svc.loadStates();
      httpMock.expectNone('/api/superfund/states');
    });

    it('falls back to [] on failure and logs', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const p = svc.loadStates();
      httpMock.expectOne('/api/superfund/states').flush({}, { status: 500, statusText: 'x' });
      await p;
      expect(svc.states()).toEqual([]);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('sites', () => {
    it('returns a signal that becomes populated after the fetch resolves', async () => {
      const sig = svc.sites('FL');
      expect(sig()).toBeNull();
      const req = httpMock.expectOne('/api/superfund/sites?state=FL');
      req.flush({
        ok: true,
        sites: [{
          id: 's1', epaId: 'E', name: 'X', city: null, county: null,
          zipCode: null, status: 'final', contaminants: null, epaUrl: null,
        }],
      });
      // Let the .then callback run.
      await Promise.resolve();
      expect(sig()).toHaveLength(1);
    });

    it('returns the same cached signal for repeated state lookups', () => {
      const a = svc.sites('CA');
      const b = svc.sites('CA');
      expect(a).toBe(b);
      httpMock.expectOne('/api/superfund/sites?state=CA').flush({ ok: true, sites: [] });
    });

    it('uppercases the state key in the request URL', () => {
      svc.sites('ny');
      httpMock.expectOne('/api/superfund/sites?state=NY').flush({ ok: true, sites: [] });
    });

    it('sets the signal to [] on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sig = svc.sites('TX');
      httpMock.expectOne('/api/superfund/sites?state=TX')
        .flush({}, { status: 500, statusText: 'x' });
      // Wait a microtask for the .catch to run.
      await Promise.resolve();
      await Promise.resolve();
      expect(sig()).toEqual([]);
      spy.mockRestore();
    });
  });
});
