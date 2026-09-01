import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { httpResource } from '@angular/common/http';
import { ArtifactsService, FollowedArtifact, SearchResult, SyncStatus } from '../artifacts/artifacts.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { I18nService } from '../core/i18n.service';
import { EcoIconComponent } from '../shared/eco-icon.component';
import { EcosystemSelectComponent } from '../shared/ecosystem-select.component';
import { ApiConfigService } from '../core/api-config.service';

type Eco = 'NPM' | 'MAVEN' | 'PYPI' | 'TEST';
type FilterEco = 'ALL' | Eco;
type SortBy = 'name_asc' | 'name_desc' | 'type_asc' | 'type_desc';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, FormsModule, EcoIconComponent, EcosystemSelectComponent],
  template: `
    <h1>{{ i18n.t()('dashboard.title') }}</h1>
    @if (syncStatus(); as s) {
      <div class="card sync-card">
        <span class="muted" style="font-size:.8rem">{{ i18n.t()('dashboard.sync.lastSync') }} :</span>
        <span class="sync-items">
          <span [title]="'npm: ' + fmtAbsolute(s['NPM']?.lastSync)"><eco-icon ecosystem="NPM" /> {{ s['NPM']?.lastSync ? fmtSync(s['NPM'].lastSync) : (s['NPM']?.lastSeq ? '#'+s['NPM'].lastSeq : '—') }}</span>
          <span [title]="'Maven: ' + fmtAbsolute(s['MAVEN']?.lastSync)"><eco-icon ecosystem="MAVEN" /> {{ fmtSync(s['MAVEN']?.lastSync) }}</span>
          <span [title]="'PyPI: ' + fmtAbsolute(s['PYPI']?.lastSync)"><eco-icon ecosystem="PYPI" /> {{ fmtSync(s['PYPI']?.lastSync) }}</span>
        </span>
      </div>
    }

    <div class="card add-card">
      <h3>{{ i18n.t()('dashboard.add') }}</h3>
      <div class="add-row">
        <ecosystem-select [value]="ecosystem()" [options]="availableEcos()" (valueChange)="ecosystem.set($event)" />
        <div class="search-wrap">
          <input
            class="search-input"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
            (keydown)="onKeydown($event)"
            (focus)="open.set(true)"
            (blur)="onBlur()"
            [placeholder]="i18n.t()('dashboard.search.placeholder')"
            autocomplete="off"
            role="combobox"
            [attr.aria-expanded]="open() && results().length > 0"
            aria-autocomplete="list"
          />
          @if (isSearching()) {
            <span class="spinner" [attr.aria-label]="i18n.t()('dashboard.search.loading')"></span>
          }
          @if (open() && (results().length > 0 || (!isSearching() && debouncedQuery().trim().length >= 2))) {
            <ul class="suggest" role="listbox">
              @for (r of results(); track r.coordinates; let i = $index) {
                <li
                  role="option"
                  [attr.aria-selected]="i === activeIndex()"
                  [class.active]="i === activeIndex()"
                  [class.exact]="r.coordinates.toLowerCase() === query().trim().toLowerCase()"
                  (mousedown)="follow(r.coordinates)"
                  (mouseenter)="activeIndex.set(i)"
                >
                  <eco-icon [ecosystem]="ecosystem()" />
                  <span class="coords">{{ r.coordinates }}</span>
                  @if (r.description) { <span class="muted"> — {{ r.description }}</span> }
                  @if (r.coordinates.toLowerCase() === query().trim().toLowerCase()) { <span class="badge">exact</span> }
                </li>
              }
              @if (results().length === 0) {
                <li class="muted empty">{{ i18n.t()('dashboard.search.noResult') }}</li>
              } @else {
                <li class="suggest-hint muted">{{ i18n.t()('dashboard.search.hint') }}</li>
              }
            </ul>
          }
        </div>
      </div>
    </div>

    <!-- 🧪 Dev test mode: isolated, does not affect npm/maven/pypi — managed via NODE_ENV on the backend -->
    @if (isTestEnabled()) {
      <div class="card test-card">
        <h3>🧪 {{ i18n.t()('test.title') }}</h3>
        <p class="muted">{{ i18n.t()('test.subtitle') }}</p>
        <div class="row" style="gap:.5rem;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:180px">
            <label class="muted" style="font-size:.75rem">{{ i18n.t()('test.coords') }}</label>
            <input [ngModel]="testCoords()" (ngModelChange)="testCoords.set($event)" placeholder="my-test/pkg" style="width:100%" />
          </div>
          <div style="width:130px">
            <label class="muted" style="font-size:.75rem">{{ i18n.t()('test.version') }}</label>
            <input [ngModel]="testVersion()" (ngModelChange)="testVersion.set($event)" placeholder="1.1.0" style="width:100%" />
          </div>
          <button class="btn" (click)="simulateTest()">{{ i18n.t()('test.simulate') }}</button>
        </div>
        <p class="muted" style="font-size:.72rem;margin:.5rem 0 0">{{ i18n.t()('test.hint') }}</p>
      </div>
    }

    <!-- filters / sort toolbar -->
    <div class="card dense-card">
      <div class="toolbar">
        <div class="chip-row">
          <button class="chip" [class.active]="filterEco() === 'ALL'" (click)="filterEco.set('ALL')">{{ i18n.t()('dashboard.filter.all') }} ({{ artifacts().length }})</button>
          @for (eco of availableEcos(); track eco) {
            <button class="chip" [class.active]="filterEco() === eco" (click)="filterEco.set(eco)"><eco-icon [ecosystem]="eco" /> {{ eco === 'TEST' ? 'TEST' : eco === 'NPM' ? 'npm' : eco === 'MAVEN' ? 'Maven' : 'PyPI' }} ({{ countByEco(eco) }})</button>
          }
        </div>
        <div class="toolbar-right">
          <input class="filter-input" [ngModel]="filterText()" (ngModelChange)="filterText.set($event)" [placeholder]="i18n.t()('dashboard.filter.placeholder')" />
        </div>
      </div>

      <div class="muted" style="font-size:.8rem;margin:.5rem 0">{{ i18n.t()('dashboard.count', {n: '' + filteredSorted().length}) }}</div>

      @if (filteredSorted().length === 0) {
        <p class="muted">{{ artifacts().length === 0 ? i18n.t()('dashboard.empty') : i18n.t()('dashboard.search.noResult') }}</p>
      } @else {
        <div class="dense-list" role="table" aria-label="artifacts">
          <div class="dense-header" role="row">
            <span class="sortable" style="width:32px" (click)="toggleTypeSort()" [attr.aria-sort]="sortBy()==='type_asc' ? 'ascending' : sortBy()==='type_desc' ? 'descending' : 'none'" title="{{ i18n.t()('dashboard.sort.type') }}">{{ sortIcon('type') }}</span>
            <span class="sortable" style="flex:1" (click)="toggleNameSort()" [attr.aria-sort]="sortBy()==='name_asc' ? 'ascending' : sortBy()==='name_desc' ? 'descending' : 'none'">{{ i18n.t()('dashboard.col.artifact') }} <span class="sort-icon">{{ sortIcon('name') }}</span></span>
            <span style="width:110px;text-align:right">{{ i18n.t()('dashboard.col.actions') }}</span>
          </div>
          @for (a of filteredSorted(); track a.id) {
            <div class="dense-row" role="row">
              <eco-icon [ecosystem]="a.ecosystem" />
              <span class="coords-cell" [title]="a.coordinates">{{ a.coordinates }}</span>
              @if (a.events.length) {
                <button class="link" (click)="toggle(a.id)" style="margin-left:auto">{{ expanded().has(a.id) ? '−' : '+' }} {{ a.events.length }} {{ i18n.t()('dashboard.events.toggle') }}</button>
              } @else {
                <span class="muted" style="margin-left:auto;font-size:.8rem">{{ i18n.t()('dashboard.events.none') }}</span>
              }
              <span style="width:110px;text-align:right;display:flex;gap:.3rem;justify-content:flex-end;align-items:center">
                @if (a.ecosystem === 'TEST') {
                  <input [ngModel]="testBump()[a.id] || ''" (ngModelChange)="setBump(a.id, $event)" placeholder="1.2.0" style="width:72px;padding:.2rem .35rem;font-size:.75rem;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text)" />
                  <button class="btn small" (click)="bumpTest(a)">{{ i18n.t()('test.bump') }}</button>
                }
                <button class="btn danger small" (click)="requestUnfollow(a)">{{ i18n.t()('dashboard.unfollow') }}</button>
              </span>
            </div>
            @if (expanded().has(a.id) && a.events.length) {
              <div class="events-detail">
                @for (e of a.events; track e.version) {
                  <div class="event-row">
                    <span class="event-pill">v{{ e.version }} <span class="muted">release {{ fmtSync(e.publishedAt) }}</span></span>
                    <span class="delivery-list">
                      @for (d of e.deliveries; track d.channel) {
                        <span class="delivery-pill" [class.sent]="d.status==='SENT'" [class.pending]="d.status==='PENDING'" [title]="d.channel">
                          {{ d.channel==='telegram' ? '✈️' : '✉️' }} {{ d.channel }} {{ d.sentAt ? fmtSync(d.sentAt) : d.status }}
                        </span>
                      }
                      @if (!e.deliveries.length) { <span class="muted" style="font-size:.75rem">— {{ i18n.t()('dashboard.events.noDelivery') }}</span> }
                    </span>
                  </div>
                }
              </div>
            }
          }
        </div>
      }
    </div>

    @if (pending(); as p) {
      <div class="overlay" (click)="cancelUnfollow()" (keydown.escape)="cancelUnfollow()" tabindex="-1">
        <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t()('dashboard.unfollow.confirm.title')" (click)="$event.stopPropagation()">
          <h3>{{ i18n.t()('dashboard.unfollow.confirm.title') }}</h3>
          <p>{{ i18n.t()('dashboard.unfollow.confirm.message', {coords: p.coordinates}) }}</p>
          <div class="row" style="justify-content:flex-end">
            <button class="btn secondary" (click)="cancelUnfollow()">{{ i18n.t()('dashboard.unfollow.confirm.cancel') }}</button>
            <button class="btn danger" (click)="confirmUnfollow()">{{ i18n.t()('dashboard.unfollow.confirm.confirm') }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .add-card{padding:1rem 1.25rem}
    .add-card h3{margin:0 0 .75rem;font-size:1rem;font-weight:600}
    .add-row{display:flex;gap:.6rem;align-items:stretch}
    .search-wrap{position:relative;flex:1;min-width:220px;display:flex;align-items:center}
    .search-input{width:100%;height:38px;padding:0 2rem 0 .75rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:.9rem;box-sizing:border-box}
    .search-input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
    .spinner{position:absolute;right:.6rem;width:16px;height:16px;border:2px solid var(--border);border-top-color:#2563eb;border-radius:50%;animation:spin .6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .suggest{position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.12);max-height:260px;overflow:auto;list-style:none;margin:0;padding:4px;z-index:10}
    .suggest li{padding:.5rem .65rem;cursor:pointer;display:flex;gap:.5rem;align-items:center;border-radius:6px}
    .suggest li.active{background:var(--hover-strong)}
    .suggest li.exact{font-weight:600}
    .suggest-hint{font-size:.72rem;padding:.35rem .65rem .2rem;border-top:1px solid var(--border);margin-top:4px;cursor:default}
    .suggest-hint:hover{background:transparent}
    .badge{font-size:.65rem;background:#16a34a;color:#fff;padding:.1rem .35rem;border-radius:999px;margin-left:auto}
    .coords{font-family:monospace}
    .empty{cursor:default}
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:100}
    .modal{background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:1.25rem;min-width:320px;max-width:480px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
    .modal h3{margin:0 0 .5rem}
    .modal p{margin:0 0 1rem;color:var(--muted)}
    .dense-card{padding:.75rem}
    .toolbar{display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap;align-items:center}
    .chip-row{display:flex;gap:.35rem;flex-wrap:wrap}
    .chip{display:inline-flex;align-items:center;gap:.3rem;padding:.28rem .6rem;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text);font-size:.8rem;cursor:pointer}
    .chip.active{background:#111827;color:#fff;border-color:#111827}
    :host-context(html.dark) .chip.active{background:#e2e8f0;color:#0f172a;border-color:#e2e8f0}
    .chip.active eco-icon{filter:brightness(0) invert(1)}
    :host-context(html.dark) .chip.active eco-icon{filter:none}
    .toolbar-right{display:flex;align-items:center;gap:.4rem}
    .filter-input{padding:.32rem .5rem;border:1px solid var(--border);border-radius:6px;min-width:160px;font-size:.85rem;background:var(--input-bg);color:var(--text)}
    .dense-list{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-top:.5rem}
    .dense-header{display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;background:var(--hover);font-weight:600;border-bottom:1px solid var(--border);user-select:none}
    .sortable{cursor:pointer;display:inline-flex;align-items:center;gap:.25rem}
    .sortable:hover{color:var(--text);text-decoration:underline}
    .sort-icon{font-size:.7rem;color:var(--muted)}
    .dense-row{display:flex;align-items:center;gap:.5rem;padding:.38rem .6rem;border-bottom:1px solid var(--border);font-size:.88rem}
    .dense-row:hover{background:var(--hover)}
    .dense-row:last-child{border-bottom:none}
    .coords-cell{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace}
    .mono{font-family:monospace}
    .link{background:none;border:none;color:#2563eb;font-size:.75rem;cursor:pointer;padding:0 .2rem}
    .events-detail{display:flex;flex-direction:column;gap:.4rem;padding:.5rem .6rem .6rem 3rem;background:var(--hover);border-bottom:1px solid var(--border)}
    .event-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
    .event-pill{font-size:.75rem;background:var(--hover-strong);padding:.15rem .4rem;border-radius:999px}
    .delivery-list{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
    .delivery-pill{font-size:.7rem;padding:.12rem .4rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card)}
    .delivery-pill.sent{border-color:#16a34a}
    .delivery-pill.pending{border-color:#eab308}
    .small{padding:.28rem .55rem;font-size:.78rem}
    .test-card{border:1.5px dashed #f59e0b;background:color-mix(in srgb, var(--bg-card) 92%, #f59e0b 8%)}
    :host-context(html.dark) .test-card{border-color:#fbbf24}
    .sync-card{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;padding:.6rem .9rem;font-size:.85rem}
    .sync-items{display:flex;gap:1rem;flex-wrap:wrap}
    .sync-items span{display:inline-flex;align-items:center;gap:.3rem}
  `,
})
export class DashboardComponent {
  private readonly artifactsSvc = inject(ArtifactsService);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiConfigService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  protected readonly ecosystem = signal<Eco>('NPM');
  // test mode (dev only, isolated) — shown only if the backend exposes it via NODE_ENV
  protected readonly testCoords = signal('');
  protected readonly testVersion = signal('1.1.0');
  protected readonly testBump = signal<Record<string, string>>({});

  protected readonly ecosystemsRes = httpResource<Eco[]>(() =>
    this.auth.user() ? { url: this.api.apiUrl('/api/artifacts/ecosystems') } : undefined,
  );
  protected readonly availableEcos = computed(() => (this.ecosystemsRes.value() as Eco[] | undefined) ?? (['NPM', 'MAVEN', 'PYPI'] as Eco[]));
  protected readonly isTestEnabled = computed(() => this.availableEcos().includes('TEST'));
  protected readonly query = signal('');
  protected readonly debouncedQuery = signal('');
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(0);
  protected readonly pending = signal<FollowedArtifact | null>(null);

  protected readonly filterEco = signal<FilterEco>('ALL');
  protected readonly filterText = signal('');
  protected readonly sortBy = signal<SortBy>('name_asc');
  protected readonly expanded = signal<Set<string>>(new Set());
  // Reactive clock: forces recalculation of "X min ago" without interaction
  protected readonly now = signal(Date.now());

  protected readonly artifactsRes = httpResource<FollowedArtifact[]>(() =>
    this.auth.user() ? { url: this.api.apiUrl('/api/artifacts') } : undefined,
  );
  protected readonly syncStatusRes = httpResource<SyncStatus>(() =>
    this.auth.user() ? { url: this.api.apiUrl('/api/artifacts/sync-status') } : undefined,
  );
  protected readonly syncStatus = computed(() => this.syncStatusRes.value() ?? null);

  protected readonly searchRes = httpResource<SearchResult[]>(() => {
    const q = this.debouncedQuery().trim();
    if (q.length < 2) return undefined;
    const params = new URLSearchParams({ ecosystem: this.ecosystem(), q });
    return { url: this.api.apiUrl(`/api/artifacts/search?${params}`) };
  });
  protected readonly isSearching = computed(() => this.query().trim() !== this.debouncedQuery().trim() || this.searchRes.isLoading());

  protected readonly artifacts = computed<FollowedArtifact[]>(() => this.artifactsRes.value() ?? []);
  protected readonly results = computed<SearchResult[]>(() => this.searchRes.value() ?? []);

  protected readonly filteredSorted = computed(() => {
    let list = this.artifacts();
    const fe = this.filterEco();
    if (fe !== 'ALL') list = list.filter(a => a.ecosystem === fe);
    const txt = this.filterText().trim().toLowerCase();
    if (txt) list = list.filter(a => a.coordinates.toLowerCase().includes(txt));
    const sort = this.sortBy();
    const copy = [...list];
    copy.sort((a, b) => {
      if (sort === 'name_asc') return a.coordinates.localeCompare(b.coordinates);
      if (sort === 'name_desc') return b.coordinates.localeCompare(a.coordinates);
      if (sort === 'type_asc') return a.ecosystem.localeCompare(b.ecosystem) || a.coordinates.localeCompare(b.coordinates);
      if (sort === 'type_desc') return b.ecosystem.localeCompare(a.ecosystem) || a.coordinates.localeCompare(b.coordinates);
      return 0;
    });
    return copy;
  });

  fmtSync(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const diffMs = this.now() - d.getTime();
    const locale = this.locale();
    // Recent -> relative time ("2 minutes ago"), otherwise absolute date
    if (diffMs >= 0) {
      const s = Math.floor(diffMs / 1000);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      if (s < 60) return rtf.format(-s, 'second');
      const m = Math.floor(s / 60);
      if (m < 60) return rtf.format(-m, 'minute');
      const h = Math.floor(m / 60);
      if (h < 24) return rtf.format(-h, 'hour');
    }
    return this.fmtAbsolute(iso);
  }

  fmtAbsolute(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const locale = this.locale();
    // e.g. 02/09/2026 22:15:00 — consistent per-locale format with 2 digits
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d);
  }

  private locale(): string {
    const lang = this.i18n.lang();
    const localeMap: Record<string, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', zh: 'zh-CN' };
    return localeMap[lang] ?? 'en-US';
  }

  countByEco(eco: FilterEco) {
    if (eco === 'ALL') return this.artifacts().length;
    return this.artifacts().filter(a => a.ecosystem === eco).length;
  }

  sortIcon(col: 'name' | 'type') {
    const s = this.sortBy();
    if (col === 'name') return s === 'name_asc' ? '▲' : s === 'name_desc' ? '▼' : '↕';
    if (col === 'type') return s === 'type_asc' ? '▲' : s === 'type_desc' ? '▼' : '↕';
    return '↕';
  }

  toggleNameSort() {
    this.sortBy.update(v => v === 'name_asc' ? 'name_desc' : 'name_asc');
  }

  toggleTypeSort() {
    this.sortBy.update(v => v === 'type_asc' ? 'type_desc' : 'type_asc');
  }



  toggle(id: string) {
    const s = new Set(this.expanded());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.expanded.set(s);
  }

  constructor() {
    effect((onCleanup) => {
      // Local tick every second (smooth, zero network calls) for
      // relative times "X s/min ago". API refreshes are spaced out.
      const tick = setInterval(() => this.now.set(Date.now()), 1_000);
      // Periodic API refresh: sync status every 30s, artifact
      // list every 60s. Paused when the tab is hidden.
      let apiCount = 0;
      const poll = setInterval(() => {
        if (document.hidden || !this.auth.user()) return;
        apiCount += 1;
        this.syncStatusRes.reload();
        if (apiCount % 2 === 0) this.artifactsRes.reload();
      }, 30_000);
      onCleanup(() => { clearInterval(tick); clearInterval(poll); });
    });
    effect((onCleanup) => {
      const q = this.query();
      const t = setTimeout(() => this.debouncedQuery.set(q), 350);
      onCleanup(() => clearTimeout(t));
    });
    effect(() => {
      const list = this.results();
      const q = this.debouncedQuery().trim().toLowerCase();
      const exact = list.findIndex(r => r.coordinates.toLowerCase() === q);
      this.activeIndex.set(exact >= 0 ? exact : 0);
    });
    effect(() => {
      const avail = this.availableEcos();
      const cur = this.ecosystem();
      if (!avail.includes(cur)) this.ecosystem.set(avail[0] as Eco);
    });
  }

  onQuery(v: string) {
    this.query.set(v);
    this.open.set(true);
  }

  onBlur() {
    setTimeout(() => this.open.set(false), 150);
  }

  onKeydown(e: KeyboardEvent) {
    const list = this.results();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!list.length) return;
      this.open.set(true);
      this.activeIndex.update(i => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIndex.update(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const q = this.query().trim();
      if (!q) return;
      if (this.open() && list.length) {
        e.preventDefault();
        const pick = list[this.activeIndex()] ?? list[0];
        this.follow(pick.coordinates);
      } else if (list.some(r => r.coordinates.toLowerCase() === q.toLowerCase())) {
        e.preventDefault();
        this.follow(q);
      } else if (q.length >= 2) {
        const exact = list.find(r => r.coordinates.toLowerCase() === q.toLowerCase());
        if (exact) { e.preventDefault(); this.follow(exact.coordinates); }
      }
    } else if (e.key === 'Escape') {
      this.open.set(false);
    }
  }

  async follow(coordinates: string) {
    try {
      await this.artifactsSvc.follow(this.ecosystem(), coordinates);
      this.toast.show(this.i18n.t()('dashboard.follow.success', { coords: coordinates }), 'success');
      this.query.set('');
      this.open.set(false);
      this.artifactsRes.reload();
    } catch (e: any) {
      this.toast.show(e?.error?.message || this.i18n.t()('dashboard.follow.error'), 'error');
    }
  }

  requestUnfollow(a: FollowedArtifact) {
    this.pending.set(a);
  }

  cancelUnfollow() {
    this.pending.set(null);
  }

  async confirmUnfollow() {
    const a = this.pending();
    if (!a) return;
    this.pending.set(null);
    try {
      await this.artifactsSvc.unfollow(a.id);
      this.artifactsRes.reload();
      this.toast.show(this.i18n.t()('dashboard.unfollow.success', { coords: a.coordinates }), 'success');
    } catch (e: any) {
      this.toast.show(e?.error?.message || this.i18n.t()('dashboard.unfollow.error'), 'error');
    }
  }

  setBump(id: string, v: string) {
    this.testBump.update(m => ({ ...m, [id]: v }));
  }

  async simulateTest() {
    const coords = this.testCoords().trim();
    const version = this.testVersion().trim();
    if (!coords || !version) { this.toast.show('coords + version requis', 'error'); return; }
    try {
      await this.artifactsSvc.simulateTestVersion(coords, version);
      this.toast.show(this.i18n.t()('test.simulated', {coords, version}), 'success');
      this.artifactsRes.reload();
    } catch (e: any) {
      const msg = e?.error?.message || e?.message || 'Erreur test';
      this.toast.show(msg, 'error');
    }
  }

  async bumpTest(a: FollowedArtifact) {
    const v = (this.testBump()[a.id] || '').trim() || this.testVersion().trim();
    if (!v) { this.toast.show('version requise', 'error'); return; }
    try {
      await this.artifactsSvc.bumpTestVersion(a.id, v);
      this.toast.show(this.i18n.t()('test.simulated', {coords: a.coordinates, version: v}), 'success');
      this.testBump.update(m => { const c = {...m}; delete c[a.id]; return c; });
      this.artifactsRes.reload();
    } catch (e: any) {
      this.toast.show(e?.error?.message || e?.message || 'Erreur', 'error');
    }
  }
}
