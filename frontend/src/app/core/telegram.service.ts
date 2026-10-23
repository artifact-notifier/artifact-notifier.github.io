import { Injectable, inject, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { AuthService } from './auth.service';
import { PreferencesService } from '../preferences/preferences.service';
import { ApiConfigService } from './api-config.service';
import { valueOrUndefined } from '../shared/resource-value';

export interface TelegramConfig {
  enabled: boolean;
  botUsername: string | null;
}
export interface TelegramStatus {
  linked: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
}

@Injectable({ providedIn: 'root' })
export class TelegramService {
  private auth = inject(AuthService);
  private prefs = inject(PreferencesService);
  private api = inject(ApiConfigService);
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...this.auth.authHeaders(), ...extra };
  }

  readonly config = httpResource<TelegramConfig>(() => ({ url: this.api.apiUrl('/api/auth/telegram/config') }));
  readonly status = httpResource<TelegramStatus>(() =>
    this.auth.user() ? { url: this.api.apiUrl('/api/auth/telegram/status') } : undefined,
  );

  readonly botUsername = computed(() => valueOrUndefined(this.config)?.botUsername || null);
  readonly enabled = computed(() => !!valueOrUndefined(this.config)?.enabled);
  // linked via User.telegramId OR via UserPreferences.telegramChatId (manual localhost fallback)
  readonly linked = computed(
    () => !!valueOrUndefined(this.status)?.linked || !!valueOrUndefined(this.prefs.resource)?.telegramChatId,
  );

  async verify(data: any): Promise<void> {
    const res = await fetch(this.api.apiUrl('/api/auth/telegram/verify'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Telegram verify failed' }));
    const { token } = await res.json();
    this.status.reload();
    // The session cookie is third-party when cross-origin: keep the Bearer token too
    if (token) this.auth.acceptToken(token);
    else this.auth.refresh();
  }

  async link(data: any): Promise<void> {
    const res = await fetch(this.api.apiUrl('/api/auth/telegram/link'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Link failed' }));
    this.status.reload();
    this.auth.refresh();
  }

  async unlink(): Promise<void> {
    const res = await fetch(this.api.apiUrl('/api/auth/telegram/unlink'), {
      method: 'DELETE',
      credentials: 'include',
      headers: this.headers(),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Unlink failed' }));
    this.status.reload();
    this.auth.refresh();
  }

  reload() {
    this.status.reload();
  }
}
