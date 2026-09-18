import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { TelegramService } from './telegram.service';
import { I18nService } from './i18n.service';

const DISMISS_KEY = 'telegram-banner.dismissed';

@Component({
  selector: 'app-telegram-banner',
  imports: [RouterLink],
  template: `
    @if (visible()) {
      <div class="tg-banner" role="status">
        <span class="tg-text">📲 {{ i18n.t()('telegramBanner.text') }}</span>
        <a routerLink="/preferences" class="btn small">{{ i18n.t()('telegramBanner.cta') }}</a>
        <button class="tg-close" (click)="dismiss()" [attr.aria-label]="i18n.t()('telegramBanner.dismiss')">✕</button>
      </div>
    }
  `,
  styles: `
    .tg-banner{display:flex;align-items:center;gap:.75rem;background:#0f766e;color:#fff;border-radius:10px;padding:.6rem .9rem;margin:.75rem 0}
    .tg-text{flex:1;font-size:.9rem}
    .tg-banner .btn{background:#fff;color:#0f766e;border:none}
    .tg-close{background:transparent;border:none;color:#fff;font-size:1rem;cursor:pointer;opacity:.8}
    .tg-close:hover{opacity:1}
  `,
})
export class TelegramBannerComponent {
  private readonly auth = inject(AuthService);
  protected readonly telegram = inject(TelegramService);
  protected readonly i18n = inject(I18nService);
  private readonly dismissed = signal(
    typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1',
  );

  protected readonly visible = computed(() => {
    if (!this.auth.user()) return false;
    if (this.dismissed()) return false;
    return !this.telegram.linked();
  });

  dismiss() {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch { /* ignore */ }
  }
}
