import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mx-auto max-w-md px-4 py-16">
      <div class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        @if (submitted()) {
          <h1 class="text-2xl font-bold text-slate-900">Check your email</h1>
          <p class="mt-2 text-sm text-slate-600">
            If an account exists for that email, a reset link has been generated.
            The link expires in one hour.
          </p>
          <p class="mt-4 text-center text-sm">
            <a routerLink="/admin/login" class="font-medium text-brand-700 hover:underline">Back to sign in</a>
          </p>
        } @else {
          <h1 class="text-2xl font-bold text-slate-900">Reset your password</h1>
          <p class="mt-1 text-sm text-slate-500">
            Enter the email address on your account and we'll generate a reset link.
          </p>
          <form class="mt-6 space-y-4" (submit)="$event.preventDefault(); onSubmit()">
            <div>
              <label class="field-label" for="email">Email</label>
              <input id="email" type="email" autocomplete="email" required
                     [ngModel]="email()" (ngModelChange)="email.set($event)" name="email" />
            </div>
            <button type="submit" [disabled]="submitting()"
                    class="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50">
              {{ submitting() ? 'Sending…' : 'Send reset link' }}
            </button>
          </form>
          <p class="mt-4 text-center text-sm">
            <a routerLink="/admin/login" class="text-slate-600 hover:underline">Back to sign in</a>
          </p>
        }
      </div>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private auth = inject(AuthService);

  readonly email = signal('');
  readonly submitting = signal(false);
  readonly submitted = signal(false);

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.auth.requestPasswordReset(this.email().trim());
    } finally {
      this.submitting.set(false);
      this.submitted.set(true);
    }
  }
}
