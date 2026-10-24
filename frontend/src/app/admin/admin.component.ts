import { Component, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { ApiConfigService } from '../core/api-config.service';
import { I18nService } from '../core/i18n.service';
import { EcoIconComponent } from '../shared/eco-icon.component';
import { valueOrUndefined } from '../shared/resource-value';

type Counts = Record<string, number>;

export interface AdminStats {
  users: {
    total: number;
    new7d: number;
    new30d: number;
    byProvider: Counts;
    byChannel: Counts;
    byMode: Counts;
    telegramLinked: number;
    withPrereleases: number;
  };
  artifacts: {
    follows: number;
    distinct: number;
    byEcosystem: Counts;
    top: { ecosystem: string; coordinates: string; followers: number }[];
    knownVersions: number;
  };
  notifications: {
    deliveriesByChannel: Record<string, Counts>;
    sent24h: number;
    sent7d: number;
    failed7d: number;
    events7d: number;
  };
  listeners: Record<string, { lastSync: string | null }>;
  system: { version: string; uptimeSeconds: number; databaseBytes: number | null };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  providers: string[];
  follows: number;
  channel: string | null;
  mode: string | null;
  telegramLinked: boolean;
  includePrereleases: boolean;
  lastNotifiedAt: string | null;
  isAdmin: boolean;
}

type SortKey = 'createdAt' | 'follows' | 'lastNotifiedAt';

@Component({
  selector: 'app-admin',
  imports: [EcoIconComponent],
  template: `
    <h1>🛡️ {{ i18n.t()('admin.title') }}</h1>

    @if (stats.error() || users.error()) {
      <div class="card error">{{ i18n.t()('admin.error') }}</div>
    }

    @if (s(); as s) {
      <div class="tiles">
        <div class="card tile">
          <span class="label">{{ i18n.t()('admin.users') }}</span>
          <span class="value">{{ s.users.total }}</span>
          <span class="muted">{{ i18n.t()('admin.newUsers', { w: '' + s.users.new7d, m: '' + s.users.new30d }) }}</span>
        </div>
        <div class="card tile">
          <span class="label">{{ i18n.t()('admin.follows') }}</span>
          <span class="value">{{ s.artifacts.follows }}</span>
          <span class="muted">{{ i18n.t()('admin.distinct', { n: '' + s.artifacts.distinct }) }}</span>
        </div>
        <div class="card tile">
          <span class="label">{{ i18n.t()('admin.sent') }}</span>
          <span class="value">{{ s.notifications.sent7d }}</span>
          <span class="muted">{{
            i18n.t()('admin.sentDetail', { d: '' + s.notifications.sent24h, e: '' + s.notifications.events7d })
          }}</span>
        </div>
        <div class="card tile" [class.alert]="s.notifications.failed7d > 0">
          <span class="label">{{ i18n.t()('admin.failed') }}</span>
          <span class="value">{{ s.notifications.failed7d }}</span>
          <span class="muted">{{ i18n.t()('admin.last7d') }}</span>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h3>{{ i18n.t()('admin.breakdown') }}</h3>
          <dl>
            <dt>{{ i18n.t()('admin.providers') }}</dt>
            <dd>{{ fmtCounts(s.users.byProvider) }}</dd>
            <dt>{{ i18n.t()('admin.channels') }}</dt>
            <dd>{{ fmtCounts(s.users.byChannel) }}</dd>
            <dt>{{ i18n.t()('admin.modes') }}</dt>
            <dd>{{ fmtCounts(s.users.byMode) }}</dd>
            <dt>Telegram</dt>
            <dd>{{ s.users.telegramLinked }}</dd>
            <dt>{{ i18n.t()('admin.prereleases') }}</dt>
            <dd>{{ s.users.withPrereleases }}</dd>
            <dt>{{ i18n.t()('admin.ecosystems') }}</dt>
            <dd>{{ fmtCounts(s.artifacts.byEcosystem) }}</dd>
          </dl>
        </div>

        <div class="card">
          <h3>{{ i18n.t()('admin.deliveries') }}</h3>
          <dl>
            @for (ch of channels(s); track ch) {
              <dt>{{ ch }}</dt>
              <dd>{{ fmtCounts(s.notifications.deliveriesByChannel[ch]) }}</dd>
            }
          </dl>
          <h3>{{ i18n.t()('admin.system') }}</h3>
          <dl>
            <dt>Version</dt>
            <dd>
              <code>{{ s.system.version.slice(0, 7) }}</code>
            </dd>
            <dt>Uptime</dt>
            <dd>{{ fmtDuration(s.system.uptimeSeconds) }}</dd>
            <dt>{{ i18n.t()('admin.database') }}</dt>
            <dd>
              {{ s.system.databaseBytes === null ? '—' : fmtNumber(s.system.databaseBytes / 1024) + ' KiB' }}
            </dd>
            <dt>{{ i18n.t()('admin.knownVersions') }}</dt>
            <dd>{{ fmtNumber(s.artifacts.knownVersions) }}</dd>
            @for (eco of listenerKeys(s); track eco) {
              <dt>Sync {{ eco }}</dt>
              <dd>{{ s.listeners[eco].lastSync ? fmtDate(s.listeners[eco].lastSync) : '—' }}</dd>
            }
          </dl>
        </div>

        <div class="card">
          <h3>{{ i18n.t()('admin.top') }}</h3>
          @if (s.artifacts.top.length === 0) {
            <p class="muted">—</p>
          }
          <ol class="top">
            @for (a of s.artifacts.top; track a.ecosystem + a.coordinates) {
              <li>
                <eco-icon [ecosystem]="$any(a.ecosystem)" />
                <span class="coords">{{ a.coordinates }}</span>
                <span class="muted">{{ a.followers }}</span>
              </li>
            }
          </ol>
        </div>
      </div>
    }

    <div class="card">
      <div class="users-head">
        <h3>{{ i18n.t()('admin.users') }} ({{ filtered().length }})</h3>
        <input
          type="search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          [placeholder]="i18n.t()('admin.search')"
          [attr.aria-label]="i18n.t()('admin.search')"
        />
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ i18n.t()('admin.col.user') }}</th>
              <th>{{ i18n.t()('admin.providers') }}</th>
              <th>
                <button type="button" class="sort" (click)="sortBy('follows')">
                  {{ i18n.t()('admin.col.follows') }} {{ arrow('follows') }}
                </button>
              </th>
              <th>{{ i18n.t()('admin.col.notifications') }}</th>
              <th>
                <button type="button" class="sort" (click)="sortBy('lastNotifiedAt')">
                  {{ i18n.t()('admin.col.lastNotified') }} {{ arrow('lastNotifiedAt') }}
                </button>
              </th>
              <th>
                <button type="button" class="sort" (click)="sortBy('createdAt')">
                  {{ i18n.t()('admin.col.created') }} {{ arrow('createdAt') }}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (u of filtered(); track u.id) {
              <tr>
                <td>
                  <div>
                    {{ u.name || '—' }}
                    @if (u.isAdmin) {
                      <span class="badge">admin</span>
                    }
                  </div>
                  <div class="muted small">{{ u.email }}</div>
                  <div class="muted small">
                    <code>{{ u.id }}</code>
                  </div>
                </td>
                <td>{{ u.providers.join(', ') }}</td>
                <td class="num">{{ u.follows }}</td>
                <td>
                  {{ u.channel ?? '—' }} · {{ u.mode ?? '—' }}
                  @if (u.telegramLinked) {
                    <span title="Telegram">📲</span>
                  }
                  @if (u.includePrereleases) {
                    <span [title]="i18n.t()('admin.prereleases')">🧪</span>
                  }
                </td>
                <td>{{ u.lastNotifiedAt ? fmtDate(u.lastNotifiedAt) : '—' }}</td>
                <td>{{ fmtDate(u.createdAt, false) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0;
    }
    .tile .label {
      font-size: 0.8rem;
      color: var(--muted);
    }
    .tile .value {
      font-size: 1.8rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .tile.alert .value {
      color: #dc2626;
    }
    .muted {
      color: var(--muted);
      font-size: 0.8rem;
    }
    .small {
      font-size: 0.75rem;
    }
    .error {
      color: #dc2626;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .grid .card {
      margin: 0;
    }
    h3 {
      margin: 0 0 0.5rem;
      font-size: 1rem;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.3rem 0.75rem;
      margin: 0 0 1rem;
      font-size: 0.9rem;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .top {
      margin: 0;
      padding-left: 1.2rem;
    }
    .top li {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.15rem 0;
    }
    .coords {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .users-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .users-head input {
      flex: 0 1 260px;
      min-width: 0;
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text);
    }
    .table-wrap {
      overflow-x: auto;
      margin-top: 0.5rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.45rem 0.5rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      white-space: nowrap;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .sort {
      background: none;
      border: none;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .badge {
      font-size: 0.65rem;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      background: #2563eb;
      color: #fff;
      margin-left: 0.25rem;
    }
  `,
})
export class AdminComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ApiConfigService);

  readonly stats = httpResource<AdminStats>(() => ({ url: this.api.apiUrl('/api/admin/stats') }));
  readonly users = httpResource<AdminUser[]>(() => ({ url: this.api.apiUrl('/api/admin/users') }));

  protected readonly s = computed(() => valueOrUndefined(this.stats));
  protected readonly query = signal('');
  protected readonly sort = signal<{ key: SortKey; desc: boolean }>({ key: 'createdAt', desc: true });

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const { key, desc } = this.sort();
    const list = (valueOrUndefined(this.users) ?? []).filter(
      (u) => !q || [u.email, u.name ?? '', u.id, ...u.providers].some((v) => v.toLowerCase().includes(q)),
    );
    const val = (u: AdminUser) => (key === 'follows' ? u.follows : u[key] ? Date.parse(u[key]!) : 0);
    return [...list].sort((a, b) => (desc ? val(b) - val(a) : val(a) - val(b)));
  });

  sortBy(key: SortKey) {
    this.sort.update((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  }

  arrow(key: SortKey): string {
    const s = this.sort();
    return s.key !== key ? '' : s.desc ? '▼' : '▲';
  }

  fmtCounts(counts: Counts | undefined): string {
    const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(' · ') : '—';
  }

  /** Dates and numbers in the UI language (Angular pipes would need every locale registered). */
  fmtDate(iso: string, withTime = true): string {
    return new Date(iso).toLocaleString(this.i18n.lang(), {
      dateStyle: 'short',
      ...(withTime ? { timeStyle: 'short' as const } : {}),
    });
  }

  fmtNumber(n: number): string {
    return Math.round(n).toLocaleString(this.i18n.lang());
  }

  fmtDuration(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const day = this.i18n.t()('admin.dayShort');
    return d ? `${d} ${day} ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  }

  channels(s: AdminStats): string[] {
    return Object.keys(s.notifications.deliveriesByChannel).sort((a, b) => a.localeCompare(b));
  }

  listenerKeys(s: AdminStats): string[] {
    return Object.keys(s.listeners).sort((a, b) => a.localeCompare(b));
  }
}
