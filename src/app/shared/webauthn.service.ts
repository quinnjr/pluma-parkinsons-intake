import { Injectable, inject } from '@angular/core';
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import { ApiClient } from './api-client';
import type { AuthedUser } from './auth.service';

export interface WebAuthnCredentialSummary {
  id: string;
  nickname: string | null;
  deviceType: string | null;
  backedUp: boolean;
  transports: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class WebAuthnService {
  private api = inject(ApiClient);

  async listCredentials(): Promise<WebAuthnCredentialSummary[]> {
    const { credentials } = await this.api.get<{
      ok: true;
      credentials: WebAuthnCredentialSummary[];
    }>('/api/auth/webauthn/credentials');
    return credentials;
  }

  async removeCredential(id: string): Promise<void> {
    await this.api.delete(`/api/auth/webauthn/credentials/${id}`);
  }

  async registerBeginAndFinish(nickname?: string): Promise<void> {
    const { options, challengeToken } = await this.api.post<{
      ok: true;
      options: Parameters<typeof startRegistration>[0];
      challengeToken: string;
    }>('/api/auth/webauthn/register/begin');

    const attestation = await startRegistration(options);

    await this.api.post('/api/auth/webauthn/register/finish', {
      challengeToken,
      response: attestation,
      nickname,
    });
  }

  async authenticateBeginAndFinish(email?: string): Promise<AuthedUser> {
    const { options, challengeToken } = await this.api.post<{
      ok: true;
      options: Parameters<typeof startAuthentication>[0];
      challengeToken: string;
    }>('/api/auth/webauthn/authenticate/begin', email ? { email } : {});

    const assertion = await startAuthentication(options);

    const { user } = await this.api.post<{ ok: true; user: AuthedUser }>(
      '/api/auth/webauthn/authenticate/finish',
      { challengeToken, response: assertion },
    );
    return user;
  }
}
