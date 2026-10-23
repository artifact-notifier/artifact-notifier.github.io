import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { TelegramBannerComponent } from './telegram-banner.component';
import { TelegramService } from './telegram.service';

describe('TelegramBannerComponent', () => {
  const user = signal<object | null>({ id: 'u1' });
  const linked = signal(false);

  function render() {
    TestBed.configureTestingModule({
      imports: [TelegramBannerComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user, authHeaders: () => ({}) } },
        { provide: TelegramService, useValue: { linked } },
      ],
    });
    const fixture = TestBed.createComponent(TelegramBannerComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    localStorage.clear();
    user.set({ id: 'u1' });
    linked.set(false);
  });

  it('invites a logged-in user without Telegram to link it', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('.tg-banner')).not.toBeNull();
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/preferences');
  });

  it('stays hidden once Telegram is linked or when logged out', () => {
    linked.set(true);
    expect(render().nativeElement.querySelector('.tg-banner')).toBeNull();
    TestBed.resetTestingModule();
    linked.set(false);
    user.set(null);
    expect(render().nativeElement.querySelector('.tg-banner')).toBeNull();
  });

  it('remembers a dismissal', () => {
    const fixture = render();
    (fixture.nativeElement.querySelector('.tg-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tg-banner')).toBeNull();
    expect(localStorage.getItem('telegram-banner.dismissed')).toBe('1');

    TestBed.resetTestingModule();
    expect(render().nativeElement.querySelector('.tg-banner')).toBeNull();
  });
});
