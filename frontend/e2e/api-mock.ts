import { Page, Route } from '@playwright/test';

export const USER = {
  id: 'u1',
  email: 'jane.doe@example.test',
  name: 'Jane Doe With A Rather Long Name',
  provider: 'google',
  preferences: { locale: 'fr' },
};

const PREFERENCES = {
  userId: 'u1',
  email: USER.email,
  notificationMode: 'DIGEST',
  digestIntervalMinutes: 1440,
  locale: 'fr',
  theme: 'dark',
  notificationChannel: 'email',
  telegramChatId: null,
  includePrereleases: false,
};

const ARTIFACTS = [
  {
    id: 'a1',
    ecosystem: 'MAVEN',
    coordinates: 'org.springframework.boot:spring-boot',
    currentVersion: '4.1.2',
    events: [
      { version: '4.1.2', publishedAt: '2026-10-22T14:04:04Z', deliveries: [{ status: 'SENT', channel: 'email' }] },
    ],
  },
  { id: 'a2', ecosystem: 'NPM', coordinates: '@angular/core', currentVersion: '22.2.3', events: [] },
];

/**
 * Answers every /api call like the backend would. `loggedIn: false` makes
 * /api/auth/me answer 401, as for a visitor without a session.
 */
export async function mockApi(page: Page, { loggedIn }: { loggedIn: boolean }) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/assets/api-config.json', (route) => json(route, { apiBaseUrl: '' }));
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const unauthorized = () => json(route, { statusCode: 401, message: 'Unauthorized' }, 401);
    switch (pathname) {
      case '/api/auth/providers':
        return json(route, [
          { key: 'google', displayName: 'Google' },
          { key: 'github', displayName: 'GitHub' },
        ]);
      case '/api/auth/telegram/config':
        return json(route, { enabled: false, botUsername: null });
      case '/api/auth/me':
        return loggedIn ? json(route, USER) : unauthorized();
    }
    if (!loggedIn) return unauthorized();
    switch (pathname) {
      case '/api/artifacts':
        return json(route, ARTIFACTS);
      case '/api/artifacts/ecosystems':
        return json(route, ['NPM', 'MAVEN', 'PYPI']);
      case '/api/artifacts/sync-status':
        return json(route, {
          NPM: { lastSync: '2026-10-23T18:00:00Z' },
          MAVEN: { lastSync: '2026-10-23T18:00:00Z' },
          PYPI: { lastSync: '2026-10-23T18:00:00Z' },
        });
      case '/api/preferences':
        return json(route, PREFERENCES);
      case '/api/preferences/constraints':
        return json(route, { immediateChannels: ['telegram'], mailMinDigestMinutes: 1440 });
      case '/api/auth/links':
        return json(route, [{ key: 'google', displayName: 'Google', linked: true }]);
      case '/api/auth/telegram/status':
        return json(route, { linked: false, telegramId: null, telegramUsername: null });
      case '/api/auth/logout':
        return json(route, { success: true });
      default:
        return json(route, {});
    }
  });
}

/** Width of the page content beyond the viewport (0 = no horizontal scroll). */
export function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
