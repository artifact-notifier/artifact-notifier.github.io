import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';

const TOKEN_KEY = 'artifact-notifier.accessToken';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('AuthService session and account flows', () => {
  let http: HttpTestingController;
  let router: Router;

  async function settle() {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
  }

  /** Creates the service with /me answered (logged in or not). */
  async function create(me: object | null = { id: 'u1', email: 'u1@example.test' }) {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.tick();
    http.match('/api/auth/providers').forEach((r) => r.flush([]));
    const req = http.expectOne('/api/auth/me');
    if (me) req.flush(me);
    else req.flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.match('/api/auth/links').forEach((r) => r.flush([]));
    await settle();
    return auth;
  }

  /** Answers the /me reload triggered by a logout/refresh. */
  function answerReload() {
    TestBed.tick();
    http.match('/api/auth/me').forEach((r) => r.flush({}, { status: 401, statusText: 'Unauthorized' }));
  }

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  afterEach(() => vi.restoreAllMocks());

  describe('token from the OAuth redirect', () => {
    it('reads it from the hash route and removes it from the URL', async () => {
      history.replaceState(null, '', '/#/auth/callback?access_token=abc&x=1');
      const auth = await create();
      expect(localStorage.getItem(TOKEN_KEY)).toBe('abc');
      expect(auth.authHeaders()).toEqual({ Authorization: 'Bearer abc' });
      expect(location.hash).toBe('#/auth/callback?x=1');
    });

    it('supports the legacy fragment format', async () => {
      history.replaceState(null, '', '/#access_token=legacy');
      await create();
      expect(localStorage.getItem(TOKEN_KEY)).toBe('legacy');
      // regression: the token stayed in the URL (and the browser history)
      expect(location.href).not.toContain('legacy');
    });

    it('supports a plain query string', async () => {
      history.replaceState(null, '', '/?access_token=q#/');
      await create();
      expect(localStorage.getItem(TOKEN_KEY)).toBe('q');
      expect(location.search).toBe('');
    });

    it('keeps a stored token when the URL has none', async () => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      const auth = await create();
      expect(auth.token()).toBe('stored');
    });
  });

  it('logout clears the session even if the API is unreachable', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const auth = await create();
    expect(auth.user()?.id).toBe('u1');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));

    await auth.logout();
    answerReload();

    expect(auth.user()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  describe('handleUnauthorized', () => {
    it('drops an expired session and goes to login', async () => {
      localStorage.setItem(TOKEN_KEY, 'expired');
      const auth = await create();
      auth.handleUnauthorized();
      answerReload();
      expect(auth.token()).toBeNull();
      expect(auth.user()).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('only navigates when already logged out', async () => {
      const auth = await create(null);
      auth.handleUnauthorized();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
      http.expectNone('/api/auth/me');
    });
  });

  describe('account linking', () => {
    it('confirmLink posts the token and returns the outcome', async () => {
      const auth = await create();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ linked: 'github' }));
      await expect(auth.confirmLink('t1')).resolves.toEqual({ linked: 'github' });
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/link/confirm');
      expect((fetchSpy.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ token: 't1' }));
    });

    it('confirmLink rejects with the API error', async () => {
      const auth = await create();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Invalid or expired' }, 401));
      await expect(auth.confirmLink('t1')).rejects.toEqual({ message: 'Invalid or expired' });
    });

    it('linkProvider asks for a one-time token before redirecting', async () => {
      const auth = await create();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, 401));
      await expect(auth.linkProvider('github')).rejects.toEqual({});
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/link-token');
    });

    it('unlinkProvider deletes the identity and reloads the links', async () => {
      const auth = await create();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
      await auth.unlinkProvider('github');
      expect(fetchSpy.mock.calls[0]).toEqual(['/api/auth/github/link', expect.objectContaining({ method: 'DELETE' })]);
      await settle();
      http.expectOne('/api/auth/links').flush([]);
    });

    it('unlinkProvider rejects with a default message', async () => {
      const auth = await create();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 500 }));
      await expect(auth.unlinkProvider('github')).rejects.toEqual({ message: 'Unlink failed' });
    });
  });

  describe('deleteAccount', () => {
    it('deletes, clears the session and goes to login', async () => {
      localStorage.setItem(TOKEN_KEY, 'tok');
      const auth = await create();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true }));
      await auth.deleteAccount();
      answerReload();
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('keeps the session when the API refuses', async () => {
      const auth = await create();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 500 }));
      await expect(auth.deleteAccount()).rejects.toEqual({ message: 'Delete failed' });
      expect(auth.user()?.id).toBe('u1');
    });
  });
});
