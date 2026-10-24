import { expect, test } from '@playwright/test';
import { horizontalOverflow, mockApi, USER } from './api-mock';

test.describe('logged out', () => {
  test.beforeEach(({ page }) => mockApi(page, { loggedIn: false }));

  test('the root redirects to a visible login page', async ({ page }) => {
    // regression: a 401 on /me used to abort the guarded navigation, leaving only the header
    await page.goto('/');
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /GitHub/ })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('protected pages also land on login', async ({ page }) => {
    await page.goto('/#/preferences');
    await expect(page).toHaveURL(/#\/login$/);
  });
});

test.describe('logged in', () => {
  test.beforeEach(({ page }) => mockApi(page, { loggedIn: true }));

  test('the dashboard lists the followed artifacts', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('org.springframework.boot:spring-boot')).toBeVisible();
    await expect(page.getByText('@angular/core')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('the header fits on one line with every action reachable', async ({ page, isMobile }) => {
    await page.goto('/');
    const nav = page.locator('nav.app-nav');
    const logout = nav.getByRole('button', { name: /Déconnexion/ });
    const preferences = nav.getByRole('link', { name: /Préférences/ });
    await expect(logout).toBeVisible();
    await expect(preferences).toBeVisible();

    const box = (await nav.boundingBox())!;
    for (const el of [logout, preferences]) {
      const b = (await el.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
      // one row: every control vertically inside the bar
      expect(b.y).toBeGreaterThanOrEqual(box.y);
      expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height);
    }
    if (isMobile) {
      // icon only (an SVG: the ⏻ glyph is missing from mobile fonts), no user name
      await expect(logout.locator('svg')).toBeVisible();
      await expect(nav.getByText(USER.name)).toBeHidden();
    } else {
      await expect(nav.getByText(USER.name)).toBeVisible();
    }
  });

  test('preferences open from the header', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('nav.app-nav')
      .getByRole('link', { name: /Préférences/ })
      .click();
    await expect(page).toHaveURL(/#\/preferences$/);
    await expect(page.getByLabel('Email de notification')).toHaveValue(USER.email);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('logging out returns to the login page', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('nav.app-nav')
      .getByRole('button', { name: /Déconnexion/ })
      .click();
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('an expired session goes back to login', async ({ page }) => {
    // regression: the interceptor threw NG0203 on a 401 instead of redirecting
    await page.route('**/api/artifacts', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Unauthorized"}' }),
    );
    await page.goto('/');
    await expect(page).toHaveURL(/#\/login$/);
  });
});

test.describe('admin', () => {
  test('an admin opens the admin page from the header', async ({ page }) => {
    await mockApi(page, { loggedIn: true, admin: true });
    await page.goto('/');
    await page.locator('nav.app-nav').getByRole('link', { name: /Admin/ }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(page.locator('.tile .value').first()).toHaveText('2');
    await expect(page.getByText('cm0000000000000000000001')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('a regular user is sent back to the dashboard', async ({ page }) => {
    await mockApi(page, { loggedIn: true });
    await page.goto('/');
    await expect(page.locator('nav.app-nav').getByRole('link', { name: /Admin/ })).toHaveCount(0);
    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\/$/);
  });
});

test.describe('projects', () => {
  test.beforeEach(({ page }) => mockApi(page, { loggedIn: true }));

  test('imports dependency files into a project', async ({ page }) => {
    await page.goto('/#/import');
    await page.locator('input[type=file][multiple]').setInputFiles([
      {
        name: 'package.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({ dependencies: { '@angular/core': '^22.2.0' }, devDependencies: { vitest: '^5.0.0' } }),
        ),
      },
      {
        name: 'pom.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(
          '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.1.2</version></parent></project>',
        ),
      },
    ]);
    await expect(page.locator('input.label')).toHaveCount(2);
    await expect(page.getByText('org.springframework.boot:spring-boot-starter-parent')).toBeVisible();
    await expect(page.getByText('déjà suivie')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    await page.locator('#project-name').fill('shop-2');
    const importRequest = page.waitForRequest('**/api/projects/import');
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    const body = (await importRequest).postDataJSON();
    // shipped dependencies only (not vitest), and not @angular/core: already followed
    expect(body.follow.map((f: { coordinates: string }) => f.coordinates)).toEqual([
      'org.springframework.boot:spring-boot-starter-parent',
    ]);
    await expect(page).toHaveURL(/#\/projects\/p1$/);
  });

  test('a project page lists its dependencies', async ({ page }) => {
    await page.goto('/');
    await page.locator('.projects-card').getByRole('link', { name: /shop/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: /shop/ })).toBeVisible();
    await expect(page.getByText('vitest')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});

test.describe('after a deployment', () => {
  test('a tab on the previous build reloads instead of failing on a missing lazy chunk', async ({ page }) => {
    await mockApi(page, { loggedIn: true });
    await page.goto('/#/projects/p1');
    await page.getByRole('heading', { level: 1, name: /shop/ }).waitFor();
    // the import page chunk was replaced by the new build: first fetch 404s
    let blocked = 0;
    await page.route('**/chunk-*.js', async (route) => {
      if (blocked++ === 0) return route.fulfill({ status: 404, body: 'Not Found' });
      return route.continue();
    });
    const reloaded = page.waitForEvent('load');
    await page.getByRole('link', { name: /ré-importer/ }).click();
    await reloaded;
    await expect(page).toHaveURL(/#\/import\?project=p1$/);
    await expect(page.getByRole('heading', { name: /Importer un projet/ })).toBeVisible();
  });
});
