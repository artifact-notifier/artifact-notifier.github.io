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

export const PROJECTS = [
  {
    id: 'p1',
    name: 'shop',
    notifyNewerOnly: false,
    createdAt: '2026-10-20T00:00:00Z',
    sources: [
      {
        id: 's1',
        label: 'shop/front/package.json',
        kind: 'package.json',
        ecosystem: 'NPM',
        updatedAt: '2026-10-20T00:00:00Z',
        dependencies: [
          {
            coordinates: '@angular/core',
            declared: '^22.2.0',
            version: '22.2.3',
            scope: 'prod',
            followedArtifactId: 'a2',
            latestVersion: '22.2.3',
            outdated: false,
          },
          {
            coordinates: 'vitest',
            declared: '^5.0.0',
            version: null,
            scope: 'dev',
            followedArtifactId: null,
            latestVersion: null,
            outdated: false,
          },
        ],
      },
    ],
  },
];

const ADMIN_STATS = {
  users: {
    total: 2,
    new7d: 1,
    new30d: 2,
    byProvider: { google: 2 },
    byChannel: { email: 2 },
    byMode: { DIGEST: 2 },
    telegramLinked: 0,
    withPrereleases: 1,
  },
  artifacts: {
    follows: 2,
    distinct: 2,
    byEcosystem: { MAVEN: 1, NPM: 1 },
    top: [{ ecosystem: 'MAVEN', coordinates: 'org.springframework.boot:spring-boot-starter-parent', followers: 1 }],
    knownVersions: 1421,
  },
  notifications: { deliveriesByChannel: { email: { SENT: 3 } }, sent24h: 1, sent7d: 3, failed7d: 0, events7d: 4 },
  listeners: { NPM: { lastSync: '2026-10-23T18:00:00Z' }, MAVEN: { lastSync: '2026-10-23T18:00:00Z' } },
  system: { version: '0123456789abcdef', uptimeSeconds: 3600, databaseBytes: 204800 },
};

const ADMIN_USERS = [
  {
    id: 'cm0000000000000000000001',
    email: USER.email,
    name: USER.name,
    createdAt: '2026-10-01T00:00:00Z',
    providers: ['google', 'github'],
    follows: 2,
    channel: 'email',
    mode: 'DIGEST',
    telegramLinked: false,
    includePrereleases: true,
    lastNotifiedAt: '2026-10-22T10:00:00Z',
    isAdmin: true,
  },
];

/**
 * Answers every /api call like the backend would. `loggedIn: false` makes
 * /api/auth/me answer 401, as for a visitor without a session.
 */
export async function mockApi(page: Page, { loggedIn, admin = false }: { loggedIn: boolean; admin?: boolean }) {
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
        return loggedIn ? json(route, { ...USER, isAdmin: admin }) : unauthorized();
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
      case '/api/projects':
        return json(route, PROJECTS);
      case '/api/projects/import':
        return json(route, { projectId: 'p1', followed: 2, failed: [], orphans: [] }, 201);
      case '/api/admin/stats':
        return admin ? json(route, ADMIN_STATS) : json(route, { statusCode: 403 }, 403);
      case '/api/admin/users':
        return admin ? json(route, ADMIN_USERS) : json(route, { statusCode: 403 }, 403);
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
