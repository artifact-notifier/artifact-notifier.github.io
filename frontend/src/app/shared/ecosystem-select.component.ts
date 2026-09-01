import { Component, signal, input, output, HostListener } from '@angular/core';
import { EcoIconComponent } from './eco-icon.component';

type Eco = 'NPM' | 'MAVEN' | 'PYPI' | 'TEST';

@Component({
  selector: 'ecosystem-select',
  standalone: true,
  imports: [EcoIconComponent],
  template: `
    <div class="eco-select" [class.open]="open()">
      <button type="button" class="eco-trigger" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-haspopup="listbox">
        <eco-icon [ecosystem]="value()" />
        <span class="eco-label">{{ label(value()) }}</span>
        <span class="chevron">▾</span>
      </button>
      @if (open()) {
        <ul class="eco-options" role="listbox">
          @for (eco of options; track eco) {
            <li role="option" [attr.aria-selected]="eco === value()" [class.active]="eco === value()" (click)="pick(eco)">
              <eco-icon [ecosystem]="eco" />
              <span>{{ label(eco) }}</span>
              @if (eco === value()) { <span class="check">✓</span> }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .eco-select{position:relative;display:inline-block}
    .eco-trigger{display:flex;align-items:center;gap:.5rem;height:38px;padding:0 .7rem;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text);cursor:pointer;min-width:150px;box-sizing:border-box;font-size:.9rem}
    .eco-trigger:hover{border-color:var(--muted)}
    .eco-trigger:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
    .eco-label{font-size:.9rem;font-weight:600;color:var(--text)}
    .chevron{margin-left:auto;color:var(--muted);font-size:.75rem}
    .eco-options{position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.12);list-style:none;margin:0;padding:4px;z-index:20}
    .eco-options li{display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;border-radius:6px;cursor:pointer;color:var(--text);font-size:.9rem}
    .eco-options li:hover,.eco-options li.active{background:var(--hover-strong);color:var(--text)}
    .check{margin-left:auto;color:#2563eb;font-weight:700}
  `,
})
export class EcosystemSelectComponent {
  value = input.required<Eco>();
  valueChange = output<Eco>();
  optionsInput = input<Eco[] | null>(null, { alias: 'options' });

  open = signal(false);
  // backend source via /api/artifacts/ecosystems (NODE_ENV) if provided, otherwise local fallback
  get options(): Eco[] {
    return this.optionsInput() ?? (['NPM', 'MAVEN', 'PYPI'] as Eco[]);
  }

  label(e: Eco) {
    return e === 'NPM' ? 'npm' : e === 'MAVEN' ? 'Maven' : e === 'PYPI' ? 'PyPI' : 'TEST';
  }

  pick(e: Eco) {
    this.open.set(false);
    this.valueChange.emit(e);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: Event) {
    const t = e.target as HTMLElement;
    if (!t.closest('ecosystem-select')) this.open.set(false);
  }
}
