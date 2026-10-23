import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot, UrlTree } from '@angular/router';
import { adminGuard, authGuard } from './auth.guard';

describe('authGuard', () => {
  let http: HttpTestingController;

  const run = () =>
    TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Promise<
      boolean | UrlTree
    >;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Lets the guard start waiting, then answers /me (the resource may be reloaded once). */
  async function answerMe(body: object, status = 200) {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      TestBed.tick();
      const pending = http.match('/api/auth/me');
      if (pending.length) {
        pending.forEach((r) => r.flush(body, { status, statusText: status === 200 ? 'OK' : 'Unauthorized' }));
        return;
      }
    }
    throw new Error('/api/auth/me was never requested');
  }

  it('redirects to /login when logged out (instead of failing the navigation)', async () => {
    const result = run();
    await answerMe({ message: 'Unauthorized' }, 401);
    const tree = await result;
    expect(tree instanceof UrlTree).toBe(true);
    expect(String(tree)).toBe('/login');
  });

  it('lets an authenticated user through', async () => {
    const result = run();
    await answerMe({ id: 'u1', email: 'u1@example.test' });
    expect(await result).toBe(true);
  });

  describe('adminGuard', () => {
    const runAdmin = () =>
      TestBed.runInInjectionContext(() =>
        adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as Promise<boolean | UrlTree>;

    it('lets an admin through', async () => {
      const result = runAdmin();
      await answerMe({ id: 'u1', email: 'u1@example.test', isAdmin: true });
      expect(await result).toBe(true);
    });

    it('sends a regular user back to the dashboard', async () => {
      const result = runAdmin();
      await answerMe({ id: 'u1', email: 'u1@example.test', isAdmin: false });
      expect(String(await result)).toBe('/');
    });

    it('sends a visitor to login', async () => {
      const result = runAdmin();
      await answerMe({ message: 'Unauthorized' }, 401);
      expect(String(await result)).toBe('/login');
    });
  });
});
