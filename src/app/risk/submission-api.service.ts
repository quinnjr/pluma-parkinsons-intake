import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AnonymizedPayload, StateResidency } from './risk.model';

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
  private http = inject(HttpClient);

  async create(
    payload: AnonymizedPayload,
    livedInStates: StateResidency[] = [],
  ): Promise<SubmissionCreated | SubmissionError> {
    const body = { ...payload, livedInStates };
    return firstValueFrom(
      this.http.post<SubmissionCreated | SubmissionError>('/api/submissions', body),
    );
  }
}
