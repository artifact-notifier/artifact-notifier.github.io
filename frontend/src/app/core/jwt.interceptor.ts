import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  // httpOnly cookie (same-origin) + fallback Bearer (cross-origin, third-party cookies blocked).
  const token = localStorage.getItem('artifact-notifier.accessToken');
  let r = req.clone({ withCredentials: true });
  if (token && !r.headers.has('Authorization')) {
    r = r.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(r).pipe(
    catchError((err: unknown) => {
      // Expired/invalid session: route back to login instead of leaving
      // pages (e.g. dashboard) stuck with empty data. Skip public auth
      // endpoints so the login page itself never redirect-loops.
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !req.url.includes('/api/auth/')
      ) {
        inject(AuthService).handleUnauthorized();
      }
      return throwError(() => err);
    }),
  );
};
