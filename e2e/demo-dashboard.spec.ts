import { expect, test, type Page } from '@playwright/test';

/**
 * The demo dashboard, on both routes that render it.
 *
 * `/demo` is public and `/app` is inside the shell, but both mount the same
 * component — so the suite runs the same checks against each and would catch
 * the two drifting apart.
 */
const ROUTES = ['/demo', '/app'] as const;

/**
 * The trade list ships two presentations and hides one with CSS, so both are
 * in the DOM at every viewport. Tests must scope to the active one or they
 * resolve against a `display:none` element and fail confusingly.
 */
const activeTradesView = (page: Page) => page.locator('[data-trades-view]:visible');

/**
 * The date-range radios are `sr-only`; the `<label>` is what a pointer user
 * hits, and Playwright's `.check()` fails actionability on a 1px clipped
 * input. Clicking the label is both what a real user does and what works.
 * Keyboard operation is covered separately.
 */
const selectRange = async (page: Page, label: string) => {
  await page.locator('label').filter({ hasText: label }).click();
};

test.describe('demo dashboard', () => {
  for (const route of ROUTES) {
    test(`${route} is explicitly labelled as demo data`, async ({ page }) => {
      await page.goto(route);

      // The full notice, not just the badge: the badge is hidden below `sm`
      // in the app header, so asserting only on it would pass on desktop and
      // silently stop covering mobile.
      await expect(
        page.getByText(/every figure on this page is fictional demo data/i),
      ).toBeVisible();
      // The stronger claim: it is not presented as an expected result.
      await expect(page.getByText(/not an expected result/i)).toBeVisible();
    });

    test(`${route} shows the required attribution metrics`, async ({ page }) => {
      await page.goto(route);

      for (const label of [
        'Total net P&L',
        'Actual win rate',
        'Actual average R',
        'System expectancy',
        'Actual expectancy',
        'Edge leakage',
        'Discipline score',
        'Execution efficiency',
      ]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      }
    });

    test(`${route} renders the cumulative R chart with an accessible table`, async ({ page }) => {
      await page.goto(route);

      const figure = page.getByRole('figure').filter({ hasText: 'Cumulative R' }).first();
      await expect(figure).toBeVisible();

      // An SVG with ARIA is announced but not explorable; the table is what
      // makes the data actually reachable.
      await expect(figure.getByRole('table', { name: /cumulative r by week/i })).toBeAttached();
      await expect(figure.locator('svg.recharts-surface').first()).toBeVisible();
    });

    test(`${route} shows a mistake summary ranked by cost`, async ({ page }) => {
      await page.goto(route);

      const figure = page.getByRole('figure').filter({ hasText: 'What your mistakes cost' });
      await expect(figure).toBeVisible();
      await expect(figure.getByText('Moved stop').first()).toBeVisible();
      await expect(figure.getByRole('table', { name: /cost in r by mistake/i })).toBeAttached();
    });

    test(`${route} shows both outcome axes on recent trades`, async ({ page }) => {
      await page.goto(route);

      // A recent-trades list showing only P&L would be the conventional
      // journal this product exists to replace. Both axes must be labelled,
      // and the axis name is part of each badge's accessible name because
      // "Win" alone means different things in the two columns.
      const view = activeTradesView(page);
      await expect(view.getByText('EURUSD').first()).toBeVisible();
      await expect(view.getByText('System: Win').first()).toBeVisible();
      await expect(view.getByText('Actual: Loss').first()).toBeVisible();
    });
  }

  test('date range control changes the figures', async ({ page }) => {
    await page.goto('/demo');

    // Targeted by data attribute rather than text: the animated KPI renders
    // its value twice by design, and the same number recurs in the chart
    // caption, so a text locator would be ambiguous rather than wrong.
    const leakage = page.locator('[data-kpi="Edge leakage"]');
    await expect(leakage).toBeVisible();

    // All-time is the default bundle.
    await expect(leakage).toContainText('27.9');

    await selectRange(page, '30 days');
    await expect(leakage).toContainText('8.4');

    await selectRange(page, '90 days');
    await expect(leakage).toContainText('19.3');
  });

  test('account selector filters the trade list', async ({ page }) => {
    await page.goto('/demo');

    const selector = page.getByLabel('Trading account');
    await expect(selector).toBeVisible();

    await selector.selectOption({ label: 'Swing account' });
    await expect(page.getByText(/filtered to swing account/i)).toBeVisible();

    // NAS100 is a swing trade; GBPUSD belongs to the prop account only and
    // must disappear from BOTH presentations, not merely the visible one.
    await expect(activeTradesView(page).getByText('NAS100').first()).toBeVisible();
    await expect(page.getByText('GBPUSD')).toHaveCount(0);
  });

  test('filters are reachable and operable by keyboard', async ({ page }) => {
    await page.goto('/demo');

    const thirtyDays = page.getByRole('radio', { name: 'Last 30 days' });
    await thirtyDays.focus();
    await expect(thirtyDays).toBeFocused();
    await page.keyboard.press('Space');
    await expect(thirtyDays).toBeChecked();
  });

  test('wide trade table scrolls inside its own container', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/app/trades');

    const region = page.getByRole('region', { name: 'Trade history table' });
    await expect(region).toBeVisible();
    // Keyboard-reachable, which a plain overflow-x div is not.
    await expect(region).toHaveAttribute('tabindex', '0');

    const pageOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflows).toBe(false);
  });

  test('mobile shows record cards rather than a squeezed table', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/trades');

    // The table is present but display:none below `md`, which removes it from
    // the accessibility tree — so a screen reader is offered the trades once.
    await expect(page.getByRole('region', { name: 'Trade history table' })).toBeHidden();

    const view = activeTradesView(page);
    await expect(view).toHaveAttribute('data-trades-view', 'cards');
    await expect(view.getByText('EURUSD').first()).toBeVisible();
  });
});

test.describe('demo charts under reduced motion', () => {
  test('renders without animation when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/demo');

    // The chart still renders; it simply does not animate in.
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
    // The segmented control uses the static indicator branch.
    await expect(page.locator('[data-segment-indicator="static"]')).toHaveCount(1);
    await expect(page.locator('[data-segment-indicator="animated"]')).toHaveCount(0);
  });

  test('uses the animated indicator when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/demo');

    await expect(page.locator('[data-segment-indicator="animated"]')).toHaveCount(1);
    await expect(page.locator('[data-segment-indicator="static"]')).toHaveCount(0);
  });
});
