import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../core/auth.service';
import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  const user = signal<object | null>(null);
  let svc: PreferencesService;
  let http: HttpTestingController;

  beforeEach(() => {
    user.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user, authHeaders: () => ({ Authorization: 'Bearer tok' }) } },
      ],
    });
    svc = TestBed.inject(PreferencesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.restoreAllMocks());

  it('loads preferences and constraints only once logged in', () => {
    TestBed.tick();
    expect(http.match('/api/preferences')).toHaveLength(0);

    user.set({ id: 'u1' });
    TestBed.tick();
    const prefs = http.match('/api/preferences');
    const constraints = http.match('/api/preferences/constraints');
    expect(prefs).toHaveLength(1);
    expect(constraints).toHaveLength(1);
    prefs[0].flush({ userId: 'u1' });
    constraints[0].flush({ immediateChannels: ['telegram'], mailMinDigestMinutes: 1440 });
    http.verify();
  });

  it('PUTs a partial update then reloads', async () => {
    user.set({ id: 'u1' });
    TestBed.tick();
    http.match(() => true).forEach((r) => r.flush({}));

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ theme: 'dark' }), { status: 200 }));
    await expect(svc.update({ theme: 'dark' })).resolves.toEqual({ theme: 'dark' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/preferences');
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify({ theme: 'dark' }) });

    TestBed.tick();
    http.expectOne('/api/preferences').flush({ theme: 'dark' });
  });

  it('rejects with the API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'digest too frequent' }), { status: 400 }),
    );
    await expect(svc.update({ digestIntervalMinutes: 1 })).rejects.toEqual({ message: 'digest too frequent' });
  });

  it('reload() refetches', async () => {
    user.set({ id: 'u1' });
    TestBed.tick();
    http.match(() => true).forEach((r) => r.flush({}));
    await new Promise((r) => setTimeout(r));
    svc.reload();
    TestBed.tick();
    expect(http.match('/api/preferences').length).toBe(1);
  });
});
