import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MfaSettingsComponent } from './mfa-settings.component';
import { AuthService, type AuthedUser } from './auth.service';

const user: AuthedUser = {
  id: 'u', email: 'a@b.com', role: 'researcher', confirmed: true, mfaEnabled: false,
};

describe('MfaSettingsComponent', () => {
  let cmp: MfaSettingsComponent;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MfaSettingsComponent, HttpClientTestingModule] });
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.setAuthenticatedUser(user);
    auth.ready.set(true);
    cmp = TestBed.createComponent(MfaSettingsComponent).componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('enabled mirrors auth.user.mfaEnabled', () => {
    expect(cmp.enabled()).toBe(false);
    auth.setAuthenticatedUser({ ...user, mfaEnabled: true });
    expect(cmp.enabled()).toBe(true);
  });

  it('busy reflects phase', () => {
    cmp.phase.set('confirming');
    expect(cmp.busy()).toBe(true);
    cmp.phase.set('disabling');
    expect(cmp.busy()).toBe(true);
    cmp.phase.set('regenerating');
    expect(cmp.busy()).toBe(true);
    cmp.phase.set('idle');
    expect(cmp.busy()).toBe(false);
    cmp.phase.set('setup');
    expect(cmp.busy()).toBe(false);
  });

  describe('startSetup', () => {
    it('populates setupInfo and flips to phase=setup', async () => {
      const p = cmp.startSetup();
      httpMock.expectOne('/api/auth/mfa/setup').flush({
        ok: true, secret: 'S', otpauthUrl: 'otp', qrDataUrl: 'data:',
      });
      await p;
      expect(cmp.phase()).toBe('setup');
      expect(cmp.setupInfo()).toMatchObject({ secret: 'S' });
    });

    it('sets error on failure', async () => {
      const p = cmp.startSetup();
      httpMock.expectOne('/api/auth/mfa/setup').flush(
        { ok: false, errors: [{ field: 'x', reason: 'nope' }] },
        { status: 500, statusText: 'x' },
      );
      await p;
      expect(cmp.errorMessage()).toBe('nope');
    });
  });

  describe('confirmEnable', () => {
    it('no-ops on <6 digits', async () => {
      cmp.code.set('1');
      await cmp.confirmEnable();
      httpMock.expectNone('/api/auth/mfa/enable');
    });

    it('on success returns codes, clears state, goes idle', async () => {
      cmp.phase.set('setup');
      cmp.setupInfo.set({ secret: 'S', otpauthUrl: 'otp', qrDataUrl: 'data:' });
      cmp.code.set('123456');
      const p = cmp.confirmEnable();
      httpMock.expectOne('/api/auth/mfa/enable').flush({ ok: true, recoveryCodes: ['a-b'] });
      // allow refreshMe to fire
      for (let i = 0; i < 5; i++) await Promise.resolve();
      httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
      await p;
      expect(cmp.recoveryCodes()).toEqual(['a-b']);
      expect(cmp.setupInfo()).toBeNull();
      expect(cmp.phase()).toBe('idle');
    });

    it('on failure reverts to phase=setup + shows error', async () => {
      cmp.phase.set('setup');
      cmp.code.set('000000');
      const p = cmp.confirmEnable();
      httpMock.expectOne('/api/auth/mfa/enable').flush(
        { ok: false, errors: [{ field: 'code', reason: 'bad' }] },
        { status: 401, statusText: 'x' },
      );
      await p;
      expect(cmp.phase()).toBe('setup');
      expect(cmp.errorMessage()).toBe('bad');
    });
  });

  describe('onConfirmDangerous', () => {
    it('disable path hits mfa/disable and goes idle on success', async () => {
      cmp.phase.set('disabling');
      cmp.code.set('123456');
      const p = cmp.onConfirmDangerous();
      httpMock.expectOne('/api/auth/mfa/disable').flush({ ok: true });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      httpMock.expectOne('/api/auth/me').flush({ ok: true, user });
      await p;
      expect(cmp.phase()).toBe('idle');
    });

    it('regenerate path sets recoveryCodes', async () => {
      cmp.phase.set('regenerating');
      cmp.code.set('123456');
      const p = cmp.onConfirmDangerous();
      httpMock.expectOne('/api/auth/mfa/regenerate-codes').flush({
        ok: true, recoveryCodes: ['x-y'],
      });
      await p;
      expect(cmp.recoveryCodes()).toEqual(['x-y']);
      expect(cmp.phase()).toBe('idle');
    });

    it('no-ops with <6 digits', async () => {
      cmp.phase.set('disabling');
      cmp.code.set('1');
      await cmp.onConfirmDangerous();
      httpMock.expectNone((r) => r.url.includes('mfa/disable'));
    });

    it('error path surfaces message and keeps phase', async () => {
      cmp.phase.set('disabling');
      cmp.code.set('000000');
      const p = cmp.onConfirmDangerous();
      httpMock.expectOne('/api/auth/mfa/disable').flush(
        { ok: false, errors: [{ field: 'code', reason: 'nope' }] },
        { status: 401, statusText: 'x' },
      );
      await p;
      expect(cmp.errorMessage()).toBe('nope');
    });
  });

  it('cancelDangerous resets phase + code + error', () => {
    cmp.phase.set('disabling');
    cmp.code.set('123');
    cmp.errorMessage.set('oops');
    cmp.cancelDangerous();
    expect(cmp.phase()).toBe('idle');
    expect(cmp.code()).toBe('');
    expect(cmp.errorMessage()).toBeNull();
  });

  it('acknowledgeCodes clears recoveryCodes + copied', () => {
    cmp.recoveryCodes.set(['x']);
    cmp.copied.set(true);
    cmp.acknowledgeCodes();
    expect(cmp.recoveryCodes()).toBeNull();
    expect(cmp.copied()).toBe(false);
  });

  it('copyCodes writes and flips copied briefly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    await cmp.copyCodes(['a', 'b']);
    expect(writeText).toHaveBeenCalledWith('a\nb');
    expect(cmp.copied()).toBe(true);
  });

  it('copyCodes swallows clipboard failures', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    await expect(cmp.copyCodes(['a'])).resolves.toBeUndefined();
    expect(cmp.copied()).toBe(false);
  });

  it('downloadCodes invokes URL.createObjectURL', () => {
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    cmp.downloadCodes(['a', 'b']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('renders idle button + setup QR when not enabled', () => {
    const fixture = TestBed.createComponent(MfaSettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enable two-factor');

    fixture.componentInstance.phase.set('setup');
    fixture.componentInstance.setupInfo.set({
      secret: 'S', otpauthUrl: 'otp', qrDataUrl: 'data:image/png;base64,abc',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeTruthy();
  });

  it('renders enabled banner + disabling prompt + recovery codes + error', () => {
    auth.setAuthenticatedUser({ ...user, mfaEnabled: true });
    const fixture = TestBed.createComponent(MfaSettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Two-factor authentication is');

    fixture.componentInstance.phase.set('disabling');
    fixture.detectChanges();

    fixture.componentInstance.recoveryCodes.set(['a-b', 'c-d']);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Save these recovery passcodes');

    fixture.componentInstance.errorMessage.set('oops');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('oops');
  });
});
