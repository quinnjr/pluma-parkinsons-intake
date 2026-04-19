import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { errorStatus, firstErrorReason } from '../../shared/api-errors';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mx-auto max-w-md px-4 py-16">
      <div class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        @if (success()) {
          <h1 class="text-2xl font-bold text-slate-900">Password reset</h1>
          <p class="mt-2 text-sm text-slate-600">Your password has been updated. You can sign in now.</p>
          <p class="mt-4 text-center text-sm">
            <a routerLink="/admin/login" class="font-medium text-brand-700 hover:underline">Sign in</a>
          </p>
        } @else if (!token()) {
          <h1 class="text-2xl font-bold text-slate-900">Invalid link</h1>
          <p class="mt-2 text-sm text-slate-600">This reset link is missing its token. Request a new one.</p>
          <p class="mt-4 text-center text-sm">
            <a routerLink="/admin/forgot" class="font-medium text-brand-700 hover:underline">Request a new link</a>
          </p>
        } @else {
          <h1 class="text-2xl font-bold text-slate-900">Choose a new password</h1>
          <form class="mt-6 space-y-4" (submit)="$event.preventDefault(); onSubmit()">
            <div>
              <label class="field-label" for="pw">New password <span class="text-slate-400">(min 12 chars)</span></label>
              <input id="pw" type="password" autocomplete="new-password" required minlength="12"
                     [ngModel]="password()" (ngModelChange)="password.set($event)" name="pw" />
            </div>
            <div>
              <label class="field-label" for="pw2">Confirm</label>
              <input id="pw2" type="password" autocomplete="new-password" required minlength="12"
                     [ngModel]="confirm()" (ngModelChange)="confirm.set($event)" name="pw2" />
            </div>
            @if (errorMessage(); as msg) {
              <div class="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{{ msg }}</div>
            }
            <button type="submit" [disabled]="submitting() || !isValid()"
                    class="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50">
              {{ submitting() ? 'Saving…' : 'Set new password' }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
})
export class ResetPasswordComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly token = signal<string>(this.route.snapshot.queryParamMap.get('token') ?? '');
  readonly password = signal('');
  readonly confirm = signal('');
  readonly submitting = signal(false);
  readonly success = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly isValid = computed(
    () => this.password().length >= 12 && this.password() === this.confirm(),
  );

  async onSubmit(): Promise<void> {
    if (this.submitting() || !this.isValid()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.auth.resetPassword(this.token(), this.password());
      this.success.set(true);
      setTimeout(() => void this.router.navigate(['/admin/login']), 2000);
    } catch (err: unknown) {
      this.errorMessage.set(
        errorStatus(err) === 401
          ? 'This reset link is invalid or has expired. Request a new one.'
          : firstErrorReason(err, 'Could not reset password.'),
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
