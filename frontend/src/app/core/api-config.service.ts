import { APP_INITIALIZER, Injectable, Provider, inject, signal } from '@angular/core';

/**
 * API base URL — OPS config only (no UI).
 * Resolution order:
 *  1. window.__API_BASE_URL__ (injected by the host, takes precedence)
 *  2. assets/api-config.json -> { "apiBaseUrl": "https://api.example.com" }
 *     ("": same origin, uses the dev proxy / the prod reverse proxy)
 */
declare global {
  interface Window { __API_BASE_URL__?: string }
}

function normalizeBase(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

export function buildApiUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}

@Injectable({ providedIn: 'root' })
export class ApiConfigService {
  private readonly _base = signal('');

  readonly base = this._base.asReadonly();

  /** Loads the OPS config. Called via APP_INITIALIZER. */
  async load(): Promise<void> {
    let fileBase = '';
    try {
      const res = await fetch('assets/api-config.json', { cache: 'no-store' });
      if (res.ok) fileBase = (await res.json())?.apiBaseUrl ?? '';
    } catch { /* missing file = same-origin */ }
    const override = typeof window !== 'undefined' ? window.__API_BASE_URL__ : '';
    this._base.set(normalizeBase(override || fileBase));
  }

  apiUrl(path: string): string {
    return buildApiUrl(this._base(), path);
  }
}

export function provideApiConfig(): Provider[] {
  return [
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const svc = inject(ApiConfigService);
        return () => svc.load();
      },
    },
  ];
}
