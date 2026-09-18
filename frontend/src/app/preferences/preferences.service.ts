import { Injectable, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { ApiConfigService } from '../core/api-config.service';

export interface Preferences {
  userId: string;
  email: string;
  notificationMode: 'IMMEDIATE' | 'DIGEST';
  digestIntervalMinutes: number;
  locale: 'fr' | 'en' | 'es' | 'de' | 'zh';
  theme: 'light' | 'dark' | 'system';
  notificationChannel: 'email' | 'telegram' | 'both';
  telegramChatId?: string | null;
}

export interface NotificationConstraints {
  immediateChannels: string[];
  mailMinDigestMinutes: number;
}

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly api = inject(ApiConfigService);
  private readonly auth = inject(AuthService);

  // single source to avoid 3x GET /api/preferences
  readonly resource = httpResource<Preferences>(() => this.auth.user() ? { url: this.api.apiUrl('/api/preferences') } : undefined);

  readonly constraints = httpResource<NotificationConstraints>(() =>
    this.auth.user() ? { url: this.api.apiUrl('/api/preferences/constraints') } : undefined,
  );

  async update(dto: Partial<Preferences>): Promise<Preferences> {
    const res = await fetch(this.api.apiUrl('/api/preferences'), {
      method: 'PUT',
      headers: { ...this.auth.authHeaders(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(dto),
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: res.statusText }));
    const json = await res.json();
    this.resource.reload();
    return json;
  }

  reload() {
    this.resource.reload();
  }
}
