import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ForgotPasswordComponent } from './forgot-password.component';

describe('ForgotPasswordComponent', () => {
  let cmp: ForgotPasswordComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    cmp = TestBed.createComponent(ForgotPasswordComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('posts the email and flips submitted=true', async () => {
    cmp.email.set(' a@b.com ');
    const p = cmp.onSubmit();
    const req = httpMock.expectOne('/api/auth/request-reset');
    expect(req.request.body).toEqual({ email: 'a@b.com' });
    req.flush({ ok: true });
    await p;
    expect(cmp.submitted()).toBe(true);
  });

  it('flips submitted even on network error (no enumeration leak)', async () => {
    cmp.email.set('a@b.com');
    const p = cmp.onSubmit();
    httpMock.expectOne('/api/auth/request-reset').flush({}, { status: 500, statusText: 'x' });
    await p.catch(() => {});
    expect(cmp.submitted()).toBe(true);
  });

  it('no-ops when already submitting', async () => {
    cmp.submitting.set(true);
    await cmp.onSubmit();
    httpMock.expectNone('/api/auth/request-reset');
  });

  it('renders the form initially and the success message after submit', () => {
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reset your password');

    fixture.componentInstance.submitted.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Check your email');
  });
});
