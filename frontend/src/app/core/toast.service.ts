import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; message: string; kind: 'success' | 'error' | 'info'; }

let NEXT = 1;

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  show(message: string, kind: Toast['kind'] = 'success', ttl = 3000) {
    const id = NEXT++;
    this.toasts.update(t => [...t, { id, message, kind }]);
    if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
  }

  dismiss(id: number) {
    this.toasts.update(t => t.filter(x => x.id !== id));
  }
}
