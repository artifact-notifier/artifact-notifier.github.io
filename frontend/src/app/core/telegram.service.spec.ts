import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PreferencesService } from '../preferences/preferences.service';
import { AuthService } from './auth.service';
import { TelegramService } from './telegram.service';

/** Minimal stand-in for an httpResource (value() + hasValue()). */
function fakeResource<T>(value: WritableSignal<T>) {
  return { value, hasValue: () => value() !== undefined, reload: vi.fn() };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('TelegramService', () => {
  const user = signal<object | null>({ id: 'u1' });
  const prefsValue = signal<{ telegramChatId?: string | null } | undefined>(undefined);
  const auth = { user, authHeaders: () => ({ Authorization: 'Bearer tok' }), acceptToken: vi.fn(), refresh: vi.fn() };
  let svc: TelegramService;
  let http: HttpTestingController;

  async function settle() {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
  }

  beforeEach(() => {
    auth.acceptToken.mockReset();
    auth.refresh.mockReset();
    prefsValue.set(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: PreferencesService, useValue: { resource: fakeResource(prefsValue) } },
      ],
    });
    svc = TestBed.inject(TelegramService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.restoreAllMocks());

  it('exposes the bot config and the link status', async () => {
    TestBed.tick();
    http.expectOne('/api/auth/telegram/config').flush({ enabled: true, botUsername: 'my_bot' });
    http.expectOne('/api/auth/telegram/status').flush({ linked: false, telegramId: null, telegramUsername: null });
    await settle();
    expect(svc.enabled()).toBe(true);
    expect(svc.botUsername()).toBe('my_bot');
    expect(svc.linked()).toBe(false);

    // a chat id stored in the preferences also counts as linked
    prefsValue.set({ telegramChatId: '42' });
    expect(svc.linked()).toBe(true);
  });

  it('verify() keeps the returned Bearer token (cross-origin session)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true, token: 'tok2' }));
    await svc.verify({ id: '1', hash: 'h' });
    expect(auth.acceptToken).toHaveBeenCalledWith('tok2');
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('verify() refreshes the session when no token comes back', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true }));
    await svc.verify({ id: '1', hash: 'h' });
    expect(auth.refresh).toHaveBeenCalled();
  });

  it('verify() rejects with the API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Invalid Telegram hash' }, 401));
    await expect(svc.verify({})).rejects.toEqual({ message: 'Invalid Telegram hash' });
  });

  it('link() and unlink() call the API then refresh', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}));
    await svc.link({ id: '1' });
    await svc.unlink();
    expect(fetchSpy.mock.calls.map(([u, i]) => `${(i as RequestInit).method} ${u}`)).toEqual([
      'POST /api/auth/telegram/link',
      'DELETE /api/auth/telegram/unlink',
    ]);
    expect(auth.refresh).toHaveBeenCalledTimes(2);
  });

  it('link() and unlink() reject with a default message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 500 }));
    await expect(svc.link({})).rejects.toEqual({ message: 'Link failed' });
    await expect(svc.unlink()).rejects.toEqual({ message: 'Unlink failed' });
  });

  it('reload() refetches the status', async () => {
    TestBed.tick();
    http.match(() => true).forEach((r) => r.flush({}));
    await settle();
    svc.reload();
    TestBed.tick();
    expect(http.match('/api/auth/telegram/status').length).toBe(1);
  });
});
