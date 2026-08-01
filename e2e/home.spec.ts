import { expect, test } from '@playwright/test';

/** Representative viewports. Wide desktop catches max-width regressions. */
const VIEWPORTS = [
  { name: 'mobile portrait', width: 320, height: 720 },
  { name: 'large phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide desktop', width: 1920, height: 1080 },
] as const;

/**
 * PHASE 1.1. Every route now lives under a locale prefix
 * (`localePrefix: 'always'` — see `src/i18n/routing.ts`), so these routes
 * cover both supported locales. Locale switching itself is covered
 * separately in `e2e/i18n.spec.ts`.
 */
const LOCALES = ['en', 'th'] as const;
const PUBLIC_PATHS = ['', '/pricing', '/demo', '/login', '/register'] as const;
const APP_PATHS = [
  '/app',
  '/app/trades',
  '/app/strategies',
  '/app/analytics',
  '/app/settings',
] as const;
const PUBLIC_ROUTES = LOCALES.flatMap((locale) =>
  PUBLIC_PATHS.map((pathname) => `/${locale}${pathname}`),
);
const APP_ROUTES = LOCALES.flatMap((locale) =>
  APP_PATHS.map((pathname) => `/${locale}${pathname}`),
);

test.describe('landing page', () => {
  test('renders the major sections', async ({ page }) => {
    await page.goto('/en');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/strategy/i);

    // PHASE 1.1 REWRITE. Copy comes from `messages/en.json` now; the old
    // "two sets of books" / "three planned tiers, one planned trial" headings
    // no longer exist (see `attribution.title` / `pricing.title`). The CTA
    // section heading is new coverage, matching `src/app/[locale]/(public)/page.test.tsx`.
    for (const heading of [
      /profit does not prove/i,
      /one comparison, the whole product/i,
      /six steps/i,
      /does one thing properly/i,
      /three plans, one free trial/i,
      /what this product does/i,
      /which problem you actually have/i,
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
  });

  test('makes the system-versus-trader distinction visible', async ({ page }) => {
    await page.goto('/en');

    // The product thesis. If these labels disappear the page has stopped
    // making the argument the whole product rests on.
    await expect(page.getByText('Edge leakage').first()).toBeVisible();
    await expect(page.getByText('Discipline score').first()).toBeVisible();
    await expect(page.getByText(/execution efficiency/i)).toHaveCount(0);
  });

  test('labels its figures as demo data', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByText('Demo data').first()).toBeVisible();
    await expect(page.getByText(/not a performance claim/i)).toBeVisible();
  });

  /**
   * PHASE 1.1 REWRITE. "Paste a TradingView chart link" was never a real
   * heading in the current copy and "not included, and not planned" does not
   * appear anywhere in `messages/en.json` — both assertions were stale even
   * before the locale prefix broke routing. The workflow step ("Attach a
   * TradingView link") and the FAQ answer are what actually make this point
   * now (`workflow.steps.attach.title`, `faq.items.tradingViewLinks.answer`,
   * `features.excludedNote`).
   */
  test('describes the manual, TradingView-link workflow accurately', async ({ page }) => {
    await page.goto('/en');

    await expect(page.getByRole('heading', { name: /attach a tradingview link/i })).toBeVisible();

    // "Nothing is read from TradingView" only exists in the FAQ answer, and
    // native <details> renders it collapsed until opened — clicking the
    // question (bubbles to the enclosing <summary>) is what a real reader
    // does to reach it.
    await page.getByRole('heading', { name: /can i attach tradingview charts/i }).click();
    await expect(page.getByText(/nothing is read from tradingview/i).first()).toBeVisible();

    await expect(page.getByText(/not included in this release/i).first()).toBeVisible();
  });

  test('exposes exactly one main landmark', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('main')).toHaveCount(1);
  });

  test('skip link is the first focusable element and reveals on focus', async ({ page }) => {
    await page.goto('/en');
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: /skip to content/i });
    await expect(skipLink).toBeFocused();
    // sr-only collapses the element to 1px; focus must restore real size.
    const box = await skipLink.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(20);
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await page.goto('/en');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });
});

test.describe('public calls to action', () => {
  test('primary CTAs point at real routes', async ({ page }) => {
    await page.goto('/en');

    // Suffix match rather than an exact string: `Link` from `@/i18n/navigation`
    // prepends the active locale segment, so the rendered href is `/en/register`.
    await expect(page.getByRole('link', { name: /preview registration/i }).first()).toHaveAttribute(
      'href',
      /\/register$/,
    );
    await expect(page.getByRole('link', { name: /see the demo dashboard/i })).toHaveAttribute(
      'href',
      /\/demo$/,
    );
  });

  test('does not claim that registration or a trial is active', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('link', { name: /start free trial/i })).toHaveCount(0);
    await expect(page.getByText(/registration is not live yet/i).first()).toBeVisible();
  });

  test('keeps Recharts out of the static landing route', async ({ page }) => {
    const scripts: Promise<string>[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/_next/static/') && response.url().endsWith('.js')) {
        scripts.push(response.text().catch(() => ''));
      }
    });

    await page.goto('/en', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-static-cumulative-r]')).toBeVisible();
    await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
    const bodies = await Promise.all(scripts);
    expect(bodies.some((script) => script.includes('recharts'))).toBe(false);
  });

  test('every public route responds 200', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should respond 200`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('desktop header navigation reaches pricing and the demo', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en');

    const nav = page.getByRole('banner').getByRole('navigation', { name: 'Site' });
    await nav.getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);

    await page
      .getByRole('banner')
      .getByRole('navigation', { name: 'Site' })
      .getByRole('link', { name: 'Demo' })
      .click();
    await expect(page).toHaveURL(/\/demo$/);
  });
});

/**
 * Regression coverage for a real bug: at exactly 768px (the `md` breakpoint
 * where the desktop nav first appears), the header's unwrapped content sits
 * within a fraction of a pixel of the available width. Flexbox assigns the
 * whole shrink deficit to whichever text node can still compress, and
 * without explicit protection that was the brand wordmark ("Trading OS"
 * wrapping to "Trading" / "OS") and then, once that was fixed, the first nav
 * link long enough to wrap ("How it works" splitting mid-phrase). A plain
 * "no horizontal overflow" check does not catch this: wrapping shrinks the
 * element rather than overflowing the page, so the bug is invisible to that
 * assertion and only shows up as a doubled line height.
 */
test.describe('header layout at the navigation breakpoint', () => {
  test('the wordmark and every nav link render on a single line at 1024px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/en');

    const wordmark = page.getByRole('banner').getByText('Trading OS', { exact: true });
    const wordmarkBox = await wordmark.boundingBox();
    // The wordmark span has no fixed height, so a wrapped two-line label
    // shows up directly as roughly double a single line's height. 30px
    // comfortably separates the two cases without hard-coding line-height.
    expect(wordmarkBox?.height ?? 0, 'wordmark should be one line, not two').toBeLessThan(30);

    // Nav links are fixed-height flex targets, so a wrapped label
    // would clip rather than grow the box — bounding-box height cannot
    // distinguish the two states here. `white-space` is the actual CSS
    // property the fix relies on, so it is what regresses if the class is
    // ever removed.
    const nav = page.getByRole('banner').getByRole('navigation', { name: 'Site' });
    for (const label of ['Features', 'How it works', 'Pricing', 'Demo']) {
      const whiteSpace = await nav
        .getByRole('link', { name: label })
        .evaluate((el) => getComputedStyle(el).whiteSpace);
      expect(whiteSpace, `"${label}" should be whitespace-nowrap`).toBe('nowrap');
    }
  });

  test('keeps desktop navigation targets at least 44px high', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en');

    const links = page
      .getByRole('banner')
      .getByRole('navigation', { name: 'Site' })
      .getByRole('link');
    for (let index = 0; index < (await links.count()); index += 1) {
      expect((await links.nth(index).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('has no horizontal overflow at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('marketing mobile menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
  });

  test('opens, traps focus, and closes on Escape restoring focus', async ({ page }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: /open navigation menu/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus is inside the dialog, and Tab keeps it there.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focusInDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(focusInDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('is operable by keyboard alone', async ({ page }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: /open navigation menu/i });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('closes after following a link', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Pricing' }).click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('closes after following the drawer wordmark', async ({ page }) => {
    await page.goto('/en/pricing');
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Trading OS' }).click();

    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('keeps the trigger and its links at 44px touch targets', async ({ page }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: /open navigation menu/i });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const dialog = page.getByRole('dialog');
    const links = dialog.getByRole('link');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box?.height ?? 0, `drawer link ${index} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps the focused skip link and footer navigation at 44px', async ({ page }) => {
    await page.goto('/en');
    await page.keyboard.press('Tab');

    const skipBox = await page.getByRole('link', { name: /skip to content/i }).boundingBox();
    expect(skipBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(skipBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const footerLinks = page.getByRole('contentinfo').getByRole('link');
    for (let index = 0; index < (await footerLinks.count()); index += 1) {
      const box = await footerLinks.nth(index).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('no horizontal overflow', () => {
  for (const viewport of VIEWPORTS) {
    test(`public routes at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of PUBLIC_ROUTES) {
        await page.goto(route);
        const overflows = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflows, `${route} overflows at ${viewport.width}px`).toBe(false);
      }
    });

    test(`application routes at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of APP_ROUTES) {
        await page.goto(route);
        const overflows = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflows, `${route} overflows at ${viewport.width}px`).toBe(false);
      }
    });
  }
});

test.describe('404 handling', () => {
  /**
   * `src/app/[locale]/[...rest]/page.tsx` is a catch-all that calls
   * `notFound()` unconditionally, so a genuinely unmatched path still enters
   * the `[locale]` subtree and throws into this segment's own translated
   * `not-found.tsx` — never Next's generic, unstyled, English-only root
   * `_not-found` boundary. Checked in both locales because the whole point
   * is that the 404 a real visitor reaches is translated, not just present.
   */
  test('renders the translated not-found page for an unknown route', async ({ page }) => {
    const enResponse = await page.goto('/en/this-route-does-not-exist');
    expect(enResponse?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/page not found/i);

    const thResponse = await page.goto('/th/this-route-does-not-exist');
    expect(thResponse?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ไม่พบหน้านี้');
  });
});

test.describe('robots policy', () => {
  test('disallows crawling while the product is a preview', async ({ request }) => {
    // Excluded from the locale middleware matcher (`src/middleware.ts`), so
    // this stays unprefixed — a crawler requests it at the bare path.
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Disallow: /');
  });

  test('public pages carry a noindex directive', async ({ page }) => {
    await page.goto('/en');
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /noindex/);
  });
});
