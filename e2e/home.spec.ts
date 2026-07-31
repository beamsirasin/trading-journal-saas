import { expect, test } from '@playwright/test';

const resolvedColorScheme = (): Promise<string> =>
  Promise.resolve(getComputedStyle(document.documentElement).colorScheme);

test.describe('home page', () => {
  test('renders the application shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading OS' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('has no horizontal overflow', async ({ page }) => {
    await page.goto('/');
    // CLAUDE.md §8: no horizontal page overflow at any breakpoint.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('theming', () => {
  test('uses the dark palette when the OS asks for dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('uses the light palette when the OS asks for light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    // Light mode is a complete experience, not a degraded one — an OS light
    // preference is honoured rather than overridden by the dark-first identity.
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
  });

  test('an explicit data-theme override beats the OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    // Simulates what the theme switcher will do in a later phase.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });
});

test.describe('motion', () => {
  test('suppresses animation when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const duration = await page
      .locator('header')
      .evaluate((el) => getComputedStyle(el).animationDuration);
    // Chromium serialises this as `1e-05s`, Firefox as `0.01ms` — compare the
    // value, not the spelling.
    const seconds = duration.endsWith('ms')
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration);
    // CLAUDE.md §8: prefers-reduced-motion must collapse animation, not merely
    // shorten it.
    expect(seconds).toBeLessThan(0.001);
  });
});
