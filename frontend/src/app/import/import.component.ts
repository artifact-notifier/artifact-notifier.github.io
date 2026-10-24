import { Component, computed, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { FollowedArtifact } from '../artifacts/artifacts.service';
import { ApiConfigService } from '../core/api-config.service';
import { I18nService } from '../core/i18n.service';
import { ToastService } from '../core/toast.service';
import { OrphansDialogComponent } from '../projects/orphans-dialog.component';
import { artifactKey, Orphan, ProjectSource, ProjectsService } from '../projects/projects.service';
import { EcoIconComponent } from '../shared/eco-icon.component';
import { valueOrUndefined } from '../shared/resource-value';
import { SCOPE_ORDER } from '../shared/scopes';
import { collectFromDataTransfer, collectFromFileList, CollectResult } from './collect-files';
import { DepScope, isSupportedFile, ParsedDependency, ParsedSource, ParseResult, parseProjectFiles } from './parsers';

/** Checked by default: what the project actually ships with. */
const DEFAULT_SCOPES = new Set<DepScope>(['prod', 'parent', 'bom']);

interface SourceState {
  parsed: ParsedSource;
  label: string;
  /** imported although nothing of it is to be followed */
  forced: boolean;
  checked: Set<string>;
}

@Component({
  selector: 'app-import',
  imports: [RouterLink, NgTemplateOutlet, EcoIconComponent, OrphansDialogComponent],
  template: `
    <p>
      <a routerLink="/">← {{ i18n.t()('project.back') }}</a>
    </p>
    <h1>📦 {{ i18n.t()('import.title') }}</h1>
    <p class="muted">{{ i18n.t()('import.privacy') }}</p>

    <section class="card">
      <h3>{{ i18n.t()('import.target') }}</h3>
      @if (existing(); as p) {
        <p>
          {{ i18n.t()('import.into', { name: p.name }) }}
          <span class="muted small">{{ i18n.t()('import.replaceHint') }}</span>
        </p>
      } @else {
        <label for="project-name">{{ i18n.t()('import.newName') }}</label>
        <input
          id="project-name"
          class="name"
          [value]="projectName()"
          (input)="projectName.set($any($event.target).value)"
          maxlength="100"
        />
        @if (nameTaken()) {
          <p class="error small">{{ i18n.t()('import.nameTaken') }}</p>
        }
      }
    </section>

    <section
      class="card drop"
      [class.over]="dragOver()"
      (dragover)="$event.preventDefault(); dragOver.set(true)"
      (dragleave)="dragOver.set(false)"
      (drop)="onDrop($event)"
    >
      <p>{{ i18n.t()('import.drop') }}</p>
      <p class="muted small">{{ i18n.t()('import.formats') }}</p>
      <div class="pickers">
        <label class="btn small">
          {{ i18n.t()('import.pickFiles') }}
          <input type="file" multiple hidden (change)="onPick($event)" />
        </label>
        <label class="btn secondary small">
          {{ i18n.t()('import.pickFolder') }}
          <input type="file" webkitdirectory hidden (change)="onPick($event)" />
        </label>
      </div>
      @if (parsing()) {
        <p class="muted">{{ i18n.t()('import.parsing') }}</p>
      }
    </section>

    @if (result(); as r) {
      @for (e of r.errors; track e.path) {
        <p class="error small">⚠️ {{ e.path }} : {{ e.message }}</p>
      }
      @if (r.ignored.length || skipped().length) {
        <p class="muted small">{{ i18n.t()('import.ignored', { files: [...r.ignored, ...skipped()].join(', ') }) }}</p>
      }
    }

    <ng-template #sourceCard let-s>
      <section class="card">
        @if (!hasSelection(s)) {
          <label class="include">
            <input type="checkbox" [checked]="s.forced" (change)="setForced(s, $any($event.target).checked)" />
            {{ i18n.t()('import.includeAnyway') }}
          </label>
        }
        <div class="source-head">
          <eco-icon [ecosystem]="s.parsed.ecosystem" />
          <input
            class="label"
            [value]="s.label"
            (input)="setLabel(s, $any($event.target).value)"
            [attr.aria-label]="i18n.t()('import.sourceLabel')"
            maxlength="200"
          />
          @if (replaces(s.label)) {
            <span class="badge">{{ i18n.t()('import.replaces') }}</span>
          }
        </div>
        <p class="muted small">{{ s.parsed.files.join(' + ') }}</p>
        @for (w of s.parsed.warnings; track w) {
          <p class="warn small">{{ w }}</p>
        }
        @if (removedFrom(s).length) {
          <p class="small removed">{{ i18n.t()('import.removed', { list: removedFrom(s).join(', ') }) }}</p>
        }
        <div class="bulk">
          <button type="button" class="link" (click)="setAll(s, true)">{{ i18n.t()('import.all') }}</button>
          <button type="button" class="link" (click)="setAll(s, false)">{{ i18n.t()('import.none') }}</button>
          <span class="muted small">{{
            i18n.t()('import.selected', { n: '' + s.checked.size, t: '' + s.parsed.dependencies.length })
          }}</span>
        </div>
        @for (group of groups(s.parsed); track group.scope) {
          <h4>{{ group.scope }} ({{ group.deps.length }})</h4>
          @if (group.scope === 'module') {
            <p class="muted small">{{ i18n.t()('import.moduleHint') }}</p>
          }
          <ul class="deps">
            @for (d of group.deps; track d.coordinates) {
              <li>
                <label>
                  <input
                    type="checkbox"
                    [checked]="s.checked.has(d.coordinates) || isFollowed(d)"
                    [disabled]="isFollowed(d)"
                    (change)="toggle(s, d.coordinates)"
                  />
                  <span class="coords">{{ d.coordinates }}</span>
                  <span class="muted small">{{ d.version ?? d.declared ?? '' }}</span>
                  @if (isFollowed(d)) {
                    <span class="badge">{{ i18n.t()('import.alreadyFollowed') }}</span>
                  }
                  @switch (change(s, d)) {
                    @case ('new') {
                      <span class="badge new">{{ i18n.t()('import.new') }}</span>
                    }
                    @case ('version') {
                      <span class="badge new">{{ previousVersion(s, d) }} → {{ d.version }}</span>
                    }
                  }
                </label>
              </li>
            }
          </ul>
        }
      </section>
    </ng-template>

    @for (s of included(); track s.parsed.files[0]) {
      <ng-container *ngTemplateOutlet="sourceCard; context: { $implicit: s }" />
    }

    @if (excluded().length) {
      <details class="excluded">
        <summary>{{ i18n.t()('import.excluded', { n: '' + excluded().length }) }}</summary>
        <p class="muted small">{{ i18n.t()('import.excludedHint') }}</p>
        @for (s of excluded(); track s.parsed.files[0]) {
          <ng-container *ngTemplateOutlet="sourceCard; context: { $implicit: s }" />
        }
      </details>
    }

    @if (orphans(); as list) {
      <app-orphans-dialog [orphans]="list" (done)="leave()" />
    }

    @if (sources().length) {
      <div class="submit">
        <span class="muted">{{
          i18n.t()('import.summary', { s: '' + included().length, n: '' + toFollow().length })
        }}</span>
        <button
          class="btn"
          type="button"
          [disabled]="!canSubmit() || submitting()"
          [attr.aria-busy]="submitting()"
          (click)="submit()"
        >
          @if (submitting()) {
            <span class="spinner" aria-hidden="true"></span>
            {{ i18n.t()('import.submitting', { n: '' + toFollow().length }) }}
          } @else {
            {{ i18n.t()('import.submit') }}
          }
        </button>
      </div>
    }
  `,
  styles: `
    .muted {
      color: var(--muted);
    }
    .small {
      font-size: 0.8rem;
    }
    .error {
      color: #dc2626;
    }
    .warn {
      color: #b45309;
      margin: 0.15rem 0;
    }
    h3,
    h4 {
      margin: 0.5rem 0;
    }
    h4 {
      font-size: 0.85rem;
      color: var(--muted);
      text-transform: uppercase;
    }
    input.name,
    input.label {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text);
    }
    .drop {
      border: 2px dashed var(--border);
      text-align: center;
    }
    .drop.over {
      border-color: #2563eb;
      background: var(--hover-strong);
    }
    .pickers {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.5rem;
    }
    .pickers label {
      cursor: pointer;
    }
    .source-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .source-head input {
      flex: 1;
      min-width: 0;
    }
    .bulk {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin: 0.5rem 0;
    }
    .link {
      background: none;
      border: none;
      padding: 0;
      color: #2563eb;
      cursor: pointer;
    }
    .deps {
      list-style: none;
      margin: 0;
      padding: 0;
      columns: 2 280px;
    }
    .deps li {
      break-inside: avoid;
      padding: 0.1rem 0;
    }
    .deps label {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
    }
    .coords {
      overflow-wrap: anywhere;
    }
    .badge {
      font-size: 0.65rem;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      background: var(--hover-strong);
      white-space: nowrap;
    }
    .badge.new {
      background: #2563eb;
      color: #fff;
    }
    .removed {
      color: #b45309;
    }
    .spinner {
      display: inline-block;
      width: 0.9em;
      height: 0.9em;
      margin-right: 0.4rem;
      vertical-align: -0.1em;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .include {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.25rem;
      font-size: 0.85rem;
    }
    .excluded {
      margin-bottom: 1rem;
    }
    .excluded summary {
      cursor: pointer;
      color: var(--muted);
      padding: 0.5rem 0;
    }
    .submit {
      position: sticky;
      bottom: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 0.75rem 0;
      background: var(--bg);
    }
  `,
})
export class ImportComponent {
  /** ?project=<id>: add/replace sources of an existing project */
  readonly project = input<string>();

  protected readonly i18n = inject(I18nService);
  private readonly projects = inject(ProjectsService);
  private readonly api = inject(ApiConfigService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  private readonly followsRes = httpResource<FollowedArtifact[]>(() => ({ url: this.api.apiUrl('/api/artifacts') }));
  private readonly followedKeys = computed(
    () => new Set((valueOrUndefined(this.followsRes) ?? []).map((f) => artifactKey(f.ecosystem, f.coordinates))),
  );

  protected readonly existing = computed(() => this.projects.projects().find((p) => p.id === this.project()));
  protected readonly projectName = signal('');
  protected readonly nameTaken = computed(() => {
    const name = this.projectName().trim();
    return !!name && this.projects.projects().some((p) => p.name === name);
  });
  protected readonly dragOver = signal(false);
  protected readonly parsing = signal(false);
  protected readonly result = signal<ParseResult | null>(null);
  protected readonly skipped = signal<string[]>([]);
  protected readonly sources = signal<SourceState[]>([]);
  protected readonly orphans = signal<Orphan[] | null>(null);
  /** an import is in flight: the button is disabled (no double submit) */
  protected readonly submitting = signal(false);
  private importedProjectId = '';

  /**
   * Sources sent to the project: those with something to follow (checked or
   * already followed), or kept on purpose. A module depending only on its
   * siblings has nothing to follow and would just clutter the project.
   */
  protected readonly included = computed(() => this.sources().filter((s) => s.forced || this.hasSelection(s)));
  protected readonly excluded = computed(() => this.sources().filter((s) => !s.forced && !this.hasSelection(s)));

  protected readonly toFollow = computed(() =>
    this.included().flatMap((s) =>
      s.parsed.dependencies.filter((d) => s.checked.has(d.coordinates) && !this.isFollowed(d)),
    ),
  );
  protected readonly canSubmit = computed(() => {
    const labels = this.included().map((s) => s.label.trim());
    const validLabels = labels.every(Boolean) && new Set(labels).size === labels.length;
    const target = this.existing() || (this.projectName().trim() && !this.nameTaken());
    return !!target && validLabels && this.included().length > 0;
  });

  async onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver.set(false);
    if (event.dataTransfer) await this.load(collectFromDataTransfer(event.dataTransfer, isSupportedFile));
  }

  async onPick(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) await this.load(collectFromFileList(input.files, isSupportedFile));
    input.value = '';
  }

  private async load(collecting: Promise<CollectResult>) {
    this.parsing.set(true);
    try {
      const { files, skipped } = await collecting;
      const result = await parseProjectFiles(files);
      this.result.set(result);
      this.skipped.set(skipped);
      this.sources.set(
        result.sources.map((parsed) => ({
          parsed,
          label: parsed.label,
          forced: false,
          checked: new Set(parsed.dependencies.filter((d) => DEFAULT_SCOPES.has(d.scope)).map((d) => d.coordinates)),
        })),
      );
      if (!this.existing() && !this.projectName()) this.projectName.set(defaultProjectName(files.map((f) => f.path)));
    } finally {
      this.parsing.set(false);
    }
  }

  protected isFollowed(d: ParsedDependency): boolean {
    return this.followedKeys().has(artifactKey(d.ecosystem, d.coordinates));
  }

  protected replaces(label: string): boolean {
    return !!this.previous(label);
  }

  /** The existing source this one replaces (same name in the target project). */
  private previous(label: string): ProjectSource | undefined {
    return this.existing()?.sources.find((s) => s.label === label.trim());
  }

  /** Compared with the replaced source: a new dependency, or a changed exact version. */
  protected change(s: SourceState, d: ParsedDependency): 'new' | 'version' | null {
    const prev = this.previous(s.label);
    if (!prev) return null;
    const old = prev.dependencies.find((p) => p.coordinates === d.coordinates);
    if (!old) return 'new';
    return old.version && d.version && old.version !== d.version ? 'version' : null;
  }

  protected previousVersion(s: SourceState, d: ParsedDependency): string {
    return this.previous(s.label)?.dependencies.find((p) => p.coordinates === d.coordinates)?.version ?? '';
  }

  /** Dependencies of the replaced source that are gone from the new file. */
  protected removedFrom(s: SourceState): string[] {
    const now = new Set(s.parsed.dependencies.map((d) => d.coordinates));
    return (this.previous(s.label)?.dependencies ?? []).map((d) => d.coordinates).filter((c) => !now.has(c));
  }

  protected groups(source: ParsedSource) {
    return SCOPE_ORDER.map((scope) => ({ scope, deps: source.dependencies.filter((d) => d.scope === scope) })).filter(
      (g) => g.deps.length,
    );
  }

  protected hasSelection(s: SourceState): boolean {
    return s.checked.size > 0 || s.parsed.dependencies.some((d) => this.isFollowed(d));
  }

  /** Sources are identified by their parse result, which never changes (the state objects do). */
  private updateSource(target: SourceState, change: (s: SourceState) => SourceState) {
    this.sources.update((list) => list.map((s) => (s.parsed === target.parsed ? change(s) : s)));
  }

  protected setLabel(source: SourceState, label: string) {
    this.updateSource(source, (s) => ({ ...s, label }));
  }

  protected setForced(source: SourceState, forced: boolean) {
    this.updateSource(source, (s) => ({ ...s, forced }));
  }

  protected toggle(source: SourceState, coordinates: string) {
    this.updateSource(source, (s) => {
      const checked = new Set(s.checked);
      if (!checked.delete(coordinates)) checked.add(coordinates);
      return { ...s, checked };
    });
  }

  protected setAll(source: SourceState, on: boolean) {
    this.updateSource(source, (s) => ({
      ...s,
      checked: new Set(on ? s.parsed.dependencies.map((d) => d.coordinates) : []),
    }));
  }

  async leave() {
    this.orphans.set(null);
    await this.router.navigate(['/projects', this.importedProjectId]);
  }

  async submit() {
    if (this.submitting()) return;
    this.submitting.set(true);
    const existing = this.existing();
    try {
      const res = await this.projects.importProject({
        ...(existing ? { projectId: existing.id } : { projectName: this.projectName().trim() }),
        sources: this.included().map((s) => ({
          label: s.label.trim(),
          kind: s.parsed.kind,
          ecosystem: s.parsed.ecosystem,
          dependencies: s.parsed.dependencies.map((d) => ({
            coordinates: d.coordinates,
            declared: d.declared,
            version: d.version,
            scope: d.scope,
          })),
        })),
        follow: this.toFollow().map((d) => ({ ecosystem: d.ecosystem, coordinates: d.coordinates })),
      });
      this.toast.show(this.i18n.t()('import.done', { n: '' + res.followed }), 'success');
      if (res.failed.length) {
        this.toast.show(
          this.i18n.t()('import.failed', { list: res.failed.map((f) => `${f.coordinates} (${f.reason})`).join(', ') }),
          'error',
        );
      }
      this.importedProjectId = res.projectId;
      if (res.orphans.length) this.orphans.set(res.orphans);
      else await this.leave();
    } catch (e: any) {
      this.toast.show(e?.message || 'Error', 'error');
    } finally {
      this.submitting.set(false);
    }
  }
}

/** Common top folder of the dropped files ("my-repo/front/package.json" -> "my-repo"), else empty. */
export function defaultProjectName(paths: string[]): string {
  const tops = new Set(paths.map((p) => (p.includes('/') ? p.split('/')[0] : '')));
  return tops.size === 1 ? [...tops][0] : '';
}
