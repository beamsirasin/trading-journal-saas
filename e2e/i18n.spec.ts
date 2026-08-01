import { expect, test, type Page } from '@playwright/test';

/**
 * Localization (Phase 1.1).
 *
 * Locale is resolved by `createMiddleware(routing)` in `src/middleware.ts`
 * with precedence: explicit choice (persisted in the `NEXT_LOCALE` cookie) >
 * cookie > `Accept-Language` > `en` fallback (see `src/i18n/routing.ts` —
 * `locales: ['en', 'th']`, `defaultLocale: 'en'`, `localePrefix: 'always'`).
 *
 * The switcher itself (`src/components/shell/language-switcher.tsx`) is an
 * icon-only button whose accessible name is `${label}: ${currentLanguage}`
 * ("Language: English" / "ภาษา: ไทย" — never a flag), opening a Radix
 * dropdown with "English" / "ไทย" items. It renders in the public header,
 * the app shell header, both mobile drawers, and the settings page — always
 * visible, with no responsive hiding, so `page.getByRole('banner')` reliably
 * scopes to the one instance that is always mounted (the drawer's copy only
 * exists in the DOM once its Sheet is open).
 */

const languageTrigger = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: /language|ภาษา/i });

test.describe('locale rendering', () => {
  // Pinned to a desktop size regardless of project: the site nav this test
  // checks is `hidden lg:flex` (see `MarketingHeader`), so on the
  // `mobile-chrome` project's viewport it would not be in the accessibility
  // tree at all and the test would be asserting the wrong thing.
  test('/en renders English nav and hero content', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en');
    await expect(
      page.getByRole('banner').getByRole('navigation', { name: 'Site' }).getByRole('link', {
        name: 'Pricing',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: /know whether it was the strategy or you/i }),
    ).toBeVisible();
  });

  test('/th renders Thai nav and hero content', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/th');
    // Thai nav labels from messages/th.json (`nav.pricing`, `nav.demo`).
    await expect(
      page.getByRole('banner').getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('link', {
        name: 'ราคา',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /รู้ให้ชัดว่าปัญหาอยู่ที่กลยุทธ์ หรือที่ตัวคุณ/,
      }),
    ).toBeVisible();
  });

  test('sets html[lang] to match the URL locale', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goto('/th');
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');

    await page.goto('/en/app/trades');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goto('/th/app/trades');
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  });
});

test.describe('language switcher', () => {
  test('has an accessible name stating the language, not a flag or icon alone', async ({
    page,
  }) => {
    await page.goto('/en');
    const trigger = languageTrigger(page);
    await expect(trigger).toBeVisible();

    const name = await trigger.getAttribute('aria-label');
    expect(name).toBeTruthy();
    expect(name).toMatch(/language/i);
    expect(name).toContain('English');
  });

  test('is reachable and operable by keyboard: Enter opens it, arrow keys move through options', async ({
    page,
  }) => {
    await page.goto('/en');
    const trigger = languageTrigger(page);

    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    const english = page.getByRole('menuitem', { name: 'English' });
    const thai = page.getByRole('menuitem', { name: 'ไทย' });
    await expect(english).toBeVisible();
    await expect(thai).toBeVisible();

    // Radix focuses the first item on open; arrow keys cycle the rest.
    await page.keyboard.press('ArrowDown');
    await expect(thai).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('opens with Space as well as Enter', async ({ page }) => {
    await page.goto('/en');
    const trigger = languageTrigger(page);
    await trigger.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('switching locale preserves the current route', async ({ page }) => {
    await page.goto('/en/app/trades');

    await languageTrigger(page).click();
    await page.getByRole('menuitem', { name: 'ไทย' }).click();

    await expect(page).toHaveURL(/\/th\/app\/trades$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  });

  test('persists the switched locale across a reload via the NEXT_LOCALE cookie', async ({
    page,
    context,
  }) => {
    await page.goto('/en');
    await languageTrigger(page).click();
    await page.getByRole('menuitem', { name: 'ไทย' }).click();
    await expect(page).toHaveURL(/\/th$/);

    const cookies = await context.cookies();
    const localeCookie = cookies.find((cookie) => cookie.name === 'NEXT_LOCALE');
    expect(localeCookie?.value).toBe('th');

    await page.reload();
    await expect(page).toHaveURL(/\/th$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');

    // A fresh page in the same context shares cookies. Requesting the
    // locale-agnostic root should resolve to the previously chosen locale
    // rather than the default, proving the cookie — not just the URL — is
    // what is carrying the choice.
    const second = await context.newPage();
    await second.goto('/');
    await expect(second).toHaveURL(/\/th$/);
    await second.close();
  });
});

test.describe('locale detection precedence', () => {
  /**
   * Both `locale` (Playwright's own Accept-Language/`navigator.language`
   * emulation) and `extraHTTPHeaders` are set together: `extraHTTPHeaders`
   * alone was not reliably honoured by Chromium for this specific header in
   * practice (verified directly against the built server with `curl -H
   * "Accept-Language: th"`, which the middleware resolves to `/th`
   * correctly — so the gap was in the browser-context header override, not
   * `src/middleware.ts`). `locale` is the officially-emulated mechanism and
   * is what actually lands on the wire here.
   */
  test('falls back to en when Accept-Language is absent or does not match a supported locale', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await context.close();
  });

  test('resolves to th from an Accept-Language header when there is no cookie', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: 'th-TH',
      extraHTTPHeaders: { 'accept-language': 'th' },
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/th$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await context.close();
  });

  test('an explicit NEXT_LOCALE cookie beats Accept-Language', async ({ browser }) => {
    const context = await browser.newContext({
      locale: 'th-TH',
      extraHTTPHeaders: { 'accept-language': 'th' },
    });
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'en',
        url: 'http://127.0.0.1:3100',
      },
    ]);
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await context.close();
  });
});

test.describe('no redirect loops or hydration mismatches', () => {
  test('settles quickly with no console hydration warnings across both locales', async ({
    page,
  }) => {
    const consoleIssues: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleIssues.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleIssues.push(error.message);
    });

    for (const route of ['/', '/en', '/th', '/en/app/trades', '/th/app/trades', '/en/pricing']) {
      const response = await page.goto(route, { timeout: 10_000 });
      expect(response?.status(), `${route} should respond`).toBeLessThan(400);
    }

    const hydrationIssues = consoleIssues.filter((text) => /hydration/i.test(text));
    expect(hydrationIssues, hydrationIssues.join('\n')).toEqual([]);
  });
});
