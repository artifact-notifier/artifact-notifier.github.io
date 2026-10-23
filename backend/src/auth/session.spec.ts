import { ConfigService } from '@nestjs/config';
import { apiPublicUrl, sessionCookieOptions, trimTrailingSlashes } from './session';

describe('trimTrailingSlashes', () => {
  it.each([
    ['https://a.test///', 'https://a.test'],
    ['https://a.test', 'https://a.test'],
    ['///', ''],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(trimTrailingSlashes(input)).toBe(expected);
  });
});

describe('sessionCookieOptions', () => {
  it('uses SameSite=None + Secure when frontend and API are cross-site', () => {
    const config = new ConfigService({
      FRONTEND_URL: 'https://artifact-notifier.github.io',
      BACKEND_PUBLIC_URL: 'https://artifact-notifier.duckdns.org/',
      NODE_ENV: 'production',
    });
    expect(sessionCookieOptions(config)).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true });
  });

  it('uses SameSite=Lax on the same origin in dev', () => {
    const config = new ConfigService({ FRONTEND_URL: 'http://localhost:4200', NODE_ENV: 'development' });
    expect(sessionCookieOptions(config)).toMatchObject({ sameSite: 'lax', secure: false });
  });

  it('falls back to the first frontend URL for the API URL', () => {
    const config = new ConfigService({ FRONTEND_URL: 'https://a.test/, https://b.test' });
    expect(apiPublicUrl(config)).toBe('https://a.test');
  });
});
