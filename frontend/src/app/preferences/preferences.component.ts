import { Component, computed, inject, signal, effect, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { httpResource } from '@angular/common/http';
import { PreferencesService, Preferences } from './preferences.service';
import { AuthService } from '../core/auth.service';
import { ApiConfigService } from '../core/api-config.service';
import { I18nService } from '../core/i18n.service';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { TelegramService } from '../core/telegram.service';

@Component({
  selector: 'app-preferences',
  imports: [CommonModule, FormsModule],
  template: `
    <h1>{{ i18n.t()('preferences.title') }}</h1>
    @let p = prefs();
    @if (p) {
      <div class="card">
        <label>{{ i18n.t()('preferences.email') }}</label>
        <input type="email" [ngModel]="p.email" (ngModelChange)="update('email', $event)" placeholder="you@example.com" style="width:100%;margin-top:.25rem" />
        @if (isPlaceholderEmail(p.email)) {
          <p class="muted" style="color:#dc2626;font-size:.8rem">{{ i18n.t()('preferences.email.telegramOnly') }}</p>
        }

        <label style="display:block; margin-top:1rem;">{{ i18n.t()('preferences.channel') }}</label>
        <select [ngModel]="p.notificationChannel" (ngModelChange)="onChannelChange($event)">
          <option value="email">{{ i18n.t()('preferences.channel.email') }}</option>
          <option value="telegram" [disabled]="!telegram.linked()">{{ i18n.t()('preferences.channel.telegram') }}</option>
          <option value="both" [disabled]="!telegram.linked()">{{ i18n.t()('preferences.channel.both') }}</option>
        </select>
        @if (!telegram.linked() && (p.notificationChannel === 'telegram' || p.notificationChannel === 'both')) {
          <p class="muted" style="color:#dc2626;font-size:.8rem">{{ i18n.t()('preferences.channel.telegramRequired') }}</p>
        }
        @if (needsRealEmail()) {
          <p class="muted" style="color:#dc2626;font-size:.8rem">{{ i18n.t()('preferences.email.realRequired') }}</p>
        }

        <label style="display:block; margin-top:1rem;">{{ i18n.t()('preferences.mode') }}</label>
        <select [ngModel]="p.notificationMode" (ngModelChange)="update('notificationMode', $event)">
          <option value="IMMEDIATE" [disabled]="!immediateAllowed()">{{ i18n.t()('preferences.mode.immediate') }}</option>
          <option value="DIGEST">{{ i18n.t()('preferences.mode.digest') }}</option>
        </select>
        @if (!immediateAllowed()) {
          <p class="muted" style="font-size:.8rem">{{ i18n.t()('preferences.mode.immediateTelegramOnly') }}</p>
        }

        @if (p.notificationMode === 'DIGEST' || !immediateAllowed()) {
          <label style="display:block; margin-top:1rem;">{{ i18n.t()('preferences.interval') }}</label>
          <select [ngModel]="p.digestIntervalMinutes" (ngModelChange)="update('digestIntervalMinutes', +$event)">
            @for (opt of intervalOptions(); track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
          <p class="muted" style="font-size:.8rem">{{ i18n.t()('preferences.interval.mailMin') }}</p>
        }

        <div class="card" style="margin-top:1rem;background:var(--hover)">
          <h3 style="margin:0 0 .5rem">📲 {{ i18n.t()('telegram.title') }}</h3>
          @if (telegram.linked()) {
            <p class="muted">{{ i18n.t()('telegram.linkedAs', {label: telegramLabel()}) }}</p>
            <button class="btn secondary small" (click)="unlinkTelegram()">{{ i18n.t()('telegram.unlink') }}</button>
          } @else {
            <p class="muted" style="font-size:.85rem">{{ i18n.t()('telegram.notLinked') }}</p>
            @if (telegram.enabled()) {
              <div #telegramLinkBox></div>
              <p class="muted" style="font-size:.75rem">{{ i18n.t()('telegram.hint') }}</p>
            }             @else {
              <p class="muted" style="font-size:.85rem">{{ i18n.t()('telegram.notConfigured') }}</p>
            }
            @if (telegramError) { <p style="color:#dc2626;font-size:.85rem">{{ telegramError }}</p> }
            <!-- fallback: manual ID input -->
            <div style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center">
              <input [ngModel]="manualChatId()" (ngModelChange)="manualChatId.set($event)" placeholder="Telegram chat ID / username" style="flex:1" />
              <button class="btn small" (click)="linkManual()">{{ i18n.t()('telegram.linkManual') }}</button>
            </div>
          }
        </div>

        <div class="card" style="margin-top:1rem;background:var(--hover)">
          <h3 style="margin:0 0 .5rem">🔗 {{ i18n.t()('linked.title') }}</h3>
          <p class="muted" style="font-size:.85rem">{{ i18n.t()('linked.subtitle') }}</p>
          @if (auth.linkedProviders.value(); as links) {
            <ul style="list-style:none;margin:.5rem 0;padding:0;display:flex;flex-direction:column;gap:.4rem">
              @for (l of links; track l.key) {
                <li style="display:flex;align-items:center;gap:.5rem">
                  <span style="flex:1">{{ l.displayName }}</span>
                  @if (l.linked) {
                    <span class="muted" style="font-size:.8rem">✓ {{ i18n.t()('linked.linked') }}</span>
                    <button class="btn secondary small" (click)="unlinkProvider(l.key)">{{ i18n.t()('linked.unlink') }}</button>
                  } @else {
                    <button class="btn small" (click)="linkProvider(l.key)">{{ i18n.t()('linked.link') }}</button>
                  }
                </li>
              }
            </ul>
          }
        </div>

        <label style="display:block; margin-top:1rem;">{{ i18n.t()('theme.label') }}</label>
        <select [ngModel]="theme.theme()" (ngModelChange)="theme.setTheme($event)">
          <option value="light">{{ i18n.t()('theme.light') }}</option>
          <option value="dark">{{ i18n.t()('theme.dark') }}</option>
          <option value="system">{{ i18n.t()('theme.system') }}</option>
        </select>

        <div style="margin-top:1rem;">
          <button class="btn" (click)="save()">{{ i18n.t()('preferences.save') }}</button>
          @if (saved()) { <span class="muted"> {{ i18n.t()('preferences.saved') }}</span> }
        </div>

        @if (mergeToken()) {
          <div class="card" style="margin-top:1rem;border:1.5px solid #2563eb">
            <h3 style="margin:0 0 .5rem">🔀 {{ i18n.t()('merge.title') }}</h3>
            @if (mergePreview.value(); as m) {
              <p class="muted" style="font-size:.85rem">{{ i18n.t()('merge.detail', {from: m.from.email, to: m.to.email}) }}</p>
              <ul class="muted" style="font-size:.85rem">
                <li>{{ i18n.t()('merge.follows', {n: '' + m.followsToMove}) }}</li>
                <li>{{ i18n.t()('merge.identities', {n: '' + m.identitiesToMove}) }}</li>
                @if (m.telegramToMove) { <li>{{ i18n.t()('merge.telegram') }}</li> }
              </ul>
              <div class="row">
                <button class="btn" (click)="confirmMerge()">{{ i18n.t()('merge.confirm') }}</button>
                <button class="btn secondary" (click)="cancelMerge()">{{ i18n.t()('merge.cancel') }}</button>
              </div>
            } @else if (mergePreview.error()) {
              <p style="color:#dc2626;font-size:.85rem">{{ i18n.t()('merge.expired') }}</p>
              <button class="btn secondary small" (click)="cancelMerge()">{{ i18n.t()('merge.cancel') }}</button>
            } @else {
              <p class="muted">…</p>
            }
          </div>
        }

        <div class="card" style="margin-top:1rem;border:1.5px solid #dc2626">
          <h3 style="margin:0 0 .5rem">☠️ {{ i18n.t()('danger.title') }}</h3>
          @if (!deleteArmed()) {
            <button class="btn danger" (click)="deleteArmed.set(true)">{{ i18n.t()('danger.delete') }}</button>
          } @else {
            <p class="muted" style="font-size:.85rem">{{ i18n.t()('danger.confirm') }}</p>
            <div class="row">
              <button class="btn danger" (click)="deleteAccount()">{{ i18n.t()('danger.yes') }}</button>
              <button class="btn secondary" (click)="deleteArmed.set(false)">{{ i18n.t()('danger.no') }}</button>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class PreferencesComponent {
  private readonly preferencesService = inject(PreferencesService);
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  protected readonly telegram = inject(TelegramService);
  private readonly toast = inject(ToastService);

  private readonly prefsRes = this.preferencesService.resource;
  protected readonly prefs = signal<Preferences | null>(null);
  protected readonly saved = signal(false);
  protected telegramError = '';
  protected manualChatId = signal('');
  telegramLinkBox = viewChild<ElementRef>('telegramLinkBox');
  private widgetInjectedFor = signal<string | null>(null);
  protected readonly mergeToken = signal<string | null>(null);
  protected readonly deleteArmed = signal(false);

  private readonly api = inject(ApiConfigService);

  protected readonly mergePreview = httpResource<{
    from: { email: string; provider: string };
    to: { email: string; provider: string };
    followsToMove: number;
    duplicateFollows: number;
    identitiesToMove: number;
    telegramToMove: boolean;
  }>(() => {
    const t = this.mergeToken();
    return t && this.auth.user() ? { url: this.api.apiUrl(`/api/auth/merge/preview?token=${t}`) } : undefined;
  });

  protected telegramLabel(): string {
    const s = this.telegram.status.value();
    const id = s?.telegramId || this.prefs()?.telegramChatId || '';
    const username = s?.telegramUsername;
    return username ? `@${username} (${id})` : `${id}`;
  }

  /** Placeholder identities (e.g. 123@telegram.local) can't receive mail. */
  protected isPlaceholderEmail(email: string | null | undefined): boolean {
    return !!email && /\.local$/i.test(email);
  }

  protected needsRealEmail(): boolean {
    const p = this.prefs();
    if (!p) return false;
    const ch = p.notificationChannel;
    return (ch === 'email' || ch === 'both') && this.isPlaceholderEmail(p.email);
  }

  /** Immediate is Telegram-only (backend enforces it too). */
  protected readonly immediateAllowed = computed(() => {
    const allowed = this.preferencesService.constraints.value()?.immediateChannels ?? ['telegram'];
    return allowed.includes(this.prefs()?.notificationChannel ?? 'email');
  });

  protected readonly intervalOptions = computed(() => {
    const min = this.preferencesService.constraints.value()?.mailMinDigestMinutes ?? 1440;
    const all = [
      { value: 1440, label: this.i18n.t()('preferences.interval.daily') },
      { value: 10080, label: this.i18n.t()('preferences.interval.weekly') },
      { value: 43200, label: this.i18n.t()('preferences.interval.monthly') },
    ];
    const filtered = all.filter((o) => o.value >= min);
    return filtered.length ? filtered : all.slice(0, 1);
  });

  protected onChannelChange(channel: Preferences['notificationChannel']) {
    this.prefs.update((p) => {
      if (!p) return p;
      const next = { ...p, notificationChannel: channel };
      // Mail can't be immediate: fall back to digest (backend rejects otherwise).
      const allowed = this.preferencesService.constraints.value()?.immediateChannels ?? ['telegram'];
      if (!allowed.includes(channel)) next.notificationMode = 'DIGEST';
      // Clamp interval to the mail minimum.
      const min = this.preferencesService.constraints.value()?.mailMinDigestMinutes ?? 1440;
      if ((channel === 'email' || channel === 'both') && next.digestIntervalMinutes < min) {
        next.digestIntervalMinutes = min;
      }
      return next;
    });
  }

  constructor() {
    effect(() => {
      const v = this.prefsRes.value();
      if (v) this.prefs.set(v);
    });
    // Feedback from the OAuth link round-trip: /#/preferences?linked=google / ?error=...
    // or a staged merge: /#/preferences?merge=<token>
    if (typeof window !== 'undefined') {
      const hashQuery = window.location.hash.includes('?')
        ? new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?') + 1))
        : new URLSearchParams(window.location.search);
      const linked = hashQuery.get('linked');
      const err = hashQuery.get('error');
      const merge = hashQuery.get('merge');
      if (linked || err || merge) {
        setTimeout(() => {
          if (linked) {
            this.toast.show(this.i18n.t()('linked.success', { name: linked }), 'success');
            this.auth.linkedProviders.reload();
            this.prefsRes.reload();
          } else if (merge) {
            this.mergeToken.set(merge);
          } else if (err) {
            this.toast.show(this.i18n.t()('login.error', { msg: err }), 'error');
          }
        });
        const cleanHash = window.location.hash.split('?')[0];
        window.history.replaceState(null, '', window.location.pathname + cleanHash);
      }
    }
    (window as any).onTelegramAuthLink = (user: any) => this.onTelegramLink(user);
    effect(() => {
      const username = this.telegram.botUsername();
      const box = this.telegramLinkBox()?.nativeElement;
      if (!username || !box || !this.telegram.enabled() || this.telegram.linked()) return;
      // Inject once: re-injecting on every signal change made the widget flicker.
      if (this.widgetInjectedFor() === username && box.querySelector('iframe')) return;
      box.innerHTML = '';
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.setAttribute('data-telegram-login', username);
      s.setAttribute('data-size', 'large');
      s.setAttribute('data-onauth', 'onTelegramAuthLink(user)');
      s.setAttribute('data-request-access', 'write');
      s.onload = () => this.widgetInjectedFor.set(username);
      box.appendChild(s);
    });
  }

  update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    this.prefs.update((p) => (p ? { ...p, [key]: value } : p));
  }

  async onTelegramLink(user: any) {
    try {
      await this.telegram.link(user);
      this.toast.show(this.i18n.t()('telegram.linked'), 'success');
    } catch (e: any) {
      this.telegramError = e?.error?.message || e?.message || 'Link failed';
    }
  }

  async unlinkTelegram() {
    try {
      await this.telegram.unlink();
      this.toast.show(this.i18n.t()('telegram.unlinked'), 'success');
    } catch (e: any) {
      this.toast.show(e?.error?.message || 'Error', 'error');
    }
  }

  async linkManual() {
    const id = this.manualChatId().trim();
    if (!id) return;
    try {
      // bypass widget hash — direct via preferences (dev, localhost)
      await this.preferencesService.update({ telegramChatId: id, notificationChannel: 'telegram' } as any);
      this.prefs.update(p => p ? { ...p, telegramChatId: id, notificationChannel: 'telegram' as any } : p);
      this.telegram.reload();
      this.toast.show(this.i18n.t()('telegram.linked'), 'success');
    } catch (e: any) {
      this.telegramError = e?.error?.message || 'Link failed';
    }
  }

  async linkProvider(key: string) {
    try {
      await this.auth.linkProvider(key);
    } catch (e: any) {
      this.toast.show(e?.message || 'Link failed', 'error');
    }
  }

  async unlinkProvider(key: string) {
    try {
      await this.auth.unlinkProvider(key);
      this.toast.show(this.i18n.t()('linked.unlinked', { name: key }), 'success');
    } catch (e: any) {
      this.toast.show(e?.message || 'Unlink failed', 'error');
    }
  }

  async confirmMerge() {
    const t = this.mergeToken();
    if (!t) return;
    try {
      const res = await fetch(this.api.apiUrl('/api/auth/merge/confirm'), {
        method: 'POST',
        credentials: 'include',
        headers: { ...this.auth.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      if (!res.ok) throw await res.json().catch(() => ({ message: 'Merge failed' }));
      this.mergeToken.set(null);
      this.auth.linkedProviders.reload();
      this.prefsRes.reload();
      this.telegram.reload();
      this.toast.show(this.i18n.t()('merge.done'), 'success');
    } catch (e: any) {
      this.toast.show(e?.message || 'Merge failed', 'error');
    }
  }

  cancelMerge() {
    this.mergeToken.set(null);
  }

  async deleteAccount() {
    try {
      await this.auth.deleteAccount();
      this.toast.show(this.i18n.t()('danger.deleted'), 'success');
    } catch (e: any) {
      this.toast.show(e?.message || 'Delete failed', 'error');
    }
  }

  async save() {
    const p = this.prefs();
    if (!p) return;
    if (this.needsRealEmail()) {
      this.toast.show(this.i18n.t()('preferences.email.realRequired'), 'error');
      return;
    }
    try {
      // do not overwrite locale/theme managed separately
      const { locale: _l, theme: _t, ...dto } = p as Preferences & { locale?: string; theme?: string };
      // if telegram is not linked, force email
      if (!this.telegram.linked() && (dto.notificationChannel === 'telegram' || dto.notificationChannel === 'both')) {
        (dto as any).notificationChannel = 'email';
        this.prefs.update(v => v ? { ...v, notificationChannel: 'email' as any } : v);
      }
      // mail is digest-only: align locally so the backend validation passes.
      const allowed = this.preferencesService.constraints.value()?.immediateChannels ?? ['telegram'];
      if (!allowed.includes(dto.notificationChannel)) dto.notificationMode = 'DIGEST';
      const min = this.preferencesService.constraints.value()?.mailMinDigestMinutes ?? 1440;
      if ((dto.notificationChannel === 'email' || dto.notificationChannel === 'both') && dto.digestIntervalMinutes < min) {
        dto.digestIntervalMinutes = min;
        this.prefs.update(v => v ? { ...v, digestIntervalMinutes: min } : v);
      }
      await this.preferencesService.update(dto);
      this.prefsRes.reload();
      this.saved.set(true);
      this.toast.show(this.i18n.t()('preferences.saved'), 'success');
      setTimeout(() => this.saved.set(false), 3000);
    } catch (e: any) {
      this.saved.set(false);
      this.toast.show(e?.message || e?.error?.message || 'Error', 'error');
    }
  }
}
