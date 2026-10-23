import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PreferencesService } from '../preferences/preferences.service';
import { ThemeService } from './theme.service';

/** Minimal stand-in for an httpResource (value() + hasValue()). */
function fakeResource<T>(value: WritableSignal<T>) {
  return { value, hasValue: () => value() !== undefined, reload: vi.fn() };
}

describe('ThemeService', () => {
  const prefsValue = signal<{ theme?: string } | undefined>(undefined);
  const prefs = { resource: fakeResource(prefsValue), update: vi.fn() };
  let systemDark = false;
  let systemListener: (() => void) | undefined;

  function create() {
    window.matchMedia = ((query: string) => ({
      get matches() {
        return systemDark;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => (systemListener = l),
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: PreferencesService, useValue: prefs }],
    });
    const svc = TestBed.inject(ThemeService);
    TestBed.tick();
    return svc;
  }

  beforeEach(() => {
    localStorage.clear();
    prefsValue.set(undefined);
    prefs.update.mockReset().mockResolvedValue({});
    systemDark = false;
  });

  it('follows the system by default', () => {
    systemDark = true;
    const svc = create();
    expect(svc.theme()).toBe('system');
    expect(svc.resolved()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('restores the saved choice', () => {
    localStorage.setItem('theme', 'light');
    expect(create().resolved()).toBe('light');
  });

  it('setTheme stores locally and in the preferences', () => {
    const svc = create();
    svc.setTheme('dark');
    TestBed.tick();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(prefs.update).toHaveBeenCalledWith({ theme: 'dark' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('toggle switches between light and dark', () => {
    localStorage.setItem('theme', 'dark');
    const svc = create();
    svc.toggle();
    expect(svc.theme()).toBe('light');
    svc.toggle();
    expect(svc.theme()).toBe('dark');
  });

  it('adopts the theme saved in the user preferences', () => {
    const svc = create();
    prefsValue.set({ theme: 'dark' });
    TestBed.tick();
    expect(svc.theme()).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('ignores an unknown theme from the preferences', () => {
    const svc = create();
    prefsValue.set({ theme: 'neon' });
    TestBed.tick();
    expect(svc.theme()).toBe('system');
  });

  it('reacts to system changes in system mode', () => {
    const svc = create();
    expect(svc.resolved()).toBe('light');
    systemDark = true;
    systemListener?.();
    TestBed.tick();
    expect(svc.theme()).toBe('system');
  });
});
