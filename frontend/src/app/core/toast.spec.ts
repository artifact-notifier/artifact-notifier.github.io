import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ToastComponent } from './toast.component';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });
  afterEach(() => vi.useRealTimers());

  it('stacks toasts and expires them after their ttl', () => {
    const toasts = TestBed.inject(ToastService);
    toasts.show('saved');
    toasts.show('boom', 'error', 0);
    expect(toasts.toasts().map((t) => `${t.kind}:${t.message}`)).toEqual(['success:saved', 'error:boom']);

    vi.advanceTimersByTime(3000);
    // ttl 0 = sticky
    expect(toasts.toasts().map((t) => t.message)).toEqual(['boom']);
  });

  it('dismisses a toast by id', () => {
    const toasts = TestBed.inject(ToastService);
    toasts.show('a', 'info', 0);
    toasts.dismiss(toasts.toasts()[0].id);
    expect(toasts.toasts()).toEqual([]);
  });
});

describe('ToastComponent', () => {
  it('renders toasts and closes them on click', () => {
    TestBed.configureTestingModule({
      imports: [ToastComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const toasts = TestBed.inject(ToastService);
    toasts.show('Hello', 'error', 0);
    const fixture = TestBed.createComponent(ToastComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const toast = el.querySelector('.toast')!;
    expect(toast.textContent).toContain('Hello');
    expect(toast.classList).toContain('toast--error');

    (el.querySelector('.toast-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.toast')).toBeNull();
  });
});
