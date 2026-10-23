import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../core/auth.service';
import { ArtifactsService } from './artifacts.service';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ArtifactsService', () => {
  let svc: ArtifactsService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { authHeaders: () => ({ Authorization: 'Bearer tok' }) } },
      ],
    });
    svc = TestBed.inject(ArtifactsService);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => vi.restoreAllMocks());

  const lastCall = () => {
    const [url, init] = fetchSpy.mock.calls.at(-1)!;
    return { url: String(url), init: init as RequestInit };
  };

  it('follows an artifact with the Bearer token', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ id: 'a1', coordinates: 'react' }));
    await expect(svc.follow('NPM', 'react')).resolves.toMatchObject({ id: 'a1' });
    const { url, init } = lastCall();
    expect(url).toBe('/api/artifacts/follow');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ ecosystem: 'NPM', coordinates: 'react' });
  });

  it('surfaces the API error message', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ message: 'bad coordinates' }, 400));
    await expect(svc.follow('NPM', '<x>')).rejects.toEqual({ error: { message: 'bad coordinates' } });
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response('oops', { status: 502, statusText: 'Bad Gateway' }));
    await expect(svc.unfollow('a1')).rejects.toEqual({ error: { message: 'Bad Gateway' } });
  });

  it('unfollows by id', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    await svc.unfollow('a1');
    expect(lastCall()).toMatchObject({ url: '/api/artifacts/a1', init: { method: 'DELETE' } });
  });

  it('simulates and bumps TEST versions', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ version: '1.1.0' }));
    await svc.simulateTestVersion('my/pkg', '1.1.0');
    expect(lastCall().url).toBe('/api/artifacts/test/simulate');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ coordinates: 'my/pkg', version: '1.1.0' });

    fetchSpy.mockResolvedValue(jsonResponse({ version: '1.2.0' }));
    await svc.bumpTestVersion('a1', '1.2.0');
    expect(lastCall().url).toBe('/api/artifacts/test/bump');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ id: 'a1', version: '1.2.0' });
  });

  it('rejects failed TEST calls', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ message: 'disabled' }, 403));
    await expect(svc.simulateTestVersion('x', '1')).rejects.toEqual({ error: { message: 'disabled' } });
    await expect(svc.bumpTestVersion('x', '1')).rejects.toEqual({ error: { message: 'disabled' } });
  });
});
