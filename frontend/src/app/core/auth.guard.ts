import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, firstValueFrom, timeout, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

/** Resolves the session (waiting for /api/auth/me), true when logged in. */
async function loggedIn(): Promise<boolean> {
  // inject() before the first await: still in the injection context
  const auth = inject(AuthService);

  if (auth.user()) return true;

  // Wait for /api/auth/me to settle (already in flight, or reloaded now)
  if (!auth.isAuthLoading()) auth.refresh();
  await firstValueFrom(
    toObservable(auth.isAuthLoading).pipe(
      filter((loading) => !loading),
      timeout(5000),
      catchError(() => of(false)),
    ),
  );
  auth.syncUser();

  return !!auth.user();
}

export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  return (await loggedIn()) || router.createUrlTree(['/login']);
};

/** Convenience only: the admin API enforces ADMIN_USER_IDS itself. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!(await loggedIn())) return router.createUrlTree(['/login']);
  return auth.user()?.isAdmin ? true : router.createUrlTree(['/']);
};
