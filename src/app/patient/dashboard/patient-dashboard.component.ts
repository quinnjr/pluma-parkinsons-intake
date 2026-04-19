import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import type { FullSubmission, SubmissionSummary } from '../../shared/submission.model';
import { errorStatus, firstErrorReason } from '../../shared/api-errors';
import { MfaSettingsComponent } from '../../shared/mfa-settings.component';
import { PasskeySettingsComponent } from '../../shared/passkey-settings.component';
import { PatientApiService, SubmissionPatch } from '../patient-api.service';
import { ResearchersComponent } from '../researchers/researchers.component';

type EditState =
  | { kind: 'view'; data: FullSubmission }
  | { kind: 'edit'; data: FullSubmission; markdown: string; ageBand: string; sexAtBirth: string; zipCode: string; saving: boolean };

@Component({
  selector: 'app-patient-dashboard',
  standalone: true,
  imports: [DatePipe, FormsModule, MfaSettingsComponent, PasskeySettingsComponent, ResearchersComponent],
  templateUrl: './patient-dashboard.component.html',
})
export class PatientDashboardComponent {
  private auth = inject(AuthService);
  private api = inject(PatientApiService);
  private router = inject(Router);

  readonly user = this.auth.user;

  readonly submissions = signal<SubmissionSummary[]>([]);
  readonly listError = signal<string | null>(null);
  readonly listLoading = signal(false);

  readonly selected = signal<EditState | null>(null);
  readonly detailError = signal<string | null>(null);

  readonly claimInput = signal('');
  readonly claimError = signal<string | null>(null);

  readonly deletingAccount = signal(false);

  constructor() {
    afterNextRender(() => void this.refresh());
  }

  async refresh(): Promise<void> {
    this.listLoading.set(true);
    this.listError.set(null);
    try {
      this.submissions.set(await this.api.listSubmissions());
    } catch {
      this.listError.set('Could not load your submissions.');
    } finally {
      this.listLoading.set(false);
    }
  }

  async view(id: string): Promise<void> {
    this.detailError.set(null);
    try {
      this.selected.set({ kind: 'view', data: await this.api.getSubmission(id) });
    } catch {
      this.detailError.set('Could not load submission.');
    }
  }

  startEdit(): void {
    const s = this.selected();
    if (!s) return;
    this.selected.set({
      kind: 'edit',
      data: s.data,
      markdown: s.data.markdown,
      ageBand: s.data.ageBand ?? '',
      sexAtBirth: s.data.sexAtBirth ?? '',
      zipCode: s.data.zipCode ?? '',
      saving: false,
    });
  }

  cancelEdit(): void {
    const s = this.selected();
    if (!s || s.kind !== 'edit') return;
    this.selected.set({ kind: 'view', data: s.data });
  }

  patch(key: keyof SubmissionPatch, value: string): void {
    const s = this.selected();
    if (!s || s.kind !== 'edit') return;
    this.selected.set({ ...s, [key]: value });
  }

  async saveEdit(): Promise<void> {
    const s = this.selected();
    if (!s || s.kind !== 'edit' || s.saving) return;
    this.selected.set({ ...s, saving: true });
    this.detailError.set(null);
    try {
      const refreshed = await this.api.updateSubmission(s.data.id, {
        markdown: s.markdown,
        ageBand: s.ageBand || null,
        sexAtBirth: s.sexAtBirth || null,
        zipCode: s.zipCode || null,
      });
      this.selected.set({ kind: 'view', data: refreshed });
      this.submissions.update((rows) =>
        rows.map((r) => (r.id === refreshed.id ? {
          id: refreshed.id,
          lookupCode: refreshed.lookupCode,
          createdAt: String(refreshed.createdAt),
          schemaVersion: refreshed.schemaVersion,
          ageBand: refreshed.ageBand,
          sexAtBirth: refreshed.sexAtBirth,
        } : r)),
      );
    } catch (err: unknown) {
      this.detailError.set(firstErrorReason(err, 'Save failed.'));
      this.selected.set({ ...s, saving: false });
    }
  }

  downloadSelected(): void {
    const s = this.selected();
    if (!s || typeof window === 'undefined') return;
    const blob = new Blob([s.data.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `submission-${s.data.lookupCode}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async deleteSubmission(id: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm('Delete this submission? This cannot be undone.')) return;
    try {
      await this.api.deleteSubmission(id);
      this.submissions.update((xs) => xs.filter((x) => x.id !== id));
      if (this.selected()?.data.id === id) this.selected.set(null);
    } catch {
      this.listError.set('Delete failed.');
    }
  }

  closeSelected(): void {
    this.selected.set(null);
  }

  async claim(): Promise<void> {
    const code = this.claimInput().trim();
    if (!code) return;
    this.claimError.set(null);
    try {
      await this.api.claim(code);
      this.claimInput.set('');
      await this.refresh();
    } catch (err: unknown) {
      const status = errorStatus(err);
      this.claimError.set(
        status === 404 ? 'No record with that lookup code.' :
        (status === 409 ? 'That record is already claimed.' :
        'Claim failed.'),
      );
    }
  }

  async deleteMyAccount(): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(
      'Delete your account? This also deletes ALL records you own. This cannot be undone.',
    )) return;
    this.deletingAccount.set(true);
    try {
      await this.api.deleteMyAccount();
      await this.auth.logout();
      await this.router.navigate(['/']);
    } catch {
      this.listError.set('Account deletion failed.');
    } finally {
      this.deletingAccount.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/admin/login']);
  }
}
