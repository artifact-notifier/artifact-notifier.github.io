import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArtifactsService, FollowedArtifact, VersionsPreview } from '../artifacts/artifacts.service';
import { MAX_VERSION_RULES, PATTERN_RE, VersionRule, matchesRules } from '../artifacts/version-rules';
import { I18nService } from '../core/i18n.service';
import { ToastService } from '../core/toast.service';

type Prereleases = 'inherit' | 'yes' | 'no';

/** Edits the version filters of a follow, with a preview on its latest known versions. */
@Component({
  selector: 'app-version-rules-dialog',
  imports: [FormsModule],
  template: `
    <div
      class="overlay"
      (click)="$event.target === $event.currentTarget && closed.emit()"
      (keydown.escape)="closed.emit()"
      tabindex="-1"
    >
      <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t()('rules.title')">
        <h3>{{ i18n.t()('rules.title') }}</h3>
        <p class="coords">{{ artifact().coordinates }}</p>
        <p class="muted">{{ i18n.t()('rules.intro') }}</p>

        <label for="rules-pre" class="field-label">{{ i18n.t()('rules.prereleases') }}</label>
        <select id="rules-pre" [ngModel]="prereleases()" (ngModelChange)="prereleases.set($event)">
          <option value="inherit">
            {{
              i18n.t()('rules.prereleases.inherit', {
                value: i18n.t()(defaultPrereleases() ? 'rules.prereleases.on' : 'rules.prereleases.off'),
              })
            }}
          </option>
          <option value="yes">{{ i18n.t()('rules.prereleases.yes') }}</option>
          <option value="no">{{ i18n.t()('rules.prereleases.no') }}</option>
        </select>

        <span class="field-label">{{ i18n.t()('rules.list') }}</span>
        @for (r of rules(); track $index; let i = $index) {
          <div class="rule-row">
            <select
              [ngModel]="r.type"
              (ngModelChange)="setRule(i, { type: $event })"
              [attr.aria-label]="i18n.t()('rules.type')"
            >
              <option value="include">{{ i18n.t()('rules.include') }}</option>
              <option value="exclude">{{ i18n.t()('rules.exclude') }}</option>
            </select>
            <input
              [ngModel]="r.pattern"
              (ngModelChange)="setRule(i, { pattern: $event.trim() })"
              [class.invalid]="!validPattern(r.pattern)"
              [attr.aria-invalid]="!validPattern(r.pattern)"
              [attr.aria-label]="i18n.t()('rules.pattern')"
              placeholder="5.*"
              maxlength="64"
              autocomplete="off"
            />
            <button
              type="button"
              class="btn secondary small"
              (click)="removeRule(i)"
              [attr.aria-label]="i18n.t()('rules.remove')"
            >
              ✕
            </button>
          </div>
        } @empty {
          <p class="muted small-text">{{ i18n.t()('rules.none') }}</p>
        }
        <button type="button" class="btn secondary small" [disabled]="rules().length >= max" (click)="addRule()">
          + {{ i18n.t()('rules.add') }}
        </button>
        <p class="muted small-text">{{ i18n.t()('rules.help') }}</p>

        <span class="field-label">{{ i18n.t()('rules.preview') }}</span>
        @if (preview(); as p) {
          @if (p.length) {
            <p class="muted small-text">
              {{ i18n.t()('rules.preview.count', { n: '' + notifiedCount(), total: '' + p.length }) }}
            </p>
            <div class="chips">
              @for (v of p; track v.version) {
                <span
                  class="chip"
                  [class.on]="v.notified"
                  [title]="i18n.t()(v.notified ? 'rules.preview.notified' : 'rules.preview.filtered')"
                  >{{ v.notified ? '✓' : '✕' }} {{ v.version }}</span
                >
              }
            </div>
          } @else {
            <p class="muted small-text">{{ i18n.t()('rules.preview.empty') }}</p>
          }
        } @else {
          <p class="muted small-text">…</p>
        }

        <div class="actions">
          <button class="btn secondary" type="button" (click)="closed.emit()">{{ i18n.t()('rules.cancel') }}</button>
          <button class="btn" type="button" [disabled]="!valid() || busy()" (click)="save()">
            {{ i18n.t()('rules.save') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.5);
    }
    .modal {
      width: min(520px, 100%);
      max-height: 90vh;
      overflow: auto;
      padding: 1.25rem;
      border-radius: 10px;
      background: var(--bg-card);
      color: var(--text);
    }
    h3 {
      margin: 0;
    }
    .coords {
      margin: 0.2rem 0 0.5rem;
      font-family: monospace;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--muted);
      font-size: 0.9rem;
    }
    .small-text {
      font-size: 0.8rem;
      margin: 0.4rem 0;
    }
    .field-label {
      display: block;
      margin: 1rem 0 0.35rem;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .rule-row {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.4rem;
    }
    .rule-row input {
      flex: 1;
      min-width: 0;
      font-family: monospace;
    }
    .rule-row input.invalid {
      border-color: #dc2626;
    }
    .small {
      padding: 0.28rem 0.55rem;
      font-size: 0.78rem;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    .chip {
      font-size: 0.75rem;
      font-family: monospace;
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
      text-decoration: line-through;
    }
    .chip.on {
      border-color: #16a34a;
      color: var(--text);
      text-decoration: none;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
  `,
})
export class VersionRulesDialogComponent implements OnInit {
  readonly artifact = input.required<FollowedArtifact>();
  readonly saved = output<FollowedArtifact>();
  readonly closed = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly artifacts = inject(ArtifactsService);
  private readonly toast = inject(ToastService);

  protected readonly max = MAX_VERSION_RULES;
  protected readonly rules = signal<VersionRule[]>([]);
  protected readonly prereleases = signal<Prereleases>('inherit');
  protected readonly known = signal<VersionsPreview | null>(null);
  protected readonly busy = signal(false);

  protected readonly defaultPrereleases = computed(() => this.known()?.defaultIncludePrereleases ?? false);
  protected readonly valid = computed(() => this.rules().every((r) => this.validPattern(r.pattern)));

  /** Latest known versions and whether each would be notified with the edited settings. */
  protected readonly preview = computed(() => {
    const known = this.known();
    if (!known) return null;
    const pre = this.prereleases();
    const allowPre = pre === 'inherit' ? known.defaultIncludePrereleases : pre === 'yes';
    const rules = this.rules().filter((r) => this.validPattern(r.pattern));
    return known.versions.map((v) => ({
      version: v.version,
      notified: (allowPre || !v.prerelease) && matchesRules(v.version, rules),
    }));
  });
  protected readonly notifiedCount = computed(() => this.preview()?.filter((v) => v.notified).length ?? 0);

  ngOnInit() {
    const a = this.artifact();
    this.rules.set(a.versionRules.map((r) => ({ ...r })));
    this.prereleases.set(a.includePrereleases === null ? 'inherit' : a.includePrereleases ? 'yes' : 'no');
    this.artifacts.versions(a.id).then(
      (v) => this.known.set(v),
      () => this.known.set({ defaultIncludePrereleases: false, versions: [] }),
    );
  }

  validPattern(pattern: string): boolean {
    return PATTERN_RE.test(pattern);
  }

  setRule(index: number, change: Partial<VersionRule>) {
    this.rules.update((rules) => rules.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  addRule() {
    this.rules.update((rules) => [...rules, { type: 'include', pattern: '' }]);
  }

  removeRule(index: number) {
    this.rules.update((rules) => rules.filter((_, i) => i !== index));
  }

  async save() {
    this.busy.set(true);
    const pre = this.prereleases();
    try {
      const updated = await this.artifacts.setRules(
        this.artifact().id,
        this.rules(),
        pre === 'inherit' ? null : pre === 'yes',
      );
      this.toast.show(this.i18n.t()('rules.saved'), 'success');
      this.saved.emit(updated);
    } catch (e: any) {
      this.toast.show(e?.error?.message || this.i18n.t()('rules.error'), 'error');
    } finally {
      this.busy.set(false);
    }
  }
}
