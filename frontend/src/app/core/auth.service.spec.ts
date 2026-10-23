import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

/** Runs effects and lets the resource process the HTTP response. */
async function settle() {
  TestBed.tick();
  await new Promise((r) => setTimeout(r));
  TestBed.tick();
}

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne('/api/auth/providers').flush([]);
  });

  afterEach(async () => {
    await settle();
    // loaded once a user is known, not under test here
    http.match('/api/auth/links').forEach((r) => r.flush([]));
    http.verify();
  });

  it('syncUser does not throw when /me answered 401 (logged out)', async () => {
    http.expectOne('/api/auth/me').flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    // regression: reading the resource value while in error threw and blanked the page
    expect(() => auth.syncUser()).not.toThrow();
    expect(auth.user()).toBeNull();
  });

  it('syncUser exposes the profile returned by /me', async () => {
    http.expectOne('/api/auth/me').flush({ id: 'u1', email: 'u1@example.test', name: 'U1' });
    await settle();
    auth.syncUser();
    expect(auth.user()?.id).toBe('u1');
  });

  it('acceptToken stores the Bearer token and reloads /me', async () => {
    http.expectOne('/api/auth/me').flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    auth.acceptToken('tok');
    await settle();
    expect(localStorage.getItem('artifact-notifier.accessToken')).toBe('tok');
    expect(auth.authHeaders()).toEqual({ Authorization: 'Bearer tok' });
    http.expectOne('/api/auth/me').flush({ id: 'u1', email: 'u1@example.test' });
  });
});
