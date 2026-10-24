import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { I18nService } from '../core/i18n.service';
import { ToastService } from '../core/toast.service';
import { EcoIconComponent } from '../shared/eco-icon.component';
import { scopeRank } from '../shared/scopes';
import { OrphansDialogComponent } from './orphans-dialog.component';
import { Orphan, ProjectDependency, ProjectSource, ProjectsService } from './projects.service';

type SortKey = 'name' | 'scope' | 'outdated';

const outdatedRank = (d: ProjectDependency) => (d.outdated ? 0 : d.followedArtifactId ? 1 : 2);

@Component({
  selector: 'app-project',
  imports: [RouterLink, EcoIconComponent, OrphansDialogComponent],
  template: `
    <p>
      <a routerLink="/">← {{ i18n.t()('project.back') }}</a>
    </p>
    @if (project(); as p) {
      <div class="head">
        @if (editing()) {
          <form class="rename" (submit)="$event.preventDefault(); rename()">
            <input
              [value]="draftName()"
              (input)="draftName.set($any($event.target).value)"
              [attr.aria-label]="i18n.t()('project.name')"
              maxlength="100"
            />
            <button class="btn small" type="submit">{{ i18n.t()('project.save') }}</button>
            <button class="btn secondary small" type="button" (click)="editing.set(false)">
              {{ i18n.t()('project.cancel') }}
            </button>
          </form>
        } @else {
          <h1>📁 {{ p.name }}</h1>
          <button class="btn secondary small" type="button" (click)="startRename(p.name)">
            {{ i18n.t()('project.rename') }}
          </button>
        }
      </div>
      <p class="muted">
        {{ i18n.t()('project.summary', { s: '' + p.sources.length, f: '' + followedCount() }) }} ·
        @if (outdatedCount()) {
          <span class="outdated-count">{{ i18n.t()('project.outdated', { n: '' + outdatedCount() }) }}</span> ·
        }
        {{ i18n.t()('project.created', { d: fmtDate(p.createdAt) }) }}
      </p>
      <label class="option">
        <input type="checkbox" [checked]="p.notifyNewerOnly" (change)="setNewerOnly($any($event.target).checked)" />
        <span>
          {{ i18n.t()('project.newerOnly') }}
          <span class="muted small">{{ i18n.t()('project.newerOnly.hint') }}</span>
        </span>
      </label>
      <div class="actions">
        <a class="btn small" routerLink="/import" [queryParams]="{ project: p.id }">{{
          i18n.t()('project.addFiles')
        }}</a>
        <button class="btn danger small" type="button" (click)="removeProject()">
          {{ i18n.t()('project.delete') }}
        </button>
      </div>

      @for (s of p.sources; track s.id) {
        <section class="card">
          <div class="source-head">
            <h3><eco-icon [ecosystem]="s.ecosystem" /> {{ s.label }}</h3>
            <span class="muted small">{{ s.kind }} · {{ fmtDate(s.updatedAt) }}</span>
            <button class="btn secondary small" type="button" (click)="removeSource(s)">
              {{ i18n.t()('project.removeSource') }}
            </button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ i18n.t()('project.col.follow') }}</th>
                  <th [attr.aria-sort]="ariaSort('name')">
                    <button type="button" class="sort" (click)="sortBy('name')">
                      {{ i18n.t()('project.col.dependency') }} {{ arrow('name') }}
                    </button>
                  </th>
                  <th [attr.aria-sort]="ariaSort('scope')">
                    <button type="button" class="sort" (click)="sortBy('scope')">
                      {{ i18n.t()('project.col.scope') }} {{ arrow('scope') }}
                    </button>
                  </th>
                  <th>{{ i18n.t()('project.col.used') }}</th>
                  <th [attr.aria-sort]="ariaSort('outdated')">
                    <button type="button" class="sort" (click)="sortBy('outdated')">
                      {{ i18n.t()('project.col.latest') }} {{ arrow('outdated') }}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (d of sorted(s.dependencies); track d.coordinates) {
                  <tr [class.followed]="d.followedArtifactId">
                    <td>
                      <input
                        type="checkbox"
                        [checked]="!!d.followedArtifactId"
                        [disabled]="busy().has(d.coordinates)"
                        (change)="toggle(s, d)"
                        [attr.aria-label]="i18n.t()('project.follow', { name: d.coordinates })"
                      />
                    </td>
                    <td class="coords">{{ d.coordinates }}</td>
                    <td>
                      <span class="scope" [class]="'scope scope-' + d.scope">{{ d.scope }}</span>
                    </td>
                    <td>{{ d.version ?? d.declared ?? '—' }}</td>
                    <td [class.outdated]="d.outdated">
                      {{ d.latestVersion ?? '—' }}
                      @if (d.outdated) {
                        <span [title]="i18n.t()('project.outdated.title')">⬆</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      } @empty {
        <p class="muted">{{ i18n.t()('project.noSource') }}</p>
      }
    } @else if (!projects.resource.isLoading() && !orphans()) {
      <p class="muted">{{ i18n.t()('project.notFound') }}</p>
    }
    @if (orphans(); as list) {
      <app-orphans-dialog [orphans]="list" (done)="afterOrphans()" />
    }
  `,
  styles: `
    .head,
    .actions,
    .source-head,
    .rename {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .head h1 {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .actions {
      margin-bottom: 1rem;
    }
    .rename input {
      flex: 1 1 200px;
      min-width: 0;
      font-size: 1.2rem;
      padding: 0.3rem 0.5rem;
    }
    .source-head h3 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      overflow-wrap: anywhere;
    }
    .source-head button {
      margin-left: auto;
    }
    .muted {
      color: var(--muted);
    }
    .small {
      font-size: 0.8rem;
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
      padding: 0.35rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--muted);
      font-weight: 600;
      white-space: nowrap;
    }
    tr:not(.followed) .coords {
      color: var(--muted);
    }
    .coords {
      overflow-wrap: anywhere;
    }
    .option {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      margin: 0 0 1rem;
    }
    .outdated,
    .outdated-count {
      color: #d97706;
      font-weight: 600;
    }
    .sort {
      background: none;
      border: none;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .scope {
      font-size: 0.7rem;
      padding: 0.05rem 0.45rem;
      border-radius: 999px;
      background: var(--hover-strong);
      white-space: nowrap;
    }
  `,
})
export class ProjectComponent {
  /** route param (withComponentInputBinding) */
  readonly id = input.required<string>();

  protected readonly i18n = inject(I18nService);
  protected readonly projects = inject(ProjectsService);
  private readonly artifacts = inject(ArtifactsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly project = computed(() => this.projects.projects().find((p) => p.id === this.id()));
  protected readonly followedCount = computed(
    () =>
      new Set(
        this.project()?.sources.flatMap((s) =>
          s.dependencies.filter((d) => d.followedArtifactId).map((d) => d.followedArtifactId),
        ),
      ).size,
  );
  protected readonly editing = signal(false);
  protected readonly draftName = signal('');
  protected readonly busy = signal(new Set<string>());
  /** default: by scope (parent, BOM, prod… internal modules last), then by name */
  protected readonly sort = signal<{ key: SortKey; desc: boolean }>({ key: 'scope', desc: false });
  protected readonly outdatedCount = computed(
    () =>
      this.project()
        ?.sources.flatMap((s) => s.dependencies)
        .filter((d) => d.outdated).length ?? 0,
  );
  /** follows left unused by a deletion, offered for unfollowing */
  protected readonly orphans = signal<Orphan[] | null>(null);
  private leaveAfterOrphans = false;

  constructor() {
    // always fresh: follows may have changed from the dashboard
    effect(() => {
      this.id();
      this.projects.resource.reload();
    });
  }

  startRename(name: string) {
    this.draftName.set(name);
    this.editing.set(true);
  }

  async rename() {
    const name = this.draftName().trim();
    if (!name) return;
    try {
      await this.projects.update(this.id(), { name });
      this.editing.set(false);
    } catch (e: any) {
      this.toast.show(e?.message || 'Error', 'error');
    }
  }

  async setNewerOnly(notifyNewerOnly: boolean) {
    try {
      await this.projects.update(this.id(), { notifyNewerOnly });
    } catch (e: any) {
      this.toast.show(e?.message || 'Error', 'error');
    }
  }

  async toggle(source: ProjectSource, dep: ProjectDependency) {
    this.busy.update((b) => new Set(b).add(dep.coordinates));
    try {
      if (dep.followedArtifactId) await this.artifacts.unfollow(dep.followedArtifactId);
      else await this.artifacts.follow(source.ecosystem, dep.coordinates);
      this.projects.resource.reload();
    } catch (e: any) {
      this.toast.show(e?.error?.message || 'Error', 'error');
    } finally {
      this.busy.update((b) => {
        const next = new Set(b);
        next.delete(dep.coordinates);
        return next;
      });
    }
  }

  async removeSource(source: ProjectSource) {
    if (!confirm(this.i18n.t()('project.removeSource.confirm', { name: source.label }))) return;
    try {
      const { orphans } = await this.projects.removeSource(this.id(), source.id);
      if (orphans.length) this.orphans.set(orphans);
    } catch (e: any) {
      this.toast.show(e?.message || 'Error', 'error');
    }
  }

  async removeProject() {
    if (!confirm(this.i18n.t()('project.delete.confirm', { name: this.project()?.name ?? '' }))) return;
    try {
      const { orphans } = await this.projects.remove(this.id());
      this.leaveAfterOrphans = true;
      if (orphans.length) this.orphans.set(orphans);
      else await this.router.navigate(['/']);
    } catch (e: any) {
      this.toast.show(e?.message || 'Error', 'error');
    }
  }

  async afterOrphans() {
    this.orphans.set(null);
    this.projects.resource.reload();
    if (this.leaveAfterOrphans) await this.router.navigate(['/']);
  }

  sortBy(key: SortKey) {
    this.sort.update((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: false }));
  }

  arrow(key: SortKey): string {
    const s = this.sort();
    return s.key !== key ? '' : s.desc ? '▼' : '▲';
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sort();
    return s.key !== key ? 'none' : s.desc ? 'descending' : 'ascending';
  }

  sorted(deps: ProjectDependency[]): ProjectDependency[] {
    const { key, desc } = this.sort();
    const byName = (a: ProjectDependency, b: ProjectDependency) => a.coordinates.localeCompare(b.coordinates);
    const primary = (a: ProjectDependency, b: ProjectDependency) =>
      key === 'scope'
        ? scopeRank(a.scope) - scopeRank(b.scope)
        : key === 'outdated'
          ? // behind first, then followed, then the rest
            outdatedRank(a) - outdatedRank(b)
          : 0;
    return [...deps].sort((a, b) => (desc ? -1 : 1) * (primary(a, b) || byName(a, b)));
  }

  fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.lang());
  }
}
