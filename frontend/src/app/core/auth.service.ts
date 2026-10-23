import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import { ApiConfigService } from './api-config.service';

export interface Provider {
  key: string;
  displayName: string;
}
export interface Profile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  provider: string;
  telegramId?: string | null;
  telegramUsername?: string | null;
  preferences?: any;
}

const ACCESS_TOKEN_KEY = 'artifact-notifier.accessToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiConfigService);
  private router = inject(Router);

  readonly providers = httpResource<Provider[]>(() => ({ url: this.api.apiUrl('/api/auth/providers') }));

  private readonly me = httpResource<Profile>(() => ({ url: this.api.apiUrl('/api/auth/me') }));
  private readonly _user = signal<Profile | null>(null);
  private readonly _token = signal<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem(ACCESS_TOKEN_KEY) : null,
  );

  readonly user = this._user.asReadonly();
  readonly isAuthLoading = computed(() => this.me.isLoading());
  /** Fallback Bearer for cross-origin (third-party cookies blocked). */
  readonly token = this._token.asReadonly();

  constructor() {
    // Hash-location hosting (GitHub Pages): backend redirects to
    // /#/auth/callback?access_token=... so the route lives inside the
    // fragment. Legacy format /auth/callback#access_token=... still supported.
    if (typeof window !== 'undefined') {
      const t = this.extractTokenFromUrl(window.location);
      if (t) this.setToken(t);
      if (t) {
        // Clean the token from the URL, preserving the hash route.
        const hash = window.location.hash;
        if (hash.includes('access_token=')) {
          const cleanHash = hash.replace(/([?&])access_token=[^&]*&?/, '$1').replace(/[?&]$/, '');
          window.history.replaceState(null, '', window.location.pathname + window.location.search + cleanHash);
        } else {
          const url = new URL(window.location.href);
          url.searchParams.delete('access_token');
          window.history.replaceState(null, '', url.pathname + url.search + window.location.hash);
        }
      }
    }
    effect(() => this.syncUser());
  }

  /** Copies the /me result into `user` (also called by the guard, which can't rely on effect timing). */
  syncUser() {
    // value() throws while the resource is in error (401 when logged out): check error first
    if (this.me.error()) this._user.set(null);
    else if (this.me.hasValue()) this._user.set(this.me.value());
  }

  private extractTokenFromUrl(loc: Location): string | null {
    // 1. Hash route query: #/auth/callback?access_token=...
    const hash = loc.hash || '';
    const qIndex = hash.indexOf('?');
    if (qIndex >= 0) {
      const t = new URLSearchParams(hash.slice(qIndex + 1)).get('access_token');
      if (t) return t;
    }
    // 2. Legacy fragment: #access_token=... or #/auth/callback#access_token=
    if (hash.includes('access_token=')) {
      const t = new URLSearchParams(hash.replace(/^#\/?/, '').split('#').pop()!).get('access_token');
      if (t) return t;
    }
    // 3. Plain query (non-hash hosting): ?access_token=...
    return new URLSearchParams(loc.search).get('access_token');
  }

  /** Session obtained outside the OAuth redirect (Telegram login): store it, then reload /me. */
  acceptToken(t: string) {
    this.setToken(t);
    this.refresh();
  }

  private setToken(t: string | null) {
    this._token.set(t);
    if (t) localStorage.setItem(ACCESS_TOKEN_KEY, t);
    else localStorage.removeItem(ACCESS_TOKEN_KEY);
  }

  authHeaders(): Record<string, string> {
    const t = this._token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  loginWith(provider: string) {
    window.location.href = this.api.apiUrl(`/api/auth/${provider}`);
  }

  readonly linkedProviders = httpResource<{ key: string; displayName: string; linked: boolean }[]>(() =>
    this._user() ? { url: this.api.apiUrl('/api/auth/links') } : undefined,
  );

  /** Start an account-link flow: one-time token bridges the session across OAuth navigation. */
  async linkProvider(provider: string) {
    const res = await fetch(this.api.apiUrl('/api/auth/link-token'), {
      method: 'POST',
      credentials: 'include',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Link failed' }));
    const { token } = await res.json();
    window.location.href = this.api.apiUrl(`/api/auth/${provider}/link?token=${token}`);
  }

  /** Confirms the identity returned by a link round-trip (merge token if it belongs to another account). */
  async confirmLink(token: string): Promise<{ linked?: string; merge?: string }> {
    const res = await fetch(this.api.apiUrl('/api/auth/link/confirm'), {
      method: 'POST',
      credentials: 'include',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Link failed' }));
    return res.json();
  }

  async unlinkProvider(provider: string): Promise<void> {
    const res = await fetch(this.api.apiUrl(`/api/auth/${provider}/link`), {
      method: 'DELETE',
      credentials: 'include',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Unlink failed' }));
    this.linkedProviders.reload();
  }

  /** Permanently delete the current account, then land on login. */
  async deleteAccount(): Promise<void> {
    const res = await fetch(this.api.apiUrl('/api/auth/account'), {
      method: 'DELETE',
      credentials: 'include',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Delete failed' }));
    this.clearSession();
    this.me.reload();
    void this.router.navigate(['/login']);
  }

  async logout() {
    // Offline/API down: the local session is dropped anyway
    await fetch(this.api.apiUrl('/api/auth/logout'), {
      credentials: 'include',
      headers: this.authHeaders(),
    }).catch(() => undefined);
    this.clearSession();
    this.me.reload();
    void this.router.navigate(['/login']);
  }

  /** Called on 401 (expired/invalid session): clear local session once and go to login. */
  handleUnauthorized() {
    if (!this._user() && !this._token()) {
      // Already logged out — just ensure we land on login.
      if (!this.router.url.includes('/login')) void this.router.navigate(['/login']);
      return;
    }
    this.clearSession();
    this.me.reload();
    if (!this.router.url.includes('/login')) void this.router.navigate(['/login']);
  }

  private clearSession() {
    this.setToken(null);
    this._user.set(null);
  }

  refresh() {
    this.me.reload();
  }
}
