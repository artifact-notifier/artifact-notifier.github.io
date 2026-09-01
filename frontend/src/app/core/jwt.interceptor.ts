import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  // httpOnly cookie (same-origin) + fallback Bearer (cross-origin, third-party cookies blocked).
  const token = localStorage.getItem('artifact-notifier.accessToken');
  let r = req.clone({ withCredentials: true });
  if (token && !r.headers.has('Authorization')) {
    r = r.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(r);
};
