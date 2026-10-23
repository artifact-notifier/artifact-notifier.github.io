import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService, Provider } from '../core/auth.service';
import { TelegramService } from '../core/telegram.service';
import { PreferencesService } from '../preferences/preferences.service';
import { LoginComponent } from './login.component';

/** Minimal stand-in for an httpResource (value() + hasValue()). */
function fakeResource<T>(value: WritableSignal<T>) {
  return { value, hasValue: () => value() !== undefined, reload: vi.fn() };
}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let el: HTMLElement;
  const providers = signal<Provider[] | undefined>(undefined);
  const auth = { providers: fakeResource(providers), loginWith: vi.fn() };
  const telegram = {
    enabled: signal(false),
    botUsername: signal<string | null>(null),
    config: { isLoading: signal(false), reload: vi.fn() },
    verify: vi.fn(),
  };

  async function render(search = '') {
    history.replaceState(null, '', `/${search}#/login`);
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TelegramService, useValue: telegram },
        { provide: PreferencesService, useValue: { resource: fakeResource(signal(undefined)) } },
      ],
    });
    fixture = TestBed.createComponent(LoginComponent);
    el = fixture.nativeElement;
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('locale', 'en');
    providers.set([
      { key: 'google', displayName: 'Google' },
      { key: 'github', displayName: 'GitHub' },
      { key: 'facebook', displayName: 'Facebook' },
      { key: 'gitlab', displayName: 'GitLab' },
    ]);
    telegram.enabled.set(false);
    telegram.botUsername.set(null);
    telegram.config.isLoading.set(false);
    auth.loginWith.mockReset();
    telegram.verify.mockReset();
    telegram.config.reload.mockReset();
  });

  afterEach(() => fixture?.destroy());

  it('offers one button per configured provider, with its logo', async () => {
    await render();
    const buttons = [...el.querySelectorAll('.provider-btn')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Log in with Google',
      'Log in with GitHub',
      'Log in with Facebook',
      'Log in with GitLab',
    ]);
    const logos = buttons.map((b) => b.querySelector('img')!.getAttribute('src'));
    expect(logos[0]).toContain('google');
    expect(logos[1]).toContain('github');
    expect(logos[2]).toContain('facebook');
    expect(logos[3]).toContain('oauth'); // unknown provider: generic icon

    buttons[1].click();
    expect(auth.loginWith).toHaveBeenCalledWith('github');
  });

  it('hides a logo that fails to load', async () => {
    await render();
    const img = el.querySelector('.provider-btn img')!;
    img.dispatchEvent(new Event('error'));
    expect(el.querySelector('.provider-btn img')?.getAttribute('alt')).not.toBe('Google');
  });

  it('says when no provider is configured', async () => {
    providers.set([]);
    await render();
    expect(el.textContent).toContain('No OIDC provider configured');
  });

  it('shows the error returned by the OAuth redirect', async () => {
    await render('?error=access_denied');
    expect(el.textContent).toContain('Login failed: access_denied');
  });

  it('shows a placeholder while the Telegram config loads', async () => {
    telegram.config.isLoading.set(true);
    await render();
    expect(el.textContent).toContain('…');
  });

  describe('Telegram login', () => {
    beforeEach(() => {
      telegram.enabled.set(true);
      telegram.botUsername.set('my_bot');
    });

    it('injects the login widget for the bot', async () => {
      await render();
      const script = el.querySelector('script') as HTMLScriptElement;
      expect(script.src).toBe('https://telegram.org/js/telegram-widget.js?22');
      expect(script.getAttribute('data-telegram-login')).toBe('my_bot');
      expect(script.getAttribute('data-onauth')).toBe('onTelegramAuth(user)');
      script.onload?.(new Event('load'));
    });

    it('shows a retry button when the widget cannot load', async () => {
      await render();
      (el.querySelector('script') as HTMLScriptElement).onerror?.(new Event('error'));
      fixture.detectChanges();
      expect(el.textContent).toContain('Telegram widget failed to load');

      (el.querySelector('.btn.secondary.small') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Telegram widget failed to load');
      expect(el.querySelectorAll('script').length).toBe(1);
    });

    it('logs in when Telegram calls back', async () => {
      await render();
      telegram.verify.mockResolvedValue(undefined);
      await (window as any).onTelegramAuth({ id: '42', hash: 'h' });
      expect(telegram.verify).toHaveBeenCalledWith({ id: '42', hash: 'h' });
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/']);
    });

    it('shows why a Telegram login failed', async () => {
      await render();
      telegram.verify.mockRejectedValue({ message: 'Invalid Telegram hash' });
      await (window as any).onTelegramAuth({ id: '42' });
      fixture.detectChanges();
      expect(el.textContent).toContain('Invalid Telegram hash');
    });
  });

  it('reloads the Telegram config on retry when the bot is unknown', async () => {
    telegram.enabled.set(true);
    await render();
    (fixture.componentInstance as unknown as { retryWidget(): void }).retryWidget();
    expect(telegram.config.reload).toHaveBeenCalled();
  });
});
