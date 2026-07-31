import { expect, test } from '@playwright/test';

/** Representative viewports. Wide desktop catches max-width regressions. */
const VIEWPORTS = [
  { name: 'mobile portrait', width: 320, height: 720 },
  { name: 'large phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide desktop', width: 1920, height: 1080 },
] as const;

const PUBLIC_ROUTES = ['/', '/pricing', '/demo', '/login', '/register'] as const;
const APP_ROUTES = [
  '/app',
  '/app/trades',
  '/app/strategies',
  '/app/analytics',
  '/app/settings',
] as const;

test.describe('landing page', () => {
  test('renders the major sections', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/strategy/i);

    for (const heading of [
      /profit does not prove/i,
      /two sets of books/i,
      /six steps/i,
      /does one thing properly/i,
      /three plans, one free trial/i,
      /what this product does/i,
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
  });

  test('makes the system-versus-trader distinction visible', async ({ page }) => {
    await page.goto('/');

    // The product thesis. If these labels disappear the page has stopped
    // making the argument the whole product rests on.
    await expect(page.getByText('Edge leakage').first()).toBeVisible();
    await expect(page.getByText('Discipline score').first()).toBeVisible();
    await expect(page.getByText(/execution efficiency/i).first()).toBeVisible();
  });

  test('labels its figures as demo data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Demo data').first()).toBeVisible();
    await expect(page.getByText(/not a performance claim/i)).toBeVisible();
  });

  test('describes the manual, TradingView-link workflow accurately', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /paste a tradingview chart link/i }),
    ).toBeVisible();
    // A stored link, not an integration. `.first()` because the FAQ makes the
    // same point again further down the page, which is deliberate.
    await expect(page.getByText(/nothing is read from tradingview/i).first()).toBeVisible();
    await expect(page.getByText(/not included, and not planned/i).first()).toBeVisible();
  });

  test('exposes exactly one main landmark', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main')).toHaveCount(1);
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

test.describe('public calls to action', () => {
  test('primary CTAs point at real routes', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: /start free trial/i }).first()).toHaveAttribute(
      'href',
      '/register',
    );
    await expect(page.getByRole('link', { name: /see the demo dashboard/i })).toHaveAttribute(
      'href',
      '/demo',
    );
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
    await page.goto('/');

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
test.describe('header layout at the md breakpoint', () => {
  test('the wordmark and every nav link render on a single line at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    const wordmark = page.getByRole('banner').getByText('Trading OS', { exact: true });
    const wordmarkBox = await wordmark.boundingBox();
    // The wordmark span has no fixed height, so a wrapped two-line label
    // shows up directly as roughly double a single line's height. 30px
    // comfortably separates the two cases without hard-coding line-height.
    expect(wordmarkBox?.height ?? 0, 'wordmark should be one line, not two').toBeLessThan(30);

    // Nav links are `h-9` (a fixed 36px flex container), so a wrapped label
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

  test('has no horizontal overflow at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
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
    await page.goto('/');

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
    await page.goto('/');

    const trigger = page.getByRole('button', { name: /open navigation menu/i });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('closes after following a link', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Pricing' }).click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('keeps the trigger and its links at 44px touch targets', async ({ page }) => {
    await page.goto('/');

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
  test('renders a not-found page for an unknown route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
  });
});

test.describe('robots policy', () => {
  test('disallows crawling while the product is a preview', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Disallow: /');
  });

  test('public pages carry a noindex directive', async ({ page }) => {
    await page.goto('/');
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /noindex/);
  });
});
