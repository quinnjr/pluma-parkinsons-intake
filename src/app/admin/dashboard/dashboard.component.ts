import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import type { AuthedUser } from '../../shared/auth.service';
import type { FullSubmission, SubmissionSummary } from '../../shared/submission.model';
import { errorStatus } from '../../shared/api-errors';
import { MfaSettingsComponent } from '../../shared/mfa-settings.component';
import { PasskeySettingsComponent } from '../../shared/passkey-settings.component';
import { AdminApiService } from '../admin-api.service';

type Tab = 'records' | 'users';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [DatePipe, FormsModule, MfaSettingsComponent, PasskeySettingsComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private auth = inject(AuthService);
  private api = inject(AdminApiService);
  private router = inject(Router);

  readonly user = this.auth.user;
  readonly isRoot = computed(() => this.user()?.role === 'root');
  readonly confirmed = computed(() => this.user()?.confirmed ?? false);

  readonly tab = signal<Tab>('records');

  // Records
  readonly submissions = signal<SubmissionSummary[]>([]);
  readonly selected = signal<FullSubmission | null>(null);
  readonly lookupInput = signal('');
  readonly recordsError = signal<string | null>(null);
  readonly recordsLoading = signal(false);

  // Users
  readonly users = signal<AuthedUser[]>([]);
  readonly usersError = signal<string | null>(null);
  readonly usersLoading = signal(false);

  constructor() {
    afterNextRender(() => {
      if (this.confirmed()) void this.refreshSubmissions();
      if (this.isRoot()) void this.refreshUsers();
    });
  }

  switchTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'users' && this.isRoot() && this.users().length === 0) {
      void this.refreshUsers();
    }
  }

  async refreshSubmissions(): Promise<void> {
    this.recordsLoading.set(true);
    this.recordsError.set(null);
    try {
      this.submissions.set(await this.api.listSubmissions());
    } catch {
      this.recordsError.set('Could not load submissions.');
    } finally {
      this.recordsLoading.set(false);
    }
  }

  async viewSubmission(id: string): Promise<void> {
    this.recordsError.set(null);
    try {
      this.selected.set(await this.api.getSubmission(id));
    } catch {
      this.recordsError.set('Could not load submission.');
    }
  }

  async lookupByCode(): Promise<void> {
    const code = this.lookupInput().trim();
    if (!code) return;
    this.recordsError.set(null);
    try {
      this.selected.set(await this.api.getByLookupCode(code));
    } catch (err: unknown) {
      this.recordsError.set(
        errorStatus(err) === 404 ? 'No submission with that lookup code.' : 'Lookup failed.',
      );
    }
  }

  closeSelected(): void {
    this.selected.set(null);
  }

  async deleteSubmission(id: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm('Delete this submission? This cannot be undone.')) return;
    try {
      await this.api.deleteSubmission(id);
      this.submissions.update((rows) => rows.filter((r) => r.id !== id));
      if (this.selected()?.id === id) this.selected.set(null);
    } catch {
      this.recordsError.set('Delete failed.');
    }
  }

  downloadSelectedMarkdown(): void {
    const s = this.selected();
    if (!s || typeof window === 'undefined') return;
    const blob = new Blob([s.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `submission-${s.lookupCode}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async refreshUsers(): Promise<void> {
    this.usersLoading.set(true);
    this.usersError.set(null);
    try {
      this.users.set(await this.api.listUsers());
    } catch {
      this.usersError.set('Could not load users.');
    } finally {
      this.usersLoading.set(false);
    }
  }

  async confirmUser(id: string): Promise<void> {
    try {
      const updated = await this.api.confirmUser(id);
      this.users.update((list) => list.map((u) => (u.id === id ? updated : u)));
    } catch {
      this.usersError.set('Confirm failed.');
    }
  }

  async deleteUser(id: string, email: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`Delete researcher ${email}?`)) return;
    try {
      await this.api.deleteUser(id);
      this.users.update((list) => list.filter((u) => u.id !== id));
    } catch {
      this.usersError.set('Delete failed.');
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/admin/login']);
  }
}
