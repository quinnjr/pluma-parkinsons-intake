import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { errorStatus, firstErrorReason } from '../../shared/api-errors';

@Component({
  selector: 'app-patient-signup',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './patient-signup.component.html',
})
export class PatientSignupComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly passwordValid = computed(() => this.password().length >= 12);

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.passwordValid()) {
      this.errorMessage.set('Password must be at least 12 characters.');
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const { user } = await this.auth.signupPatient(this.email().trim(), this.password());
      await this.router.navigate(['/admin/verify-email'], { queryParams: { email: user.email } });
    } catch (err: unknown) {
      this.errorMessage.set(
        errorStatus(err) === 409
          ? firstErrorReason(err, 'Email already in use.')
          : 'Could not create account.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
