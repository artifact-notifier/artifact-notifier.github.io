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
