import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { I18nService } from './i18n.service';

@Component({
  selector: 'app-toast',
  imports: [],
  template: `
    <div class="toast-stack">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast--'+t.kind" role="status">
          <span>{{ t.message }}</span>
          <button class="toast-close" (click)="toast.dismiss(t.id)" [attr.aria-label]="i18n.t()('toast.close')">×</button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-stack{position:fixed;right:1rem;bottom:1rem;display:flex;flex-direction:column;gap:.5rem;z-index:9999}
    .toast{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);color:#fff;min-width:260px;max-width:420px;animation:slide .2s}
    .toast--success{background:#16a34a}.toast--error{background:#dc2626}.toast--info{background:#2563eb}
    .toast-close{background:transparent;border:none;color:#fff;font-size:1.2rem;cursor:pointer;margin-left:auto}
    @keyframes slide{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
  `,
})
export class ToastComponent {
  toast = inject(ToastService);
  i18n = inject(I18nService);
}
