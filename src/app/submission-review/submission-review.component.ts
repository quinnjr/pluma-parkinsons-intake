import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faCheck,
  faCircleCheck,
  faClipboard,
  faCloudArrowUp,
  faDatabase,
  faDownload,
  faPrint,
  faRotateLeft,
  faTriangleExclamation,
} from '../icons';
import { AnonymizedPayload, IntakePayload, IntakeSection } from '../risk/risk.model';
import { IntakePayloadService } from '../risk/risk.service';
import { SubmissionApiService } from '../risk/submission-api.service';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; id: string; lookupCode: string; createdAt: string }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-submission-review',
  standalone: true,
  imports: [CommonModule, RouterLink, FaIconComponent],
  templateUrl: './submission-review.component.html',
})
export class SubmissionReviewComponent {
  private payloads = inject(IntakePayloadService);
  private api = inject(SubmissionApiService);

  readonly payload = input.required<IntakePayload>();
  readonly startOver = output<void>();

  readonly icons = {
    ok: faCircleCheck,
    warn: faTriangleExclamation,
    print: faPrint,
    download: faDownload,
    reset: faRotateLeft,
    copy: faClipboard,
    check: faCheck,
    upload: faCloudArrowUp,
    db: faDatabase,
  };

  readonly copied = signal(false);
  readonly saveState = signal<SaveState>({ kind: 'idle' });

  readonly savedState = computed(() => {
    const s = this.saveState();
    return s.kind === 'saved' ? s : null;
  });

  readonly errorState = computed(() => {
    const s = this.saveState();
    return s.kind === 'error' ? s : null;
  });

  readonly anonymized = computed<AnonymizedPayload>(() => this.payloads.anonymize(this.payload()));

  readonly nonEmptySections = computed<IntakeSection[]>(() =>
    this.anonymized().sections.filter((s) => s.responses.length > 0),
  );

  readonly completedDate = computed(() => {
    const iso = this.payload().generatedAt;
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  });

  async copyMarkdown(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(this.anonymized().markdown);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard unavailable — fall through silently
    }
  }

  downloadMarkdown(): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([this.anonymized().markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `parkinsons-intake-${Date.now()}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  printReport(): void {
    if (typeof window !== 'undefined') window.print();
  }

  async saveAnonymized(): Promise<void> {
    const state = this.saveState();
    if (state.kind === 'saving' || state.kind === 'saved') return;
    this.saveState.set({ kind: 'saving' });
    try {
      const result = await this.api.create(this.anonymized());
      if (result.ok) {
        this.saveState.set({
          kind: 'saved',
          id: result.id,
          lookupCode: result.lookupCode,
          createdAt: result.createdAt,
        });
      } else {
        const msg = result.errors.map((e) => `${e.field}: ${e.reason}`).join('; ');
        this.saveState.set({ kind: 'error', message: msg || 'Server rejected the submission.' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      this.saveState.set({ kind: 'error', message });
    }
  }
}
