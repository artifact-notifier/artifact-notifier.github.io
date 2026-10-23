import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { I18nService } from './core/i18n.service';
import { ThemeService } from './core/theme.service';
import { TelegramBannerComponent } from './core/telegram-banner.component';
import { ToastComponent } from './core/toast.component';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, TelegramBannerComponent, ToastComponent],
  template: `
    <nav class="app-nav">
      <a routerLink="/" class="brand">{{ i18n.t()('app.title') }}</a>
      <span class="spacer"></span>
      <button class="theme-toggle" (click)="theme.toggle()" [attr.aria-label]="theme.theme()" title="Theme">
        @if (theme.resolved() === 'dark') {
          ☀️
        } @else {
          🌙
        }
      </button>
      <label class="lang-switch">
        <select [value]="i18n.lang()" (change)="i18n.setLang($any($event.target).value)" aria-label="Language">
          @for (l of langs; track l) {
            <option [value]="l">{{ narrow() ? l.toUpperCase() : i18n.t()('lang.' + l) }}</option>
          }
        </select>
      </label>
      @if (auth.user(); as u) {
        <a
          routerLink="/preferences"
          class="btn secondary small"
          [attr.aria-label]="i18n.t()('nav.preferences')"
          [title]="i18n.t()('nav.preferences')"
        >
          @if (narrow()) {
            ⚙️
          } @else {
            {{ i18n.t()('nav.preferences') }}
          }
        </a>
        <span class="user">{{ u.name || u.email }}</span>
        <button
          class="btn secondary small"
          (click)="logout()"
          [attr.aria-label]="i18n.t()('nav.logout')"
          [title]="i18n.t()('nav.logout')"
        >
          @if (narrow()) {
            <!-- inline SVG: the ⏻ glyph is missing from most mobile fonts -->
            <svg
              class="icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          } @else {
            {{ i18n.t()('nav.logout') }}
          }
        </button>
      }
    </nav>
    <div class="container">
      <app-telegram-banner />
      <router-outlet />
    </div>
    <app-toast />
  `,
  styles: `
    .brand {
      font-weight: 700;
      font-size: 1.1rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    /* the user name gives way first, then disappears */
    .user {
      opacity: 0.9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 14rem;
      min-width: 0;
      flex-shrink: 20;
    }
    @media (max-width: 900px) {
      .user {
        display: none;
      }
    }
    @media (max-width: 640px) {
      .brand {
        font-size: 1rem;
      }
    }
    .small {
      padding: 0.35rem 0.7rem;
      font-size: 0.85rem;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .icon {
      width: 1.1em;
      height: 1.1em;
      display: block;
    }
    .lang-switch select {
      padding: 0.3rem;
      border-radius: 6px;
      border: 1px solid #374151;
      background: #1f2937;
      color: #fff;
    }
    .theme-toggle {
      flex-shrink: 0;
      background: transparent;
      border: 1px solid #374151;
      border-radius: 6px;
      padding: 0.3rem 0.5rem;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }
    .theme-toggle:hover {
      background: #1f2937;
    }
  `,
})
export class AppComponent {
  auth = inject(AuthService);
  i18n = inject(I18nService);
  theme = inject(ThemeService);
  protected readonly langs = ['fr', 'en', 'es', 'de', 'zh'] as const;

  // Narrow screens: icon buttons and language codes so the header fits on one line
  private readonly mq = window.matchMedia('(max-width: 640px)');
  protected readonly narrow = signal(this.mq.matches);

  constructor() {
    const onChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    this.mq.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.mq.removeEventListener('change', onChange));
  }

  logout() {
    void this.auth.logout();
  }
}
