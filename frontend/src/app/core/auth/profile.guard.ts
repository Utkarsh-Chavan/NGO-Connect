import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

export const profileGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  return auth.currentUser()?.role === 'INDIVIDUAL' || auth.currentUser()?.role === 'NGO'
    ? true
    : router.parseUrl('/');
};
