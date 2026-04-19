import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../shared/api-client';
import type { FullSubmission, SubmissionSummary } from '../shared/submission.model';

export interface SubmissionPatch {
  markdown?: string;
  ageBand?: string | null;
  sexAtBirth?: string | null;
  zipCode?: string | null;
}

export interface ResearcherAccessEntry {
  id: string;
  email: string;
  createdAt: string;
  granted: boolean;
  grantedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class PatientApiService {
  private api = inject(ApiClient);

  async listSubmissions(): Promise<SubmissionSummary[]> {
    const { submissions } = await this.api.get<{ ok: true; submissions: SubmissionSummary[] }>(
      '/api/patient/submissions',
    );
    return submissions;
  }

  async getSubmission(id: string): Promise<FullSubmission> {
    const { submission } = await this.api.get<{ ok: true; submission: FullSubmission }>(
      `/api/patient/submissions/${id}`,
    );
    return submission;
  }

  async updateSubmission(id: string, patch: SubmissionPatch): Promise<FullSubmission> {
    const { submission } = await this.api.put<{ ok: true; submission: FullSubmission }>(
      `/api/patient/submissions/${id}`,
      patch,
    );
    return submission;
  }

  async deleteSubmission(id: string): Promise<void> {
    await this.api.delete(`/api/patient/submissions/${id}`);
  }

  async claim(lookupCode: string): Promise<{ id: string; lookupCode: string }> {
    const { claimed } = await this.api.post<{ ok: true; claimed: { id: string; lookupCode: string } }>(
      '/api/patient/submissions/claim',
      { lookupCode },
    );
    return claimed;
  }

  async deleteMyAccount(): Promise<void> {
    await this.api.delete('/api/auth/me');
  }

  async listResearchers(): Promise<ResearcherAccessEntry[]> {
    const { researchers } = await this.api.get<{ ok: true; researchers: ResearcherAccessEntry[] }>(
      '/api/patient/researchers',
    );
    return researchers;
  }

  async grantResearcher(id: string): Promise<void> {
    await this.api.post(`/api/patient/researchers/${id}/grant`);
  }

  async revokeResearcher(id: string): Promise<void> {
    await this.api.delete(`/api/patient/researchers/${id}/grant`);
  }
}

