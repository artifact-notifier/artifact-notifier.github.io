import { buildApiUrl } from './api-config.service';

describe('buildApiUrl', () => {
  it('keeps paths same-origin without a base', () => {
    expect(buildApiUrl('', '/api/auth/me')).toBe('/api/auth/me');
  });

  it('prefixes the API base and adds the missing slash', () => {
    expect(buildApiUrl('https://api.example.test', 'api/auth/me')).toBe('https://api.example.test/api/auth/me');
  });
});
