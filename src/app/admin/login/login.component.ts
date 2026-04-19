import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { WebAuthnService } from '../../shared/webauthn.service';
import { errorStatus } from '../../shared/api-errors';

function isBrowserAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.message.includes('cancelled');
}

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private webauthn = inject(WebAuthnService);
  private router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly mfaCode = signal('');
  readonly challengeToken = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly passkeyBusy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const result = await this.auth.login(this.email().trim(), this.password());
      if (result.kind === 'mfa') {
        this.challengeToken.set(result.challengeToken);
      } else {
        await this.router.navigate([result.user.role === 'patient' ? '/' : '/admin']);
      }
    } catch (err: unknown) {
      const status = errorStatus(err);
      if (status === 403) {
        await this.router.navigate(['/admin/verify-email'], {
          queryParams: { email: this.email().trim() },
        });
        return;
      }
      this.errorMessage.set(
        status === 429
          ? 'Too many attempts — try again in 15 minutes.'
          : (status === 401
            ? 'Invalid email or password.'
            : 'Could not log in. Try again.'),
      );
    } finally {
      this.submitting.set(false);
    }
  }

  async onSubmitMfa(): Promise<void> {
    const token = this.challengeToken();
    if (!token || this.submitting()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const user = await this.auth.loginWithMfa(token, this.mfaCode().trim());
      await this.router.navigate([user.role === 'patient' ? '/' : '/admin']);
    } catch (err: unknown) {
      this.errorMessage.set(
        errorStatus(err) === 401 ? 'Invalid code. Try again.' : 'Could not verify.',
      );
    } finally {
      this.submitting.set(false);
    }
  }

  async signInWithPasskey(): Promise<void> {
    if (this.passkeyBusy()) return;
    this.passkeyBusy.set(true);
    this.errorMessage.set(null);
    try {
      const user = await this.webauthn.authenticateBeginAndFinish(
        this.email().trim() || undefined,
      );
      this.auth.setAuthenticatedUser(user);
      await this.router.navigate([user.role === 'patient' ? '/' : '/admin']);
    } catch (err: unknown) {
      if (!isBrowserAbort(err)) {
        this.errorMessage.set('Passkey sign-in failed. Try again or use your password.');
      }
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  cancelMfa(): void {
    this.challengeToken.set(null);
    this.mfaCode.set('');
    this.password.set('');
    this.errorMessage.set(null);
  }
}
