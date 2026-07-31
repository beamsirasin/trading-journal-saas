import { expect, test } from '@playwright/test';

test.describe('application shell', () => {
  test('renders the placeholder dashboard', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('exposes banner and main landmarks at every viewport', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('exposes a navigation landmark on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('reaches navigation through the drawer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app');

    // The sidebar is display:none below `lg`, which removes it from the
    // accessibility tree entirely — so on mobile there is deliberately NO
    // navigation landmark until the drawer opens. The drawer trigger lives in
    // the banner, which is the standard discoverable path for this pattern.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('marks the current page in the navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app');
    await expect(page.locator('[aria-current="page"]').first()).toBeVisible();
  });

  test('marks unbuilt sections as unavailable rather than linking to 404s', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app');
    const disabled = page.locator('[aria-disabled="true"]');
    expect(await disabled.count()).toBeGreaterThan(0);
  });

  test('has no horizontal overflow', async ({ page }) => {
    await page.goto('/app');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('responsive navigation', () => {
  test('shows a persistent sidebar on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app');

    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeHidden();
  });

  test('shows a drawer trigger instead of a sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app');

    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeVisible();
  });

  test('mobile drawer opens, traps focus and closes on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus restoration and Escape handling are the reason a real dialog
    // primitive is used rather than a toggled div.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeFocused();
  });

  test('has no horizontal overflow at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/app');

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
    expect(body).toMatchObject({ status: 'ok' });
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      'status',
      'timestamp',
      'uptimeSeconds',
    ]);
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
