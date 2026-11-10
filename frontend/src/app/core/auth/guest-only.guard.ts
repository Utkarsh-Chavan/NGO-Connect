import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';
import { authenticatedHomeRoute } from './auth.models';

export const guestOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const user = auth.currentUser();
  return auth.isAuthenticated() && user
    ? inject(Router).parseUrl(authenticatedHomeRoute(user.role))
    : true;
};
