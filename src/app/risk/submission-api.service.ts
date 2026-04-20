import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../shared/api-client';
import { AnonymizedPayload } from './risk.model';

export interface SubmissionCreated {
  ok: true;
  id: string;
  lookupCode: string;
  createdAt: string;
}

export interface SubmissionError {
  ok: false;
  errors: { field: string; reason: string }[];
}

@Injectable({ providedIn: 'root' })
export class SubmissionApiService {
  private api = inject(ApiClient);

  create(payload: AnonymizedPayload): Promise<SubmissionCreated | SubmissionError> {
    return this.api.post<SubmissionCreated | SubmissionError>('/api/submissions', payload);
  }
}
