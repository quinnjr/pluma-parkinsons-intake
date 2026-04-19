import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, Role } from './auth.service';

export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.ready()) await auth.loadMe();
  const user = auth.user();
  if (!user) return router.createUrlTree(['/admin/login']);

  const required = route.data?.['roles'] as Role[] | undefined;
  if (required && !required.includes(user.role)) {
    return router.createUrlTree([user.role === 'patient' ? '/patient' : '/admin']);
  }
  return true;
};
