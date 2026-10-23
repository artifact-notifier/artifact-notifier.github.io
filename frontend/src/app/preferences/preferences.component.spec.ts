import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { TelegramService } from '../core/telegram.service';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { Preferences, PreferencesService } from './preferences.service';
import { PreferencesComponent } from './preferences.component';

/** Minimal stand-in for an httpResource (value() + hasValue()). */
function fakeResource<T>(value: WritableSignal<T>) {
  return { value, hasValue: () => value() !== undefined, reload: vi.fn() };
}

const PREFS: Preferences = {
  userId: 'u1',
  email: 'jane@example.test',
  notificationMode: 'DIGEST',
  digestIntervalMinutes: 1440,
  locale: 'en',
  theme: 'dark',
  notificationChannel: 'email',
  telegramChatId: null,
  includePrereleases: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('PreferencesComponent', () => {
  let fixture: ComponentFixture<PreferencesComponent>;
  let el: HTMLElement;
  let http: HttpTestingController;

  const prefsValue = signal<Preferences | undefined>(undefined);
  const prefsSvc = {
    resource: fakeResource(prefsValue),
    constraints: fakeResource(signal({ immediateChannels: ['telegram'], mailMinDigestMinutes: 1440 })),
    update: vi.fn(),
    reload: vi.fn(),
  };
  const linkedProviders = signal<{ key: string; displayName: string; linked: boolean }[] | undefined>(undefined);
  const auth = {
    user: signal({ id: 'u1' }),
    authHeaders: () => ({ Authorization: 'Bearer tok' }),
    linkedProviders: fakeResource(linkedProviders),
    linkProvider: vi.fn(),
    unlinkProvider: vi.fn(),
    confirmLink: vi.fn(),
    deleteAccount: vi.fn(),
  };
  const telegramLinked = signal(false);
  const telegram = {
    linked: telegramLinked,
    enabled: signal(false),
    botUsername: signal<string | null>(null),
    status: fakeResource(signal<{ telegramId: string; telegramUsername: string } | undefined>(undefined)),
    link: vi.fn(),
    unlink: vi.fn(),
    reload: vi.fn(),
  };
  const theme = { theme: signal('dark'), setTheme: vi.fn() };

  async function settle() {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  async function render(prefs: Partial<Preferences> = {}, url = '/#/preferences') {
    history.replaceState(null, '', url);
    prefsValue.set({ ...PREFS, ...prefs });
    TestBed.configureTestingModule({
      imports: [PreferencesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PreferencesService, useValue: prefsSvc },
        { provide: AuthService, useValue: auth },
        { provide: TelegramService, useValue: telegram },
        { provide: ThemeService, useValue: theme },
      ],
    });
    fixture = TestBed.createComponent(PreferencesComponent);
    el = fixture.nativeElement;
    http = TestBed.inject(HttpTestingController);
    await settle();
  }

  const toasts = () => TestBed.inject(ToastService).toasts();
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
  const select = async (id: string, value: string) => {
    const s = el.querySelector(`#${id}`) as HTMLSelectElement;
    s.value = value;
    s.dispatchEvent(new Event('change'));
    await settle();
  };
  const savedDto = () => prefsSvc.update.mock.calls.at(-1)![0];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('locale', 'en');
    vi.restoreAllMocks();
    [prefsSvc.update, prefsSvc.resource.reload, auth.linkProvider, auth.unlinkProvider, auth.confirmLink]
      .concat([auth.deleteAccount, auth.linkedProviders.reload, telegram.link, telegram.unlink, telegram.reload])
      .forEach((f) => f.mockReset());
    linkedProviders.set(undefined);
    telegramLinked.set(false);
  });

  afterEach(() => fixture?.destroy());

  describe('notification settings', () => {
    it('shows the current preferences', async () => {
      await render();
      expect((el.querySelector('#pref-email') as HTMLInputElement).value).toBe('jane@example.test');
      expect((el.querySelector('#pref-channel') as HTMLSelectElement).value).toBe('email');
      // Telegram options need a linked Telegram
      expect((el.querySelector('#pref-channel option[value=telegram]') as HTMLOptionElement).disabled).toBe(true);
      // immediate mode is Telegram-only
      expect((el.querySelector('#pref-mode option[value=IMMEDIATE]') as HTMLOptionElement).disabled).toBe(true);
      expect([...el.querySelectorAll('#pref-interval option')].map((o) => o.textContent)).toEqual([
        'Daily',
        'Weekly',
        'Monthly',
      ]);
    });

    it('saves the edited preferences without locale and theme', async () => {
      await render();
      prefsSvc.update.mockResolvedValue({});
      const email = el.querySelector('#pref-email') as HTMLInputElement;
      email.value = 'new@example.test';
      email.dispatchEvent(new Event('input'));
      const prerelease = el.querySelector('input[type=checkbox]') as HTMLInputElement;
      prerelease.click();
      await select('pref-interval', '10080');
      button('Save').click();
      await settle();

      expect(savedDto()).toEqual({
        userId: 'u1',
        email: 'new@example.test',
        notificationMode: 'DIGEST',
        digestIntervalMinutes: 10080,
        notificationChannel: 'email',
        telegramChatId: null,
        includePrereleases: true,
      });
      expect(el.textContent).toContain('✓ Saved');
      expect(toasts().at(-1)?.kind).toBe('success');
    });

    it('switching to Telegram allows immediate mode; back to mail forces a daily digest', async () => {
      telegramLinked.set(true);
      await render({ notificationChannel: 'telegram', notificationMode: 'IMMEDIATE', digestIntervalMinutes: 60 });
      expect((el.querySelector('#pref-mode option[value=IMMEDIATE]') as HTMLOptionElement).disabled).toBe(false);

      await select('pref-channel', 'email');
      prefsSvc.update.mockResolvedValue({});
      button('Save').click();
      await settle();
      expect(savedDto()).toMatchObject({
        notificationChannel: 'email',
        notificationMode: 'DIGEST',
        digestIntervalMinutes: 1440,
      });
    });

    it('falls back to mail when Telegram is no longer linked', async () => {
      await render({ notificationChannel: 'both' });
      expect(el.textContent).toContain('Telegram');
      prefsSvc.update.mockResolvedValue({});
      button('Save').click();
      await settle();
      expect(savedDto()).toMatchObject({ notificationChannel: 'email' });
    });

    it('requires a real address for mail on a Telegram-only account', async () => {
      await render({ email: '42@telegram.local' });
      expect(el.textContent).toContain('A real email address is required');
      button('Save').click();
      await settle();
      expect(prefsSvc.update).not.toHaveBeenCalled();
      expect(toasts().at(-1)?.kind).toBe('error');
    });

    it('reports a rejected save', async () => {
      await render();
      prefsSvc.update.mockRejectedValue({ message: 'digest too frequent' });
      button('Save').click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'digest too frequent' });
      expect(el.textContent).not.toContain('✓ Saved');
    });

    it('changes the theme', async () => {
      await render();
      await select('pref-theme', 'light');
      expect(theme.setTheme).toHaveBeenCalledWith('light');
    });
  });

  describe('Telegram', () => {
    it('shows the linked account and unlinks it', async () => {
      telegramLinked.set(true);
      telegram.status.value.set({ telegramId: '42', telegramUsername: 'jdoe' });
      await render();
      expect(el.textContent).toContain('@jdoe (42)');
      telegram.unlink.mockResolvedValue(undefined);
      button('Unlink').click();
      await settle();
      expect(telegram.unlink).toHaveBeenCalled();
      expect(toasts().at(-1)?.kind).toBe('success');

      telegram.unlink.mockRejectedValue({ error: { message: 'nope' } });
      button('Unlink').click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'nope' });
    });

    it('links through the widget callback', async () => {
      await render();
      const callback = (window as any).onTelegramAuthLink as (u: object) => Promise<void>;
      telegram.link.mockResolvedValue(undefined);
      await callback({ id: '42', hash: 'h' });
      expect(telegram.link).toHaveBeenCalledWith({ id: '42', hash: 'h' });

      telegram.link.mockRejectedValue({ message: 'Invalid Telegram hash' });
      await callback({ id: '42' });
      fixture.detectChanges();
      expect(el.textContent).toContain('Invalid Telegram hash');
    });

    it('injects the login widget for the configured bot', async () => {
      telegram.enabled.set(true);
      telegram.botUsername.set('my_bot');
      await render();
      const script = el.querySelector('script') as HTMLScriptElement;
      expect(script.src).toContain('telegram-widget.js');
      expect(script.getAttribute('data-telegram-login')).toBe('my_bot');
      telegram.enabled.set(false);
      telegram.botUsername.set(null);
    });
  });

  describe('linked accounts', () => {
    beforeEach(() =>
      linkedProviders.set([
        { key: 'google', displayName: 'Google', linked: true },
        { key: 'github', displayName: 'GitHub', linked: false },
      ]),
    );

    it('links and unlinks providers', async () => {
      await render();
      auth.linkProvider.mockResolvedValue(undefined);
      button('Link').click();
      expect(auth.linkProvider).toHaveBeenCalledWith('github');

      auth.unlinkProvider.mockResolvedValue(undefined);
      button('Unlink').click();
      await settle();
      expect(auth.unlinkProvider).toHaveBeenCalledWith('google');
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'google unlinked' });
    });

    it('reports link and unlink failures', async () => {
      await render();
      auth.linkProvider.mockRejectedValue({ message: 'Link failed' });
      auth.unlinkProvider.mockRejectedValue({ message: 'Cannot remove the last login method' });
      button('Link').click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Link failed' });
      button('Unlink').click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Cannot remove the last login method' });
    });
  });

  describe('OAuth link round-trip', () => {
    it('confirms a pending link with the current session', async () => {
      auth.confirmLink.mockResolvedValue({ linked: 'github' });
      await render({}, '/#/preferences?link=t1');
      await settle();
      expect(auth.confirmLink).toHaveBeenCalledWith('t1');
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'github linked ✓' });
      // the token does not stay in the URL
      expect(location.hash).toBe('#/preferences');
    });

    it('turns into a merge proposal when the identity has its own account', async () => {
      auth.confirmLink.mockResolvedValue({ merge: 'm1' });
      await render({}, '/#/preferences?link=t1');
      await settle();
      http.expectOne('/api/auth/merge/preview?token=m1').flush({
        from: { email: 'other@example.test', provider: 'github' },
        to: { email: 'jane@example.test', provider: 'google' },
        followsToMove: 2,
        duplicateFollows: 0,
        identitiesToMove: 1,
        telegramToMove: true,
      });
      await settle();
      expect(el.textContent).toContain('other@example.test');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 'u1' }));
      button('Merge').click();
      await settle();
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/merge/confirm');
      expect((fetchSpy.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ token: 'm1' }));
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'Accounts merged ✓' });
    });

    it('reports a refused link', async () => {
      auth.confirmLink.mockRejectedValue({ message: 'Invalid or expired link request' });
      await render({}, '/#/preferences?link=t1');
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error' });
      expect(toasts().at(-1)?.message).toContain('Invalid or expired link request');
    });

    it('shows the outcome passed back by the API (linked / error)', async () => {
      await render({}, '/#/preferences?linked=google');
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'google linked ✓' });
      fixture.destroy();
      TestBed.resetTestingModule();

      await render({}, '/#/preferences?error=access_denied');
      await settle();
      expect(toasts().at(-1)?.message).toContain('access_denied');
    });

    it('handles an expired merge and a failed merge', async () => {
      await render({}, '/#/preferences?merge=m2');
      await settle();
      http.expectOne('/api/auth/merge/preview?token=m2').flush({}, { status: 401, statusText: 'Unauthorized' });
      await settle();
      expect(el.textContent).toContain('Merge request expired');
      button('Cancel').click();
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Merge request expired');
    });

    it('reports a merge the API refuses', async () => {
      await render({}, '/#/preferences?merge=m3');
      await settle();
      http.expectOne('/api/auth/merge/preview?token=m3').flush({
        from: { email: 'a@x.test', provider: 'github' },
        to: { email: 'b@x.test', provider: 'google' },
        followsToMove: 0,
        duplicateFollows: 0,
        identitiesToMove: 1,
        telegramToMove: false,
      });
      await settle();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Merge failed' }, 400));
      (el.querySelector('.card .row .btn:not(.secondary):not(.danger)') as HTMLButtonElement).click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Merge failed' });
    });
  });

  describe('account deletion', () => {
    it('needs a second confirmation', async () => {
      await render();
      auth.deleteAccount.mockResolvedValue(undefined);
      button('Delete my account').click();
      fixture.detectChanges();
      button('Cancel').click();
      fixture.detectChanges();
      expect(auth.deleteAccount).not.toHaveBeenCalled();

      button('Delete my account').click();
      fixture.detectChanges();
      button('Yes, delete').click();
      await settle();
      expect(auth.deleteAccount).toHaveBeenCalled();
      expect(toasts().at(-1)).toMatchObject({ kind: 'success', message: 'Account deleted' });
    });

    it('reports a failure', async () => {
      await render();
      auth.deleteAccount.mockRejectedValue({ message: 'Delete failed' });
      button('Delete my account').click();
      fixture.detectChanges();
      button('Yes, delete').click();
      await settle();
      expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Delete failed' });
    });
  });
});
