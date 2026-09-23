import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, firstValueFrom, timeout, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.user()) return true;

  if (auth.isAuthLoading()) {
    await firstValueFrom(
      toObservable(auth.isAuthLoading).pipe(
        filter((loading) => !loading),
        timeout(5000),
        catchError(() => of(false)),
      ),
    );
  } else {
    auth.refresh();
    await firstValueFrom(
      toObservable(auth.isAuthLoading).pipe(
        filter((loading) => !loading),
        timeout(5000),
        catchError(() => of(false)),
      ),
    );
  }

  if (auth.user()) return true;

  router.navigate(['/login']);
  return false;
};
