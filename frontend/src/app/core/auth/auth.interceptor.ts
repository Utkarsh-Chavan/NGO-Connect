import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  if (!request.url.startsWith(`${apiBaseUrl}/`) || request.url.startsWith(`${apiBaseUrl}/auth/`)) {
    return next(request);
  }

  const auth = inject(AuthService);
  const token = auth.getAccessToken();
  if (!token) return next(request);

  const router = inject(Router);
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.logout();
        void router.navigateByUrl('/login');
      }
      return throwError(() => error);
    }),
  );
};
