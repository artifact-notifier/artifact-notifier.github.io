import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { AuthService } from './core/auth.service';

function mockViewport(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe('AppComponent header', () => {
  const user = signal<{ name: string; email: string } | null>({ name: 'Jane Doe', email: 'jane@example.test' });

  function render(narrow: boolean) {
    mockViewport(narrow);
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user, logout: async () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    // not whenStable(): the banner's HTTP calls stay unanswered on purpose
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('uses icon buttons and language codes on narrow screens', () => {
    const el = render(true);
    const logout = el.querySelector('nav button.btn') as HTMLButtonElement;
    // an SVG, not the ⏻ glyph that mobile fonts lack
    expect(logout.querySelector('svg')).not.toBeNull();
    expect(logout.getAttribute('aria-label')).toBeTruthy();
    expect([...el.querySelectorAll('nav option')].map((o) => o.textContent?.trim())).toEqual([
      'FR',
      'EN',
      'ES',
      'DE',
      'ZH',
    ]);
  });

  it('shows text buttons on wide screens', () => {
    const el = render(false);
    const logout = el.querySelector('nav button.btn') as HTMLButtonElement;
    expect(logout.querySelector('svg')).toBeNull();
    expect(logout.textContent?.trim().length).toBeGreaterThan(0);
  });
});
