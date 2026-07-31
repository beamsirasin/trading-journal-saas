import { expect, test } from '@playwright/test';

test.describe('public home page', () => {
  test('renders the application shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading OS' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('exposes exactly one main landmark', async ({ page }) => {
    await page.goto('/');
    // Two <main> elements give screen reader users an ambiguous structure.
    await expect(page.getByRole('main')).toHaveCount(1);
  });

  test('has no horizontal overflow', async ({ page }) => {
    await page.goto('/');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('skip link is the first focusable element and reveals on focus', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: /skip to content/i });
    await expect(skipLink).toBeFocused();
    // sr-only collapses the element to 1px; focus must restore real size.
    const box = await skipLink.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(20);
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });
});

test.describe('404 handling', () => {
  test('renders a not-found page for an unknown route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
  });
});
