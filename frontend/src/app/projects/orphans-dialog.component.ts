import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { I18nService } from '../core/i18n.service';
import { ToastService } from '../core/toast.service';
import { Orphan } from './projects.service';

/** Offers to unfollow the artifacts no project uses any more (all checked by default). */
@Component({
  selector: 'app-orphans-dialog',
  template: `
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t()('orphans.title')">
        <h3>{{ i18n.t()('orphans.title') }}</h3>
        <p class="muted">{{ i18n.t()('orphans.message') }}</p>
        <ul>
          @for (o of orphans(); track o.followedArtifactId) {
            <li>
              <label>
                <input type="checkbox" [checked]="selected().has(o.followedArtifactId)" (change)="toggle(o)" />
                {{ o.coordinates }}
              </label>
            </li>
          }
        </ul>
        <div class="actions">
          <button class="btn secondary" type="button" (click)="done.emit()">{{ i18n.t()('orphans.keep') }}</button>
          <button class="btn danger" type="button" [disabled]="!selected().size || busy()" (click)="unfollow()">
            {{ i18n.t()('orphans.unfollow', { n: '' + selected().size }) }}
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
      width: min(480px, 100%);
      max-height: 90vh;
      overflow: auto;
      padding: 1.25rem;
      border-radius: 10px;
      background: var(--bg-card);
      color: var(--text);
    }
    h3 {
      margin-top: 0;
    }
    .muted {
      color: var(--muted);
      font-size: 0.9rem;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li label {
      display: flex;
      gap: 0.4rem;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `,
})
export class OrphansDialogComponent implements OnInit {
  readonly orphans = input.required<Orphan[]>();
  readonly done = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly artifacts = inject(ArtifactsService);
  private readonly toast = inject(ToastService);

  protected readonly selected = signal(new Set<string>());
  protected readonly busy = signal(false);

  ngOnInit() {
    this.selected.set(new Set(this.orphans().map((o) => o.followedArtifactId)));
  }

  toggle(o: Orphan) {
    this.selected.update((s) => {
      const next = new Set(s);
      if (!next.delete(o.followedArtifactId)) next.add(o.followedArtifactId);
      return next;
    });
  }

  async unfollow() {
    this.busy.set(true);
    try {
      for (const id of this.selected()) await this.artifacts.unfollow(id);
      this.toast.show(this.i18n.t()('orphans.done', { n: '' + this.selected().size }), 'success');
    } catch (e: any) {
      this.toast.show(e?.error?.message || 'Error', 'error');
    } finally {
      this.busy.set(false);
      this.done.emit();
    }
  }
}
