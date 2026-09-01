import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.user()) return true;
  auth.refresh();
  // signal: wait 1 tick for httpResource to resolve
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      if (auth.user()) resolve(true);
      else { router.navigate(['/login']); resolve(false); }
    }, 300);
  });
};
