import { Component, computed, inject, effect, ElementRef, viewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TelegramService } from '../core/telegram.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [CommonModule],
  template: `
    <div class="container">
      <div class="card">
        <h1>{{ i18n.t()('login.title') }}</h1>
        <p class="muted">{{ i18n.t()('login.subtitle') }}</p>
        <div class="intro">
          <p class="intro-title">{{ i18n.t()('login.intro.title') }}</p>
          <ul>
            <li>{{ i18n.t()('login.intro.1') }}</li>
            <li>{{ i18n.t()('login.intro.2') }}</li>
            <li>{{ i18n.t()('login.intro.3') }}</li>
          </ul>
        </div>
        @if (error) {
          <p style="color:#dc2626">{{ i18n.t()('login.error', {msg: error}) }}</p>
        }
        <div class="row">
          @for (p of providers(); track p.key) {
            <button class="btn provider-btn" (click)="login(p.key)">
              <img [src]="logoFor(p.key)" [alt]="p.displayName" width="18" height="18" loading="lazy"
                (error)="hideImg($event)" />
              <span>{{ i18n.t()('login.with', {name: p.displayName}) }}</span>
            </button>
          }
          @if (providers()?.length === 0) {
            <p class="muted">{{ i18n.t()('login.noProvider') }}</p>
          }
        </div>
        @if (telegram.enabled()) {
          <div style="margin-top:1rem;border-top:1px solid var(--border);padding-top:1rem">
            <p class="muted" style="font-size:.85rem">{{ i18n.t()('login.telegram') }}</p>
            <div #telegramBox></div>
            @if (telegramLoading()) { <p class="muted" style="font-size:.8rem">…</p> }
            @if (telegramError) { <p style="color:#dc2626;font-size:.85rem">{{ telegramError }} <button class="btn secondary small" (click)="retryWidget()">{{ i18n.t()('telegram.retry') }}</button></p> }
          </div>
        } @else if (telegram.config.isLoading()) {
          <p class="muted" style="font-size:.8rem">…</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .intro{background:rgba(127,127,127,.08);border-radius:8px;padding:.75rem 1rem;margin:.75rem 0;text-align:left}
    .intro-title{font-weight:600;margin:0 0 .4rem}
    .intro ul{margin:0;padding-left:1.1rem}
    .intro li{margin:.25rem 0;font-size:.9rem}
    .provider-btn{display:inline-flex;align-items:center;gap:.5rem}
    .provider-btn img{width:18px;height:18px;flex:none}
    .provider-btn{background:#fff;color:#1f2937;border:1px solid var(--border)}
    :host-context(html.dark) .provider-btn{background:#1f2937;color:#f3f4f6}
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected telegram = inject(TelegramService);
  private router = inject(Router);
  protected readonly providers = this.auth.providers.value;
  error = '';
  telegramError = '';
  telegramBox = viewChild<ElementRef>('telegramBox');
  private widgetInjectedFor = signal<string | null>(null);
  private widgetFailed = signal(false);
  protected readonly telegramLoading = computed(
    () => this.telegram.config.isLoading() && !this.widgetInjectedFor(),
  );

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.error = params.get('error') || '';
    (window as any).onTelegramAuth = (user: any) => this.onTelegramAuth(user);
    effect(() => {
      const username = this.telegram.botUsername();
      const box = this.telegramBox()?.nativeElement;
      // Inject once per bot username: re-injecting the Telegram script on every
      // signal re-evaluation made the widget flicker / randomly disappear.
      if (!username || !box || !this.telegram.enabled()) return;
      if (this.widgetInjectedFor() === username && box.querySelector('iframe')) return;
      this.injectWidget(box, username);
    });
  }

  private injectWidget(box: HTMLElement, username: string) {
    this.widgetFailed.set(false);
    this.telegramError = '';
    box.innerHTML = '';
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', username);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    s.setAttribute('data-request-access', 'write');
    s.onload = () => this.widgetInjectedFor.set(username);
    s.onerror = () => {
      this.widgetFailed.set(true);
      this.widgetInjectedFor.set(null);
      this.telegramError = 'Telegram widget failed to load (domain not allowed or network/adblock)';
    };
    box.appendChild(s);
    // Fallback: if Telegram never calls back (no iframe after 5s), allow retry.
    setTimeout(() => {
      if (!box.querySelector('iframe') && this.widgetInjectedFor() !== username) {
        this.widgetFailed.set(true);
        this.telegramError = 'Telegram widget failed to load (domain not allowed or network/adblock)';
      }
    }, 5000);
  }

  protected retryWidget() {
    this.widgetInjectedFor.set(null);
    this.widgetFailed.set(false);
    this.telegramError = '';
    const username = this.telegram.botUsername();
    const box = this.telegramBox()?.nativeElement;
    if (username && box) this.injectWidget(box, username);
    else this.telegram.config.reload();
  }

  login(key: string) { this.auth.loginWith(key); }

  // Brand logos via devicon CDN (same pattern as eco-icon.component).
  // Unknown providers fall back to a generic OAuth icon; broken images hide themselves.
  logoFor(key: string): string {
    const k = (key || '').toLowerCase();
    if (k === 'google') return 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/google/google-original.svg';
    if (k === 'github') return 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/github/github-original.svg';
    if (k === 'facebook') return 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/facebook/facebook-original.svg';
    return 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/oauth/oauth-original.svg';
  }

  hideImg(e: Event) { (e.target as HTMLImageElement)?.remove(); }

  async onTelegramAuth(user: any) {
    try {
      await this.telegram.verify(user);
      this.router.navigate(['/']);
    } catch (e: any) {
      this.telegramError = e?.error?.message || e?.message || 'Telegram login failed';
    }
  }
}
