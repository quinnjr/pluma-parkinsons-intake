import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ResearchersComponent } from './researchers.component';

const r1 = { id: 'r1', email: 'r1@x.com', createdAt: '', granted: false, grantedAt: null };
const r2 = { id: 'r2', email: 'r2@x.com', createdAt: '', granted: true, grantedAt: '2026-01-01' };

describe('ResearchersComponent', () => {
  let cmp: ResearchersComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ResearchersComponent, HttpClientTestingModule] });
    httpMock = TestBed.inject(HttpTestingController);
    cmp = TestBed.createComponent(ResearchersComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('refresh populates entries', async () => {
    const p = cmp.refresh();
    httpMock.expectOne('/api/patient/researchers').flush({ ok: true, researchers: [r1, r2] });
    await p;
    expect(cmp.entries()).toHaveLength(2);
    expect(cmp.loading()).toBe(false);
  });

  it('refresh falls back to error reason on failure', async () => {
    const p = cmp.refresh();
    httpMock.expectOne('/api/patient/researchers').flush(
      { ok: false, errors: [{ field: 'body', reason: 'oops' }] },
      { status: 500, statusText: 'x' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('oops');
  });

  it('grant toggles granted + timestamp', async () => {
    cmp.entries.set([r1]);
    const p = cmp.grant('r1');
    httpMock.expectOne('/api/patient/researchers/r1/grant').flush({ ok: true });
    await p;
    expect(cmp.entries()[0]!.granted).toBe(true);
    expect(cmp.entries()[0]!.grantedAt).toBeTruthy();
  });

  it('grant failure sets error (entries unchanged)', async () => {
    cmp.entries.set([r1]);
    const p = cmp.grant('r1');
    httpMock.expectOne('/api/patient/researchers/r1/grant').flush(
      { ok: false, errors: [{ field: 'x', reason: 'nope' }] },
      { status: 500, statusText: 'x' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('nope');
    expect(cmp.entries()[0]!.granted).toBe(false);
  });

  it('revoke flips granted to false', async () => {
    cmp.entries.set([r2]);
    const p = cmp.revoke('r2');
    httpMock.expectOne('/api/patient/researchers/r2/grant').flush({ ok: true });
    await p;
    expect(cmp.entries()[0]!.granted).toBe(false);
  });

  it('revoke failure sets error', async () => {
    cmp.entries.set([r2]);
    const p = cmp.revoke('r2');
    httpMock.expectOne('/api/patient/researchers/r2/grant').flush(
      { ok: false, errors: [{ field: 'x', reason: 'deny' }] },
      { status: 500, statusText: 'x' },
    );
    await p;
    expect(cmp.errorMessage()).toBe('deny');
  });

  it('renders empty state, populated rows, and error banner', () => {
    const fixture = TestBed.createComponent(ResearchersComponent);
    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush({ ok: true, researchers: [] }));
    expect(fixture.nativeElement.textContent).toContain('No confirmed researchers yet');

    fixture.componentInstance.entries.set([r1, r2]);
    fixture.componentInstance.errorMessage.set('boom');
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('r1@x.com');
    expect(txt).toContain('r2@x.com');
    expect(txt).toContain('Granted');
    expect(txt).toContain('No access');
    expect(txt).toContain('boom');
  });
});
