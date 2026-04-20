import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SubmissionReviewComponent } from './submission-review.component';
import type { IntakePayload } from '../risk/risk.model';
import { EMPTY_INTAKE } from '../risk/risk.model';
import { IntakePayloadService } from '../risk/risk.service';

function makePayload(): IntakePayload {
  const svc = new IntakePayloadService();
  const form = structuredClone(EMPTY_INTAKE);
  form.demographics.ageBand = '60-69';
  form.narrative = 'some notes';
  return svc.build(form);
}

describe('SubmissionReviewComponent', () => {
  let fixture: ComponentFixture<SubmissionReviewComponent>;
  let cmp: SubmissionReviewComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SubmissionReviewComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SubmissionReviewComponent);
    fixture.componentRef.setInput('payload', makePayload());
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('exposes anonymized / nonEmptySections / completedDate computeds', () => {
    expect(cmp.anonymized().markdown).toContain('age band 60-69');
    expect(cmp.nonEmptySections().length).toBeGreaterThan(0);
    expect(typeof cmp.completedDate()).toBe('string');
  });

  it('savedState / errorState track saveState', () => {
    cmp.saveState.set({ kind: 'saved', id: 's', lookupCode: 'l', createdAt: 'c' });
    expect(cmp.savedState()).toMatchObject({ kind: 'saved' });
    cmp.saveState.set({ kind: 'error', message: 'oops' });
    expect(cmp.errorState()).toMatchObject({ kind: 'error', message: 'oops' });
  });

  it('copyMarkdown writes markdown and flips copied briefly', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    await cmp.copyMarkdown();
    expect(writeText).toHaveBeenCalled();
    expect(cmp.copied()).toBe(true);
    vi.advanceTimersByTime(2001);
    expect(cmp.copied()).toBe(false);
    vi.useRealTimers();
  });

  it('copyMarkdown swallows clipboard failures', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    await expect(cmp.copyMarkdown()).resolves.toBeUndefined();
    expect(cmp.copied()).toBe(false);
  });

  it('downloadMarkdown invokes URL.createObjectURL', () => {
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    cmp.downloadMarkdown();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('printReport calls window.print when available', () => {
    const spy = vi.spyOn(window, 'print').mockImplementation(() => {});
    cmp.printReport();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('saveAnonymized hits /api/submissions + populates saved state', async () => {
    const p = cmp.saveAnonymized();
    httpMock.expectOne('/api/submissions').flush({
      ok: true, id: 's1', lookupCode: 'lc', createdAt: '2026-01-01',
    });
    await p;
    expect(cmp.savedState()).toMatchObject({ id: 's1', lookupCode: 'lc' });
  });

  it('saveAnonymized renders server-side validation errors', async () => {
    const p = cmp.saveAnonymized();
    httpMock.expectOne('/api/submissions').flush({
      ok: false, errors: [{ field: 'markdown', reason: 'missing' }, { field: 'zipCode', reason: 'bad' }],
    });
    await p;
    expect(cmp.errorState()?.message).toContain('markdown: missing');
    expect(cmp.errorState()?.message).toContain('zipCode: bad');
  });

  it('saveAnonymized falls back to a generic message when errors[] is empty', async () => {
    const p = cmp.saveAnonymized();
    httpMock.expectOne('/api/submissions').flush({ ok: false, errors: [] });
    await p;
    expect(cmp.errorState()?.message).toMatch(/Server rejected/);
  });

  it('saveAnonymized handles a network error', async () => {
    const p = cmp.saveAnonymized();
    httpMock.expectOne('/api/submissions').error(new ProgressEvent('error'));
    await p;
    expect(cmp.errorState()?.message).toBeTruthy();
  });

  it('saveAnonymized no-ops if already saving or saved', async () => {
    cmp.saveState.set({ kind: 'saving' });
    await cmp.saveAnonymized();
    httpMock.expectNone((r) => r.url.includes('submissions'));
    cmp.saveState.set({ kind: 'saved', id: 'x', lookupCode: 'y', createdAt: 'z' });
    await cmp.saveAnonymized();
    httpMock.expectNone((r) => r.url.includes('submissions'));
  });
});
