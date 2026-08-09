import { expect, test, type Page } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

/**
 * Localization (Phase 1.1).
 *
 * Locale is resolved by `createMiddleware(routing)` in `src/proxy.ts`
 * (renamed from `middleware.ts` in Phase 02) with precedence: explicit
 * choice (persisted in the `NEXT_LOCALE` cookie) > cookie > `Accept-Language`
 * > `en` fallback (see `src/i18n/routing.ts` — `locales: ['en', 'th']`,
 * `defaultLocale: 'en'`, `localePrefix: 'always'`).
 *
 * The switcher itself (`src/components/shell/language-switcher.tsx`) is an
 * icon-only button whose accessible name is `${label}: ${currentLanguage}`
 * ("Language: English" / "ภาษา: ไทย" — never a flag), opening a Radix
 * dropdown with "English" / "ไทย" items. It renders in the public header,
 * the app shell header, both mobile drawers, and the settings page — always
 * visible, with no responsive hiding, so `page.getByRole('banner')` reliably
 * scopes to the one instance that is always mounted (the drawer's copy only
 * exists in the DOM once its Sheet is open).
 *
 * A handful of tests below also touch `/app*` routes, which Phase 02 made
 * real, database-verified pages — those use the authenticated storage state
 * `e2e/auth.setup.ts` produces and skip outright when no database is
 * configured (`hasE2eDatabase`); every purely public-route test in this file
 * is unaffected either way.
 */
test.use({ storageState: authStateFile });

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

  test('/th/app localizes the real Dashboard overview', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/th/app');

    // E2E_USER_A is pre-onboarded so the localized real Dashboard is reached.
    await expect(page.getByRole('heading', { level: 1, name: 'ภาพรวม' })).toBeVisible();
    await expect(page.getByText('ตอนนี้เกิดอะไรขึ้นกับการเทรดของคุณบ้าง')).toBeVisible();
    // Scoped to the dashboard's own labelled region rather than `.first()`:
    // `TradingAccountIndicator` in the header repeats the same account mode
    // text and is hidden below the `sm` breakpoint (`hidden sm:flex`), so an
    // unscoped `.first()` can resolve to that invisible copy on a mobile
    // viewport (see `e2e/onboarding.spec.ts` for the same fix).
    const accountRegion = page.getByRole('region', { name: 'สรุปบัญชีเทรดที่ใช้งานอยู่' });
    await expect(accountRegion.getByText('บัญชีจริง', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'เทรดล่าสุด' }).getByText('ยังไม่มีเทรดในบัญชีนี้'),
    ).toBeVisible();
    await expect(page.getByText('Overview', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
  });

  test('/th/app/analytics localizes real analytics sections and empty Mistakes', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/th/app/analytics');

    await expect(
      page.getByRole('heading', { level: 2, name: 'ผลการทำงานของระบบและเทรดเดอร์' }),
    ).toBeVisible();
    await expect(page.getByText('ไม่มีข้อผิดพลาดที่บันทึกไว้')).toBeVisible();
    await expect(page.getByText('No mistakes recorded', { exact: true })).toHaveCount(0);
  });

  test('sets html[lang] to match the URL locale', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
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
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/en/app/trades');

    await languageTrigger(page).click();
    await page.getByRole('menuitem', { name: 'ไทย' }).click();

    await expect(page).toHaveURL(/\/th\/app\/trades$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  });

  test('switching locale preserves query parameters without changing their order or values', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/en/app/trades?account=acc-live&range=30d');

    await languageTrigger(page).click();
    await page.getByRole('menuitem', { name: 'ไทย' }).click();

    await expect(page).toHaveURL(/\/th\/app\/trades\?account=acc-live&range=30d$/);
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

    const publicRoutes = ['/', '/en', '/th', '/en/pricing'];
    const databaseRoutes = ['/en/app/trades', '/th/app/trades'];
    for (const route of [...publicRoutes, ...(hasE2eDatabase ? databaseRoutes : [])]) {
      const response = await page.goto(route, { timeout: 10_000 });
      expect(response?.status(), `${route} should respond`).toBeLessThan(400);
    }

    const hydrationIssues = consoleIssues.filter((text) => /hydration/i.test(text));
    expect(hydrationIssues, hydrationIssues.join('\n')).toEqual([]);
  });
});

test.describe('localized metadata', () => {
  test('uses locale-prefixed canonical, route-specific alternates and valid Open Graph locales', async ({
    page,
  }) => {
    await page.goto('/th/pricing');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/th\/pricing$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      /\/en\/pricing$/,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="th"]')).toHaveAttribute(
      'href',
      /\/th\/pricing$/,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      /\/th\/pricing$/,
    );
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'th_TH');
  });

  test('localizes the app overview title', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/th/app');
    await expect(page).toHaveTitle(/^ภาพรวม · Trading OS$/);
  });
});

test.describe('Thai responsive typography', () => {
  test('gives wrapped Thai headings script-appropriate line height and tracking', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/th');

    const typography = await page.getByRole('heading', { level: 1 }).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        letterSpacingPx:
          style.letterSpacing === 'normal' ? 0 : Number.parseFloat(style.letterSpacing),
      };
    });

    expect(typography.lineHeight / typography.fontSize).toBeGreaterThanOrEqual(1.2);
    expect(typography.letterSpacingPx).toBe(0);
  });

  test('keeps Thai desktop navigation inside the header at 1024px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/th');

    const header = page.getByRole('banner');
    const headerBox = await header.boundingBox();
    const targets = header.locator('button:visible');

    for (let index = 0; index < (await targets.count()); index += 1) {
      const box = await targets.nth(index).boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(headerBox?.x ?? 0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (headerBox?.x ?? 0) + (headerBox?.width ?? 0) + 1,
      );
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of [320, 768] as const) {
    test(`keeps Thai pricing cards and CTAs contained at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1024 });
      await page.goto('/th/pricing');

      const cards = page.locator('[aria-labelledby^="plan-"]');
      await expect(cards).toHaveCount(3);
      for (let index = 0; index < (await cards.count()); index += 1) {
        const contained = await cards
          .nth(index)
          .evaluate(
            (card) =>
              card.scrollWidth <= card.clientWidth && card.scrollHeight <= card.clientHeight,
          );
        expect(contained, `Thai pricing card ${index} should not clip or overflow`).toBe(true);
        const ctaBox = await cards.nth(index).getByRole('link').boundingBox();
        expect(ctaBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }
});
