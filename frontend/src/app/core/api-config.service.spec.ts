import { ApplicationInitStatus, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService, buildApiUrl, provideApiConfig } from './api-config.service';

describe('buildApiUrl', () => {
  it('keeps paths same-origin without a base', () => {
    expect(buildApiUrl('', '/api/auth/me')).toBe('/api/auth/me');
  });

  it('prefixes the API base and adds the missing slash', () => {
    expect(buildApiUrl('https://api.example.test', 'api/auth/me')).toBe('https://api.example.test/api/auth/me');
  });
});

describe('ApiConfigService', () => {
  beforeEach(() => {
    delete window.__API_BASE_URL__;
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...provideApiConfig()] });
  });

  afterEach(() => {
    delete window.__API_BASE_URL__;
    vi.restoreAllMocks();
  });

  async function loaded() {
    await TestBed.inject(ApplicationInitStatus).donePromise;
    return TestBed.inject(ApiConfigService);
  }

  it('reads the API base from assets/api-config.json at startup (trailing slashes trimmed)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ apiBaseUrl: ' https://api.example.test// ' })));
    const api = await loaded();
    expect(fetchSpy.mock.calls[0][0]).toBe('assets/api-config.json');
    expect(api.base()).toBe('https://api.example.test');
    expect(api.apiUrl('/api/x')).toBe('https://api.example.test/api/x');
  });

  it('lets window.__API_BASE_URL__ take precedence', async () => {
    window.__API_BASE_URL__ = 'https://override.test/';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ apiBaseUrl: 'https://file.test' })));
    expect((await loaded()).base()).toBe('https://override.test');
  });

  it('stays same-origin when the file is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('404'));
    const api = await loaded();
    expect(api.base()).toBe('');
    expect(api.apiUrl('/api/x')).toBe('/api/x');
  });

  it('stays same-origin on an HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    expect((await loaded()).base()).toBe('');
  });
});
