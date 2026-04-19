import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';

export type Role = 'root' | 'researcher' | 'patient';

export interface AuthedUser {
  id: string;
  email: string;
  role: Role;
  confirmed: boolean;
  mfaEnabled: boolean;
}

export type LoginResult =
  | { kind: 'success'; user: AuthedUser }
  | { kind: 'mfa'; challengeToken: string };

interface OkUser {
  ok: true;
  user: AuthedUser;
}

interface OkLoginResponse {
  ok: true;
  user?: AuthedUser;
  mfaRequired?: boolean;
  challengeToken?: string;
}

interface OkSignupResponse extends OkUser {
  verificationRequired?: boolean;
  claimed?: { id: string; lookupCode: string } | null;
}

export interface MfaSetupInfo {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiClient);
  readonly user = signal<AuthedUser | null>(null);
  readonly ready = signal(false);

  // Memoize the in-flight request so concurrent callers (e.g. intake-form
  // init + the admin route guard) don't fire duplicate /api/auth/me calls.
  private loadMeInFlight: Promise<void> | null = null;

  loadMe(): Promise<void> {
    if (this.ready()) return Promise.resolve();
    this.loadMeInFlight ??= (async () => {
      try {
        const res = await this.api.get<OkUser>('/api/auth/me');
        this.user.set(res.user);
      } catch {
        this.user.set(null);
      } finally {
        this.ready.set(true);
        this.loadMeInFlight = null;
      }
    })();
    return this.loadMeInFlight;
  }

  async refreshMe(): Promise<void> {
    // Let any in-flight loadMe settle first so we don't race and leave the
    // wrong user in the signal.
    if (this.loadMeInFlight) await this.loadMeInFlight;
    try {
      const res = await this.api.get<OkUser>('/api/auth/me');
      this.user.set(res.user);
    } catch {
      /* ignore */
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const res = await this.api.post<OkLoginResponse>('/api/auth/login', { email, password });
    if (res.mfaRequired && res.challengeToken) {
      return { kind: 'mfa', challengeToken: res.challengeToken };
    }
    if (res.user) {
      this.user.set(res.user);
      return { kind: 'success', user: res.user };
    }
    throw new Error('Unexpected login response');
  }

  async loginWithMfa(challengeToken: string, code: string): Promise<AuthedUser> {
    const { user } = await this.api.post<OkUser>('/api/auth/login/mfa', { challengeToken, code });
    this.user.set(user);
    return user;
  }

  async signup(email: string, password: string): Promise<AuthedUser> {
    const { user } = await this.api.post<OkSignupResponse>('/api/auth/signup', { email, password });
    return user;
  }

  async signupPatient(
    email: string,
    password: string,
    lookupCode?: string,
  ): Promise<{ user: AuthedUser; claimed: { id: string; lookupCode: string } | null }> {
    const body: { email: string; password: string; lookupCode?: string } = { email, password };
    if (lookupCode) body.lookupCode = lookupCode;
    const { user, claimed } = await this.api.post<OkSignupResponse>(
      '/api/auth/signup/patient',
      body,
    );
    return { user, claimed: claimed ?? null };
  }

  async verifyEmail(email: string, code: string): Promise<AuthedUser> {
    const { user } = await this.api.post<OkUser>('/api/auth/verify-email', { email, code });
    this.user.set(user);
    return user;
  }

  async resendVerification(email: string): Promise<void> {
    await this.api.post('/api/auth/resend-verification', { email });
  }

  async logout(): Promise<void> {
    try {
      await this.api.post('/api/auth/logout');
    } finally {
      this.user.set(null);
    }
  }

  // ---------- MFA ----------

  async mfaSetup(): Promise<MfaSetupInfo> {
    const res = await this.api.post<{ ok: true } & MfaSetupInfo>('/api/auth/mfa/setup');
    return { secret: res.secret, otpauthUrl: res.otpauthUrl, qrDataUrl: res.qrDataUrl };
  }

  async mfaEnable(code: string): Promise<string[]> {
    const res = await this.api.post<{ ok: true; recoveryCodes: string[] }>(
      '/api/auth/mfa/enable',
      { code },
    );
    await this.refreshMe();
    return res.recoveryCodes;
  }

  async mfaRegenerateRecoveryCodes(code: string): Promise<string[]> {
    const res = await this.api.post<{ ok: true; recoveryCodes: string[] }>(
      '/api/auth/mfa/regenerate-codes',
      { code },
    );
    return res.recoveryCodes;
  }

  async mfaDisable(code: string): Promise<void> {
    await this.api.post('/api/auth/mfa/disable', { code });
    await this.refreshMe();
  }

  // Called by components that authenticate through a non-password path
  // (WebAuthn) where the orchestration happens outside AuthService but the
  // session-level user signal still needs to be set.
  setAuthenticatedUser(user: AuthedUser): void {
    this.user.set(user);
  }

  // ---------- Password reset ----------

  async requestPasswordReset(email: string): Promise<void> {
    await this.api.post('/api/auth/request-reset', { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.api.post('/api/auth/reset-password', { token, newPassword });
  }
}
