import { Component, inject, signal, effect, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PreferencesService, Preferences } from './preferences.service';
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
        <p class="muted" style="margin:.25rem 0 0">{{ p.email }}</p>

        <label style="display:block; margin-top:1rem;">{{ i18n.t()('preferences.mode') }}</label>
        <select [ngModel]="p.notificationMode" (ngModelChange)="update('notificationMode', $event)">
          <option value="IMMEDIATE">{{ i18n.t()('preferences.mode.immediate') }}</option>
          <option value="DIGEST">{{ i18n.t()('preferences.mode.digest') }}</option>
        </select>

        @if (p.notificationMode === 'DIGEST') {
          <label style="display:block; margin-top:1rem;">{{ i18n.t()('preferences.interval') }}</label>
          <input type="number" [ngModel]="p.digestIntervalMinutes" (ngModelChange)="update('digestIntervalMinutes', +$event)" min="1"/>
        }

        <label style="display:block; margin-top:1rem;">{{ i18n.t()('preferences.channel') }}</label>
        <select [ngModel]="p.notificationChannel" (ngModelChange)="update('notificationChannel', $event)">
          <option value="email">{{ i18n.t()('preferences.channel.email') }}</option>
          <option value="telegram" [disabled]="!telegram.linked()">{{ i18n.t()('preferences.channel.telegram') }}</option>
          <option value="both" [disabled]="!telegram.linked()">{{ i18n.t()('preferences.channel.both') }}</option>
        </select>
        @if (!telegram.linked() && (p.notificationChannel === 'telegram' || p.notificationChannel === 'both')) {
          <p class="muted" style="color:#dc2626;font-size:.8rem">{{ i18n.t()('preferences.channel.telegramRequired') }}</p>
        }

        <div class="card" style="margin-top:1rem;background:var(--hover)">
          <h3 style="margin:0 0 .5rem">📲 {{ i18n.t()('telegram.title') }}</h3>
          @if (telegram.linked()) {
            <p class="muted">{{ i18n.t()('telegram.linkedAs', {username: telegram.status.value()?.telegramUsername || telegram.status.value()?.telegramId || ''}) }}</p>
            <button class="btn secondary small" (click)="unlinkTelegram()">{{ i18n.t()('telegram.unlink') }}</button>
          } @else {
            <p class="muted" style="font-size:.85rem">{{ i18n.t()('telegram.notLinked') }}</p>
            @if (telegram.enabled()) {
              <div #telegramLinkBox></div>
              <p class="muted" style="font-size:.75rem">{{ i18n.t()('telegram.hint') }}</p>
            } @else {
              <p class="muted" style="color:#dc2626">{{ i18n.t()('telegram.notConfigured') }}</p>
            }
            @if (telegramError) { <p style="color:#dc2626;font-size:.85rem">{{ telegramError }}</p> }
            <!-- fallback: manual ID input -->
            <div style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center">
              <input [ngModel]="manualChatId()" (ngModelChange)="manualChatId.set($event)" placeholder="Telegram chat ID / username" style="flex:1" />
              <button class="btn small" (click)="linkManual()">{{ i18n.t()('telegram.linkManual') }}</button>
            </div>
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
      </div>
    }
  `,
})
export class PreferencesComponent {
  private readonly preferencesService = inject(PreferencesService);
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

  constructor() {
    effect(() => {
      const v = this.prefsRes.value();
      if (v) this.prefs.set(v);
    });
    (window as any).onTelegramAuthLink = (user: any) => this.onTelegramLink(user);
    effect(() => {
      const username = this.telegram.botUsername();
      const box = this.telegramLinkBox()?.nativeElement;
      if (username && box && this.telegram.enabled() && !this.telegram.linked()) {
        box.innerHTML = '';
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://telegram.org/js/telegram-widget.js?22';
        s.setAttribute('data-telegram-login', username);
        s.setAttribute('data-size', 'large');
        s.setAttribute('data-onauth', 'onTelegramAuthLink(user)');
        s.setAttribute('data-request-access', 'write');
        box.appendChild(s);
      }
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

  async save() {
    const p = this.prefs();
    if (!p) return;
    try {
      // do not overwrite locale/theme managed separately
      const { locale: _l, theme: _t, ...dto } = p as Preferences & { locale?: string; theme?: string };
      // if telegram is not linked, force email
      if (!this.telegram.linked() && (dto.notificationChannel === 'telegram' || dto.notificationChannel === 'both')) {
        (dto as any).notificationChannel = 'email';
        this.prefs.update(v => v ? { ...v, notificationChannel: 'email' as any } : v);
      }
      await this.preferencesService.update(dto);
      this.prefsRes.reload();
      this.saved.set(true);
      this.toast.show(this.i18n.t()('preferences.saved'), 'success');
      setTimeout(() => this.saved.set(false), 3000);
    } catch {
      this.saved.set(false);
    }
  }
}
