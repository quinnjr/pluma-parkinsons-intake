import { Routes } from '@angular/router';
import { IntakeFormComponent } from './intake-form/intake-form.component';
import { LoginComponent } from './admin/login/login.component';
import { SignupComponent } from './admin/signup/signup.component';
import { DashboardComponent } from './admin/dashboard/dashboard.component';
import { ForgotPasswordComponent } from './admin/forgot/forgot-password.component';
import { ResetPasswordComponent } from './admin/reset/reset-password.component';
import { VerifyEmailComponent } from './admin/verify-email/verify-email.component';
import { PatientSignupComponent } from './patient/signup/patient-signup.component';
import { PatientDashboardComponent } from './patient/dashboard/patient-dashboard.component';
import { authGuard } from './shared/auth.guard';

export const routes: Routes = [
  { path: '', component: IntakeFormComponent },
  { path: 'admin/login', component: LoginComponent },
  { path: 'admin/signup', component: SignupComponent },
  { path: 'admin/forgot', component: ForgotPasswordComponent },
  { path: 'admin/reset-password', component: ResetPasswordComponent },
  { path: 'admin/verify-email', component: VerifyEmailComponent },
  {
    path: 'admin',
    component: DashboardComponent,
    canActivate: [authGuard],
    data: { roles: ['root', 'researcher'] },
  },
  { path: 'patient/signup', component: PatientSignupComponent },
  {
    path: 'patient',
    component: PatientDashboardComponent,
    canActivate: [authGuard],
    data: { roles: ['patient'] },
  },
  { path: '**', redirectTo: '' },
];
