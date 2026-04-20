import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api-client';

describe('ApiClient', () => {
  let api: ApiClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiClient],
    });
    api = TestBed.inject(ApiClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('get() unwraps the observable into a promise', async () => {
    const p = api.get<{ value: number }>('/api/thing');
    const req = httpMock.expectOne('/api/thing');
    expect(req.request.method).toBe('GET');
    req.flush({ value: 42 });
    await expect(p).resolves.toEqual({ value: 42 });
  });

  it('post() sends the provided body', async () => {
    const p = api.post<{ ok: true }>('/api/x', { a: 1 });
    const req = httpMock.expectOne('/api/x');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ a: 1 });
    req.flush({ ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('post() with default empty body', async () => {
    const p = api.post('/api/y');
    const req = httpMock.expectOne('/api/y');
    expect(req.request.body).toEqual({});
    req.flush({});
    await p;
  });

  it('put() sends the provided body', async () => {
    const p = api.put<{ ok: true }>('/api/z', { b: 2 });
    const req = httpMock.expectOne('/api/z');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ b: 2 });
    req.flush({ ok: true });
    await p;
  });

  it('delete() resolves to { ok: true } by default', async () => {
    const p = api.delete('/api/w');
    const req = httpMock.expectOne('/api/w');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });
});
