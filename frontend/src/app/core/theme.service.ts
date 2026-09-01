import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { PreferencesService } from '../preferences/preferences.service';

export type Theme = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly LS_KEY = 'theme';
  private readonly _theme = signal<Theme>(this.detect());
  private readonly prefs = inject(PreferencesService);
  private mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  readonly theme = this._theme.asReadonly();
  readonly resolved = computed<'light' | 'dark'>(() => {
    const t = this._theme();
    if (t !== 'system') return t;
    return this.mql?.matches ? 'dark' : 'light';
  });

  constructor() {
    effect(() => {
      const r = this.resolved();
      document.documentElement.classList.toggle('dark', r === 'dark');
      document.documentElement.dataset['theme'] = r;
    });

    // sync from DB - single source
    effect(() => {
      const p = this.prefs.resource.value();
      if (p?.theme && ['light', 'dark', 'system'].includes(p.theme)) {
        const th = p.theme as Theme;
        if (th !== this._theme()) {
          this._theme.set(th);
          localStorage.setItem(this.LS_KEY, th);
        }
      }
    });

    // listen for system changes in system mode
    if (this.mql) {
      this.mql.addEventListener('change', () => {
        if (this._theme() === 'system') {
          // trigger recompute
          this._theme.set('system');
        }
      });
    }
  }

  private detect(): Theme {
    const saved = localStorage.getItem(this.LS_KEY) as Theme | null;
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  }

  setTheme(t: Theme) {
    this._theme.set(t);
    localStorage.setItem(this.LS_KEY, t);
    this.prefs.update({ theme: t } as any).catch(() => {});
  }

  toggle() {
    const r = this.resolved();
    this.setTheme(r === 'dark' ? 'light' : 'dark');
  }
}
