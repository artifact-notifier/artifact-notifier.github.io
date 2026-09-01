import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { I18nService } from './core/i18n.service';
import { ThemeService } from './core/theme.service';
import { ToastComponent } from './core/toast.component';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, ToastComponent],
  template: `
    <nav class="app-nav">
      <a routerLink="/" class="brand">{{ i18n.t()('app.title') }}</a>
      <span class="spacer"></span>
      <button class="theme-toggle" (click)="theme.toggle()" [attr.aria-label]="theme.theme()" title="Theme">
        @if (theme.resolved() === 'dark') { ☀️ } @else { 🌙 }
      </button>
      <label class="lang-switch">
        <select [value]="i18n.lang()" (change)="i18n.setLang($any($event.target).value)">
          <option value="fr">{{ i18n.t()('lang.fr') }}</option>
          <option value="en">{{ i18n.t()('lang.en') }}</option>
          <option value="es">{{ i18n.t()('lang.es') }}</option>
          <option value="de">{{ i18n.t()('lang.de') }}</option>
          <option value="zh">{{ i18n.t()('lang.zh') }}</option>
        </select>
      </label>
      @if (auth.user(); as u) {
        <a routerLink="/preferences" class="btn secondary small">{{ i18n.t()('nav.preferences') }}</a>
        <span class="user">{{ u.name || u.email }}</span>
        <button class="btn secondary small" (click)="logout()">{{ i18n.t()('nav.logout') }}</button>
      }
    </nav>
    <div class="container">
      <router-outlet />
    </div>
    <app-toast />
  `,
  styles: `
    .brand{font-weight:700;font-size:1.1rem}
    .user{opacity:.9}
    .small{padding:.35rem .7rem;font-size:.85rem}
    .lang-switch select{padding:.3rem;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#fff}
    .theme-toggle{background:transparent;border:1px solid #374151;border-radius:6px;padding:.3rem .5rem;font-size:1rem;line-height:1;cursor:pointer}
    .theme-toggle:hover{background:#1f2937}
  `,
})
export class AppComponent {
  auth = inject(AuthService);
  i18n = inject(I18nService);
  theme = inject(ThemeService);

  logout() { this.auth.logout(); }
}
