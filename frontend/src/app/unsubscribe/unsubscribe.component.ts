import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiConfigService } from '../core/api-config.service';
import { I18nService } from '../core/i18n.service';

interface UnsubscribeInfo {
  scope: 'all' | 'artifact';
  active: boolean;
  ecosystem?: string;
  coordinates?: string;
}

/**
 * Target of the links in mails (no login: the signed token is enough). Asks for a
 * confirmation first, since mail scanners follow links on their own.
 */
@Component({
  selector: 'app-unsubscribe',
  imports: [RouterLink],
  template: `
    <div class="container">
      <div class="card">
        <h1>{{ i18n.t()('unsubscribe.title') }}</h1>
        @switch (state()) {
          @case ('loading') {
            <p class="muted">…</p>
          }
          @case ('invalid') {
            <p>{{ i18n.t()('unsubscribe.invalid') }}</p>
          }
          @case ('error') {
            <p style="color:#dc2626">{{ i18n.t()('unsubscribe.error') }}</p>
          }
          @default {
            @if (info(); as i) {
              @if (i.active) {
                <p>
                  {{
                    i.scope === 'all'
                      ? i18n.t()('unsubscribe.all.question')
                      : i18n.t()('unsubscribe.artifact.question', { coords: i.coordinates ?? '' })
                  }}
                </p>
                <button class="btn danger" type="button" [disabled]="busy()" (click)="confirm()">
                  {{ i18n.t()(i.scope === 'all' ? 'unsubscribe.all.confirm' : 'unsubscribe.artifact.confirm') }}
                </button>
              } @else {
                <p>
                  {{
                    i18n.t()(
                      i.scope === 'all'
                        ? done()
                          ? 'unsubscribe.all.done'
                          : 'unsubscribe.all.already'
                        : done()
                          ? 'unsubscribe.artifact.done'
                          : 'unsubscribe.artifact.already',
                      { coords: doneCoords() }
                    )
                  }}
                </p>
                @if (i.scope === 'all') {
                  <p class="muted">{{ i18n.t()('unsubscribe.all.hint') }}</p>
                }
              }
            }
          }
        }
        <p class="links">
          <a routerLink="/preferences">{{ i18n.t()('unsubscribe.preferences') }}</a> ·
          <a routerLink="/">{{ i18n.t()('unsubscribe.dashboard') }}</a>
        </p>
      </div>
    </div>
  `,
  styles: `
    .links {
      margin-top: 1.5rem;
      font-size: 0.85rem;
    }
  `,
})
export class UnsubscribeComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ApiConfigService);
  private readonly route = inject(ActivatedRoute);

  protected readonly state = signal<'loading' | 'invalid' | 'error' | 'ready'>('loading');
  protected readonly info = signal<UnsubscribeInfo | null>(null);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly doneCoords = signal('');
  private token = '';

  constructor() {
    // the page is reused when only the token changes
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.token = params.get('token') ?? '';
      this.state.set('loading');
      this.info.set(null);
      this.done.set(false);
      void this.load();
    });
  }

  private async load() {
    if (!this.token) {
      this.state.set('invalid');
      return;
    }
    try {
      const res = await fetch(this.url());
      if (res.status === 404) return this.state.set('invalid');
      if (!res.ok) return this.state.set('error');
      this.info.set(await res.json());
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  async confirm() {
    this.busy.set(true);
    try {
      const res = await fetch(this.url(), { method: 'POST' });
      if (!res.ok) throw new Error(res.statusText);
      this.doneCoords.set(this.info()?.coordinates ?? '');
      this.info.set(await res.json());
      this.done.set(true);
    } catch {
      this.state.set('error');
    } finally {
      this.busy.set(false);
    }
  }

  private url(): string {
    return this.api.apiUrl(`/api/unsubscribe?token=${encodeURIComponent(this.token)}`);
  }
}
