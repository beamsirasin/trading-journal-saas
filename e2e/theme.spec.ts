import { expect, test } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

// The `motion` describe block below also visits `/en/app`, which Phase 02
// made a real, database-verified page — storageState is harmless for every
// other test in this file (none of them touch /login or /register), and the
// two motion tests skip outright when no database is configured.
test.use({ storageState: authStateFile });

/**
 * Theme precedence, exercised where it can actually be exercised.
 *
 * These assertions deliberately do not hard-code an expected browser
 * preference. Playwright emulates `prefers-color-scheme: light` by default,
 * so a test asserting "dark by default" would be asserting the emulator, not
 * the product. Each case sets the preference it depends on.
 */

const resolvedColorScheme = () =>
  Promise.resolve(getComputedStyle(document.documentElement).colorScheme);

const STORAGE_KEY = 'trading-os-theme';

test.describe('theme precedence', () => {
  test('2. follows the OS preference when the user has chosen nothing — dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('2. follows the OS preference when the user has chosen nothing — light', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    // Light mode is a complete experience, not a degraded one: an explicit OS
    // preference wins over the dark-first identity.
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
  });

  test('1. an explicitly saved choice beats the OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'dark'],
    );
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('1. a saved light choice beats a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'light'],
    );
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
  });
});

test.describe('theme contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme} action and status tokens meet AA text contrast`, async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key as string, value as string),
        [STORAGE_KEY, theme],
      );
      await page.goto('/en');

      const ratios = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const parse = (name: string) => {
          const value = style.getPropertyValue(name).trim();
          const matched = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
          if (matched === undefined) throw new Error(`${name} must resolve to a hex colour`);
          const hex =
            matched.length === 3 ? [...matched].map((digit) => digit + digit).join('') : matched;
          return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
        };
        const luminance = (rgb: number[]) => {
          const channels = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
        };
        const contrast = (foreground: string, background: string) => {
          const first = luminance(parse(foreground));
          const second = luminance(parse(background));
          return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        };

        return {
          primaryAction: contrast('--primary-foreground', '--primary'),
          warningOnSurface: contrast('--warning', '--surface'),
        };
      });

      expect(ratios.primaryAction).toBeGreaterThanOrEqual(4.5);
      expect(ratios.warningOnSurface).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * The CSS-only path, with JavaScript disabled. next-themes cannot run, so no
 * class is set and the stylesheet alone decides — which is what a user sees
 * before hydration, and what a no-JS user sees permanently.
 *
 * Note on the documented dark fallback: it is NOT separately observable in a
 * browser. The CSS spec dropped `prefers-color-scheme: no-preference`, so
 * Chromium reports `light` when the user has expressed nothing, and the
 * `light` media query matches. The `:root` dark values therefore apply
 * exactly when no class is set and the OS does not ask for light — which is
 * indistinguishable from honouring a dark preference. Asserting a separate
 * "no preference" case would be asserting the emulator, not the product.
 */
test.describe('theme without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the dark palette from CSS alone when the OS prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en');
    expect(await page.evaluate(resolvedColorScheme)).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.className)).not.toContain('dark');
  });

  test('renders the light palette from CSS alone when the OS prefers light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    expect(await page.evaluate(resolvedColorScheme)).toBe('light');
  });

  test('still paints a complete theme rather than unstyled content', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // The dark canvas, #070b14.
    expect(background).toBe('rgb(7, 11, 20)');
  });
});

test.describe('theme toggle', () => {
  test('persists a choice across a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');

    await page.getByRole('button', { name: /change theme/i }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');

    await page.reload();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('offers system as a distinct option', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('button', { name: /change theme/i }).click();

    await expect(page.getByRole('menuitem', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'System' })).toBeVisible();
  });

  test('returning to system re-follows the OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');

    await page.getByRole('button', { name: /change theme/i }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');

    await page.getByRole('button', { name: /change theme/i }).click();
    await page.getByRole('menuitem', { name: 'System' }).click();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
  });

  test('does not flash the wrong theme before hydration', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'dark'],
    );

    await page.goto('/en', { waitUntil: 'commit' });
    // The blocking script next-themes injects runs before first paint, so the
    // class is present as soon as documentElement exists — no light flash.
    await page.waitForFunction(() => document.documentElement?.classList.contains('dark'));
    expect(await page.evaluate(resolvedColorScheme)).toBe('dark');
  });
});

test.describe('motion', () => {
  test('suppresses CSS and Motion animations when reduced motion is requested', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en');

    const duration = await page
      .locator('.animate-rise')
      .first()
      .evaluate((el) => getComputedStyle(el).animationDuration);

    // Chromium serialises this as `1e-05s`, Firefox as `0.01ms` — compare the
    // value, not the spelling.
    const seconds = duration.endsWith('ms')
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration);
    expect(seconds).toBeLessThan(0.001);

    await page.goto('/en/app');
    // The mobile project keeps the desktop sidebar in the DOM but hidden until
    // its drawer opens, so assert branch selection rather than visibility.
    await expect(page.locator('[data-active-indicator="static"]')).toHaveCount(1);
    await expect(page.locator('[data-active-indicator="animated"]')).toHaveCount(0);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const sheetDuration = await page
      .getByRole('dialog')
      .evaluate((el) => getComputedStyle(el).animationDuration);
    const sheetSeconds = sheetDuration.endsWith('ms')
      ? Number.parseFloat(sheetDuration) / 1000
      : Number.parseFloat(sheetDuration);
    expect(sheetSeconds).toBeLessThan(0.001);
  });

  test('animates the drawer when reduced motion is not requested', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');
    await page.getByRole('button', { name: /open navigation menu/i }).click();

    const animationName = await page
      .getByRole('dialog')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toContain('sheet-content-in');
  });
});
