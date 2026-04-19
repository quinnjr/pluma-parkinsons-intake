import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PatientApiService, ResearcherAccessEntry } from '../patient-api.service';
import { firstErrorReason } from '../../shared/api-errors';

@Component({
  selector: 'app-researchers',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-slate-900">Who can see your records</h2>
          <p class="mt-1 text-sm text-slate-500">
            Grant or revoke access for each researcher. Grants take effect immediately.
          </p>
        </div>
        <button type="button" (click)="refresh()" [disabled]="loading()"
                class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
          {{ loading() ? 'Loading…' : 'Refresh' }}
        </button>
      </div>

      @if (errorMessage(); as msg) {
        <div class="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{{ msg }}</div>
      }

      <div class="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <table class="min-w-full divide-y divide-slate-200">
          <thead class="bg-slate-50">
            <tr class="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th class="px-4 py-2">Researcher</th>
              <th class="px-4 py-2">Status</th>
              <th class="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-sm">
            @for (r of entries(); track r.id) {
              <tr>
                <td class="px-4 py-2 text-slate-800">{{ r.email }}</td>
                <td class="px-4 py-2">
                  @if (r.granted) {
                    <span class="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      Granted{{ r.grantedAt ? ' · ' + (r.grantedAt | date: 'mediumDate') : '' }}
                    </span>
                  } @else {
                    <span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      No access
                    </span>
                  }
                </td>
                <td class="px-4 py-2 text-right">
                  @if (r.granted) {
                    <button type="button" (click)="revoke(r.id)"
                            class="text-sm font-medium text-rose-700 hover:underline">
                      Revoke
                    </button>
                  } @else {
                    <button type="button" (click)="grant(r.id)"
                            class="text-sm font-medium text-brand-700 hover:underline">
                      Grant access
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="px-4 py-8 text-center text-sm text-slate-500">
                  No confirmed researchers yet. Ask the root admin to approve one.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class ResearchersComponent {
  private api = inject(PatientApiService);

  readonly entries = signal<ResearcherAccessEntry[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    afterNextRender(() => void this.refresh());
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      this.entries.set(await this.api.listResearchers());
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Could not load researchers.'));
    } finally {
      this.loading.set(false);
    }
  }

  async grant(id: string): Promise<void> {
    this.errorMessage.set(null);
    try {
      await this.api.grantResearcher(id);
      this.patchRow(id, { granted: true, grantedAt: new Date().toISOString() });
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Could not grant access.'));
    }
  }

  async revoke(id: string): Promise<void> {
    this.errorMessage.set(null);
    try {
      await this.api.revokeResearcher(id);
      this.patchRow(id, { granted: false });
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Could not revoke access.'));
    }
  }

  private patchRow(id: string, delta: Partial<ResearcherAccessEntry>): void {
    this.entries.update((rows) => rows.map((r) => (r.id === id ? { ...r, ...delta } : r)));
  }
}
