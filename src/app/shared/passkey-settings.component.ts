import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebAuthnService, WebAuthnCredentialSummary } from './webauthn.service';
import { firstErrorReason } from './api-errors';

function isBrowserAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.message.includes('cancelled');
}

@Component({
  selector: 'app-passkey-settings',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-lg font-semibold text-slate-900">Passkeys</h2>
      <p class="mt-1 text-sm text-slate-500">
        Sign in with Touch ID, Windows Hello, a security key, or your phone.
        Passkeys replace your password entirely — no code needed.
      </p>

      @if (errorMessage(); as msg) {
        <div class="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{{ msg }}</div>
      }

      @if (credentials().length > 0) {
        <ul class="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          @for (c of credentials(); track c.id) {
            <li class="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p class="font-medium text-slate-800">{{ c.nickname || 'Passkey' }}</p>
                <p class="text-xs text-slate-500">
                  {{ c.deviceType === 'multiDevice' ? 'Synced' : 'Device-bound' }}
                  @if (c.backedUp) { · Backed up }
                  · Added {{ c.createdAt | date: 'mediumDate' }}
                  @if (c.lastUsedAt) { · Last used {{ c.lastUsedAt | date: 'mediumDate' }} }
                </p>
              </div>
              <button type="button" (click)="remove(c.id)"
                      class="ml-4 text-sm font-medium text-rose-700 hover:underline">
                Remove
              </button>
            </li>
          }
        </ul>
      }

      <div class="mt-4 flex flex-wrap items-end gap-2">
        <div class="flex-1">
          <label class="text-xs font-medium text-slate-600" for="passkeyNick">Nickname <span class="text-slate-400">(optional)</span></label>
          <input id="passkeyNick" type="text" class="mt-1" maxlength="64" placeholder='e.g. "MacBook Touch ID"'
                 [ngModel]="nickname()" (ngModelChange)="nickname.set($event)" name="passkeyNick" />
        </div>
        <button type="button" (click)="register()" [disabled]="registering()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
          {{ registering() ? 'Waiting for device…' : 'Add a passkey' }}
        </button>
      </div>
    </section>
  `,
})
export class PasskeySettingsComponent {
  private svc = inject(WebAuthnService);

  readonly credentials = signal<WebAuthnCredentialSummary[]>([]);
  readonly nickname = signal('');
  readonly registering = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    afterNextRender(() => void this.refresh());
  }

  async refresh(): Promise<void> {
    try {
      this.credentials.set(await this.svc.listCredentials());
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Could not load passkeys.'));
    }
  }

  async register(): Promise<void> {
    if (this.registering()) return;
    this.registering.set(true);
    this.errorMessage.set(null);
    try {
      await this.svc.registerBeginAndFinish(this.nickname().trim() || undefined);
      this.nickname.set('');
      await this.refresh();
    } catch (err) {
      if (!isBrowserAbort(err)) {
        this.errorMessage.set(firstErrorReason(err, 'Registration failed.'));
      }
    } finally {
      this.registering.set(false);
    }
  }

  async remove(id: string): Promise<void> {
    this.errorMessage.set(null);
    try {
      await this.svc.removeCredential(id);
      this.credentials.update((list) => list.filter((c) => c.id !== id));
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Could not remove.'));
    }
  }
}
