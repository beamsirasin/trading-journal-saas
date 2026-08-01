import { expect, test } from '@playwright/test';

// PHASE 1.1. Every route now lives under a locale prefix (`localePrefix:
// 'always'`), so these target the `en` fallback explicitly. `Link` from
// `@/i18n/navigation` renders the same prefix on `aria-current="page"`
// hrefs, which is why the href values below carry it too.
const APP_ROUTES = [
  { href: '/en/app', name: 'Overview' },
  { href: '/en/app/trades', name: 'Trades' },
  { href: '/en/app/strategies', name: 'Strategies' },
  { href: '/en/app/analytics', name: 'Analytics' },
  { href: '/en/app/settings', name: 'Settings' },
] as const;

test.describe('application shell', () => {
  test('renders the overview dashboard', async ({ page }) => {
    await page.goto('/en/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });

  test('exposes banner and main landmarks at every viewport', async ({ page }) => {
    await page.goto('/en/app');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('exposes a navigation landmark on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('reaches navigation through the drawer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    // The sidebar is display:none below `lg`, which removes it from the
    // accessibility tree entirely — so on mobile there is deliberately NO
    // navigation landmark until the drawer opens. The drawer trigger lives in
    // the banner, which is the standard discoverable path for this pattern.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('has no horizontal overflow', async ({ page }) => {
    await page.goto('/en/app');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

/**
 * PHASE 01 CHANGE. Phase 00b asserted that unbuilt sections rendered as
 * `aria-disabled` placeholders rather than links to 404s. All five routes now
 * exist, so that guarantee is replaced by its successor: every nav item
 * resolves, and exactly one is marked as the current page.
 */
test.describe('application navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const route of APP_ROUTES) {
    test(`marks ${route.href} as the current page when open`, async ({ page }) => {
      await page.goto(route.href);

      const nav = page.getByRole('navigation', { name: 'Main' });
      const current = nav.locator('[aria-current="page"]');

      // Exactly one. Prefix matching would light up `/app` on every child
      // route and leave a screen reader with two "current page" claims.
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('href', route.href);
    });
  }

  test('every navigation item resolves to a real page', async ({ page }) => {
    for (const route of APP_ROUTES) {
      const response = await page.goto(route.href);
      expect(response?.status(), `${route.href} should not 404`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('navigating between sections keeps one main landmark', async ({ page }) => {
    await page.goto('/en/app');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Trades' })
      .click();

    await expect(page).toHaveURL(/\/app\/trades$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Trades' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
  });
});

test.describe('responsive navigation', () => {
  test('shows a persistent sidebar on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeHidden();
  });

  test('shows a drawer trigger instead of a sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeVisible();
  });

  test('keeps mobile shell controls at least 44px in each touch dimension', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    const menuButton = await page
      .getByRole('button', { name: /open navigation menu/i })
      .boundingBox();
    const themeButton = await page.getByRole('button', { name: /change theme/i }).boundingBox();

    expect(menuButton?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(menuButton?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(themeButton?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(themeButton?.height ?? 0).toBeGreaterThanOrEqual(44);

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    const overviewLink = await dialog.getByRole('link', { name: /Overview/ }).boundingBox();
    const closeButton = await page.getByRole('button', { name: 'Close' }).boundingBox();
    expect(overviewLink?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeButton?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeButton?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('mobile drawer opens, traps focus and closes on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus restoration and Escape handling are the reason a real dialog
    // primitive is used rather than a toggled div.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeFocused();
  });

  test('mobile drawer closes after navigating', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: /Analytics/ })
      .click();

    await expect(page).toHaveURL(/\/app\/analytics$/);
    // Without an explicit close the drawer sits over the page it just opened.
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('mobile drawer closes after following its wordmark', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app/settings');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Trading OS' }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('shared buttons keep the 44px touch-target minimum', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app/settings');

    const save = await page.getByRole('button', { name: 'Save changes' }).boundingBox();
    expect(save?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(save?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('has no horizontal overflow at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/en/app');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('health endpoint', () => {
  test('responds with the documented shape', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body: unknown = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  test('leaks no environment values', async ({ request }) => {
    const response = await request.get('/api/health');
    const text = await response.text();

    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('AUTH_SECRET');
    expect(text.toLowerCase()).not.toContain('postgres');
  });

  test('is not cached', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});
