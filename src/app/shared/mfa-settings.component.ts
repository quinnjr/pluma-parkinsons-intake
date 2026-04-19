import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, MfaSetupInfo } from './auth.service';
import { firstErrorReason } from './api-errors';
import { SIX_DIGIT_PATTERN } from './validation';

type Phase = 'idle' | 'setup' | 'confirming' | 'disabling' | 'regenerating';

@Component({
  selector: 'app-mfa-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-lg font-semibold text-slate-900">Two-factor authentication</h2>
      <p class="mt-1 text-sm text-slate-500">
        Adds a time-based code from your authenticator app on top of your password.
      </p>

      @if (errorMessage(); as msg) {
        <div class="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{{ msg }}</div>
      }

      @if (recoveryCodes(); as codes) {
        <div class="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p class="font-semibold">Save these recovery passcodes.</p>
          <p class="text-xs">
            Each code can be used once in place of your authenticator app if you lose access.
            They won't be shown again.
          </p>
          <ul class="grid grid-cols-2 gap-2 rounded-md border border-amber-300 bg-white p-3 font-mono text-sm text-slate-800">
            @for (c of codes; track c) {
              <li class="select-all">{{ c }}</li>
            }
          </ul>
          <div class="flex flex-wrap gap-2">
            <button type="button" (click)="copyCodes(codes)"
                    class="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
              {{ copied() ? 'Copied!' : 'Copy all' }}
            </button>
            <button type="button" (click)="downloadCodes(codes)"
                    class="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
              Download .txt
            </button>
            <button type="button" (click)="acknowledgeCodes()"
                    class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
              I've saved them
            </button>
          </div>
        </div>
      }

      @if (enabled() && !recoveryCodes()) {
        <div class="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Two-factor authentication is <strong>on</strong> for your account.
        </div>
        @if (phase() === 'disabling' || phase() === 'regenerating') {
          <form class="mt-4 flex flex-wrap gap-2" (submit)="$event.preventDefault(); onConfirmDangerous()">
            <input type="text" inputmode="numeric" [pattern]="sixDigitPattern" maxlength="6" required
                   placeholder="Current 6-digit code" class="flex-1 font-mono tracking-widest"
                   [ngModel]="code()" (ngModelChange)="code.set($event)" name="dangerousCode" />
            <button type="submit" [disabled]="busy()"
                    [class]="phase() === 'disabling'
                      ? 'rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50'
                      : 'rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'">
              {{ phase() === 'disabling' ? 'Disable' : 'Regenerate' }}
            </button>
            <button type="button" (click)="cancelDangerous()"
                    class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
          </form>
        } @else {
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" (click)="phase.set('regenerating')"
                    class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Regenerate recovery passcodes
            </button>
            <button type="button" (click)="phase.set('disabling')"
                    class="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
              Disable two-factor
            </button>
          </div>
        }
      } @else if (setupInfo(); as s) {
        <div class="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p class="text-sm text-slate-700">
            1. Scan the QR code with your authenticator app (Google Authenticator, 1Password, Authy, etc.)
          </p>
          <img [src]="s.qrDataUrl" alt="MFA QR code" class="rounded border border-slate-300 bg-white" width="220" height="220" />
          <p class="text-xs text-slate-500">
            Or enter this secret manually:
            <code class="ml-1 break-all rounded bg-white px-2 py-0.5 font-mono text-[11px]">{{ s.secret }}</code>
          </p>
          <p class="text-sm text-slate-700">2. Enter the 6-digit code your app shows:</p>
          <form class="flex gap-2" (submit)="$event.preventDefault(); confirmEnable()">
            <input type="text" inputmode="numeric" [pattern]="sixDigitPattern" maxlength="6" required
                   placeholder="123456" class="flex-1 font-mono tracking-widest"
                   [ngModel]="code()" (ngModelChange)="code.set($event)" name="enableCode" />
            <button type="submit" [disabled]="busy()"
                    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {{ busy() ? 'Verifying…' : 'Confirm' }}
            </button>
          </form>
        </div>
      } @else {
        <button type="button" (click)="startSetup()" [disabled]="busy()"
                class="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {{ busy() ? 'Preparing…' : 'Enable two-factor' }}
        </button>
      }
    </section>
  `,
})
export class MfaSettingsComponent {
  private auth = inject(AuthService);

  readonly sixDigitPattern = SIX_DIGIT_PATTERN;
  readonly phase = signal<Phase>('idle');
  readonly setupInfo = signal<MfaSetupInfo | null>(null);
  readonly recoveryCodes = signal<string[] | null>(null);
  readonly code = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly copied = signal(false);

  readonly busy = computed(
    () => this.phase() === 'confirming' || this.phase() === 'disabling' || this.phase() === 'regenerating',
  );
  readonly enabled = computed(() => this.auth.user()?.mfaEnabled ?? false);

  async startSetup(): Promise<void> {
    this.errorMessage.set(null);
    try {
      this.setupInfo.set(await this.auth.mfaSetup());
      this.phase.set('setup');
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Could not start setup.'));
    }
  }

  async confirmEnable(): Promise<void> {
    const c = this.code().trim();
    if (c.length !== 6) return;
    this.phase.set('confirming');
    this.errorMessage.set(null);
    try {
      const codes = await this.auth.mfaEnable(c);
      this.setupInfo.set(null);
      this.code.set('');
      this.recoveryCodes.set(codes);
      this.phase.set('idle');
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Invalid code.'));
      this.phase.set('setup');
    }
  }

  async onConfirmDangerous(): Promise<void> {
    const c = this.code().trim();
    if (c.length !== 6) return;
    const op = this.phase();
    this.errorMessage.set(null);
    try {
      if (op === 'disabling') {
        await this.auth.mfaDisable(c);
      } else if (op === 'regenerating') {
        const codes = await this.auth.mfaRegenerateRecoveryCodes(c);
        this.recoveryCodes.set(codes);
      }
      this.code.set('');
      this.phase.set('idle');
    } catch (err) {
      this.errorMessage.set(firstErrorReason(err, 'Invalid code.'));
    }
  }

  cancelDangerous(): void {
    this.phase.set('idle');
    this.code.set('');
    this.errorMessage.set(null);
  }

  acknowledgeCodes(): void {
    this.recoveryCodes.set(null);
    this.copied.set(false);
  }

  async copyCodes(codes: readonly string[]): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  downloadCodes(codes: readonly string[]): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pluma-mfa-recovery-${Date.now()}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
