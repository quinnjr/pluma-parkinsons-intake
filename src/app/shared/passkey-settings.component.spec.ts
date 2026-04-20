import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PasskeySettingsComponent } from './passkey-settings.component';
import { WebAuthnService } from './webauthn.service';

const cred = {
  id: 'c1', nickname: 'MacBook', deviceType: 'multiDevice', backedUp: true,
  transports: 'internal', createdAt: '2026-01-01', lastUsedAt: '2026-01-02',
};

describe('PasskeySettingsComponent', () => {
  let cmp: PasskeySettingsComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PasskeySettingsComponent, HttpClientTestingModule] });
    httpMock = TestBed.inject(HttpTestingController);
    cmp = TestBed.createComponent(PasskeySettingsComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('refresh populates credentials on success', async () => {
    const p = cmp.refresh();
    httpMock.expectOne('/api/auth/webauthn/credentials').flush({ ok: true, credentials: [cred] });
    await p;
    expect(cmp.credentials()).toHaveLength(1);
  });

  it('refresh sets error on failure (fallback message)', async () => {
    const p = cmp.refresh();
    httpMock.expectOne('/api/auth/webauthn/credentials').flush(
      {},
      { status: 500, statusText: 'x' },
    );
    await p;
    expect(cmp.errorMessage()).toMatch(/Could not load/);
  });

  describe('register', () => {
    it('no-ops when already registering', async () => {
      cmp.registering.set(true);
      await cmp.register();
      expect(httpMock.match(() => true)).toEqual([]);
    });

    it('calls WebAuthnService and refreshes on success', async () => {
      const svc = TestBed.inject(WebAuthnService);
      vi.spyOn(svc, 'registerBeginAndFinish').mockResolvedValue();
      vi.spyOn(svc, 'listCredentials').mockResolvedValue([cred]);
      cmp.nickname.set('phone');
      await cmp.register();
      expect(cmp.credentials()).toHaveLength(1);
      expect(cmp.nickname()).toBe('');
      expect(cmp.registering()).toBe(false);
    });

    it('swallows AbortError silently', async () => {
      const svc = TestBed.inject(WebAuthnService);
      const abort = new Error('user cancelled');
      abort.name = 'AbortError';
      vi.spyOn(svc, 'registerBeginAndFinish').mockRejectedValue(abort);
      await cmp.register();
      expect(cmp.errorMessage()).toBeNull();
    });

    it('shows error on real failure', async () => {
      const svc = TestBed.inject(WebAuthnService);
      vi.spyOn(svc, 'registerBeginAndFinish').mockRejectedValue(new Error('boom'));
      await cmp.register();
      expect(cmp.errorMessage()).toMatch(/Registration failed/);
    });
  });

  describe('remove', () => {
    it('deletes the credential and filters the list', async () => {
      cmp.credentials.set([cred, { ...cred, id: 'c2' }]);
      const p = cmp.remove('c1');
      httpMock.expectOne('/api/auth/webauthn/credentials/c1').flush({ ok: true });
      await p;
      expect(cmp.credentials()).toHaveLength(1);
      expect(cmp.credentials()[0]!.id).toBe('c2');
    });

    it('sets error on failure', async () => {
      const p = cmp.remove('c1');
      httpMock.expectOne('/api/auth/webauthn/credentials/c1').flush(
        {},
        { status: 500, statusText: 'x' },
      );
      await p;
      expect(cmp.errorMessage()).toMatch(/Could not remove/);
    });
  });

  it('renders empty form, populated list, and error banner', () => {
    // drain the outer-beforeEach afterNextRender refresh + this one
    const fixture = TestBed.createComponent(PasskeySettingsComponent);
    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush({ ok: true, credentials: [] }));

    expect(fixture.nativeElement.textContent).toContain('Add a passkey');

    fixture.componentInstance.credentials.set([
      cred,
      { ...cred, id: 'c2', deviceType: 'singleDevice', backedUp: false, lastUsedAt: null, nickname: null },
    ]);
    fixture.componentInstance.errorMessage.set('boom');
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('MacBook');
    expect(txt).toContain('Synced');
    expect(txt).toContain('Device-bound');
    expect(txt).toContain('boom');
  });
});
