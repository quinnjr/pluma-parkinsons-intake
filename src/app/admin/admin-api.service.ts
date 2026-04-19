import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../shared/api-client';
import type { AuthedUser } from '../shared/auth.service';
import type { FullSubmission, SubmissionSummary } from '../shared/submission.model';

export type { FullSubmission, Section, SectionResponse, SubmissionSummary } from '../shared/submission.model';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private api = inject(ApiClient);

  async listSubmissions(): Promise<SubmissionSummary[]> {
    const { submissions } = await this.api.get<{ ok: true; submissions: SubmissionSummary[] }>(
      '/api/admin/submissions',
    );
    return submissions;
  }

  async getSubmission(id: string): Promise<FullSubmission> {
    const { submission } = await this.api.get<{ ok: true; submission: FullSubmission }>(
      `/api/admin/submissions/${id}`,
    );
    return submission;
  }

  async getByLookupCode(code: string): Promise<FullSubmission> {
    const { submission } = await this.api.get<{ ok: true; submission: FullSubmission }>(
      `/api/admin/submissions/by-lookup/${encodeURIComponent(code)}`,
    );
    return submission;
  }

  async deleteSubmission(id: string): Promise<void> {
    await this.api.delete(`/api/admin/submissions/${id}`);
  }

  async listUsers(): Promise<AuthedUser[]> {
    const { users } = await this.api.get<{ ok: true; users: AuthedUser[] }>('/api/admin/users');
    return users;
  }

  async confirmUser(id: string): Promise<AuthedUser> {
    const { user } = await this.api.post<{ ok: true; user: AuthedUser }>(
      `/api/admin/users/${id}/confirm`,
    );
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await this.api.delete(`/api/admin/users/${id}`);
  }
}
