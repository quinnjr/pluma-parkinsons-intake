import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { errorStatus, firstErrorReason } from '../../shared/api-errors';
import { SIX_DIGIT_PATTERN } from '../../shared/validation';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mx-auto max-w-md px-4 py-16">
      <div class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 class="text-2xl font-bold text-slate-900">Verify your email</h1>
        <p class="mt-1 text-sm text-slate-500">
          We sent a 6-digit code to <strong>{{ email() || 'your email' }}</strong>. Enter it to finish setting up your account.
        </p>

        <form class="mt-6 space-y-4" (submit)="$event.preventDefault(); onSubmit()">
          <div>
            <label class="field-label" for="email">Email</label>
            <input id="email" type="email" autocomplete="email" required
                   [ngModel]="email()" (ngModelChange)="email.set($event)" name="email" />
          </div>
          <div>
            <label class="field-label" for="code">6-digit code</label>
            <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code"
                   [pattern]="sixDigitPattern" maxlength="6" required
                   class="font-mono tracking-widest"
                   [ngModel]="code()" (ngModelChange)="code.set($event)" name="code" />
          </div>
          @if (errorMessage(); as msg) {
            <div class="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{{ msg }}</div>
          }
          <button type="submit" [disabled]="submitting()"
                  class="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50">
            {{ submitting() ? 'Verifying…' : 'Verify' }}
          </button>
        </form>

        <p class="mt-4 text-center text-sm text-slate-600">
          Didn't receive a code?
          <button type="button" (click)="resend()" [disabled]="resending()"
                  class="font-medium text-brand-700 hover:underline disabled:opacity-50">
            {{ resendLabel() }}
          </button>
        </p>
        <p class="mt-2 text-center text-sm">
          <a routerLink="/admin/login" class="text-slate-600 hover:underline">Back to sign in</a>
        </p>
      </div>
    </div>
  `,
})
export class VerifyEmailComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly sixDigitPattern = SIX_DIGIT_PATTERN;
  readonly email = signal<string>(this.route.snapshot.queryParamMap.get('email') ?? '');
  readonly code = signal('');
  readonly submitting = signal(false);
  readonly resending = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly resendLabel = signal('Resend code');

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const user = await this.auth.verifyEmail(this.email().trim(), this.code().trim());
      await this.router.navigate([user.role === 'patient' ? '/' : '/admin/login']);
    } catch (err: unknown) {
      const status = errorStatus(err);
      this.errorMessage.set(
        status === 429
          ? 'Too many attempts. Request a new code.'
          : (status === 401
            ? 'Invalid or expired code.'
            : firstErrorReason(err, 'Could not verify.')),
      );
    } finally {
      this.submitting.set(false);
    }
  }

  async resend(): Promise<void> {
    if (this.resending()) return;
    this.resending.set(true);
    this.resendLabel.set('Sending…');
    try {
      await this.auth.resendVerification(this.email().trim());
      this.resendLabel.set('Code sent — check your inbox');
      setTimeout(() => this.resendLabel.set('Resend code'), 4000);
    } finally {
      this.resending.set(false);
    }
  }
}
