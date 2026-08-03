import { expect, test, type Page } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

// `/en/app*` routes need a real, database-verified session (Phase 02); `/en/demo`
// does not. storageState is harmless for `/en/demo` (a public route, indifferent
// to auth state), so it is set file-wide; the DB-availability skip below is
// applied per-test, only for the routes that actually need it.
test.use({ storageState: authStateFile });

/**
 * The demo dashboard, on the one route that still renders it.
 *
 * `/en/app` used to mount this same fixture-driven component (Phase 1.1),
 * but Phase 3A replaced it with a real, honest dashboard
 * (`src/components/dashboard/empty-trading-dashboard.tsx`) once a genuine
 * trading account exists — no invented P&L, win rate, or chart. `/en/demo`
 * (public, marketing) is the only surviving consumer of `DemoDashboard`,
 * so this array is now a single-element list rather than a two-route
 * parameterization; kept as an array (not inlined) so a future public demo
 * variant can rejoin it the same way `/en/app` used to.
 *
 * PHASE 1.1. Locale-prefixed (`localePrefix: 'always'`) and dashboard-
 * simplified: only four headline KPIs (Net P&L, Actual Win Rate, Actual
 * Average R, Discipline Score) render as top-level cards here now. System
 * Expectancy, Actual Expectancy, Profit Factor, Max Drawdown and Execution
 * Efficiency moved to `/en/app/analytics` — see `src/components/dashboard/
 * demo-dashboard.tsx`'s doc comment and its Vitest coverage in
 * `demo-dashboard.test.tsx`.
 */
const ROUTES = ['/en/demo'] as const;

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

    /**
     * PHASE 1.1 REWRITE. The dashboard shows exactly four headline KPIs now
     * (`dashboard.netPnl` / `actualWinRate` / `actualAverageR` /
     * `disciplineScore` in messages/en.json — note the title-case labels,
     * not "Total net P&L" / "Actual win rate"). System Expectancy, Actual
     * Expectancy, Profit Factor, Max Drawdown and Edge Leakage as a KPI are
     * gone from this surface entirely — the full set now lives on
     * `/en/app/analytics`, asserted separately below.
     */
    test(`${route} shows the four headline KPIs`, async ({ page }) => {
      await page.goto(route);

      for (const label of ['Net P&L', 'Actual Win Rate', 'Actual Average R', 'Discipline Score']) {
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

    /**
     * PHASE 1.1 REWRITE. The dashboard's "Common mistakes" module is no
     * longer a `<figure>` with a chart — it moved to a plain top-3 list
     * (`dashboard.mistakes.*`), with the chart-backed "What your mistakes
     * cost" figure now exclusive to `/en/app/analytics` (asserted below).
     */
    test(`${route} shows the top three mistakes ranked by cost`, async ({ page }) => {
      await page.goto(route);

      const section = page.locator('section[aria-labelledby="mistakes-heading"]');
      await expect(section.getByRole('heading', { name: 'Common mistakes' })).toBeVisible();
      await expect(section.getByRole('listitem')).toHaveCount(3);
      // The costliest mistake in every fixture bundle — see
      // `src/lib/demo/fixtures.ts`.
      await expect(section.getByText('Moved stop').first()).toBeVisible();
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

  /**
   * PHASE 1.1 NEW COVERAGE. The full attribution metric set (System/Actual
   * Expectancy, Profit Factor, Total R, Max Drawdown) that used to render on
   * the dashboard now lives exclusively at `/en/app/analytics` — see
   * `src/app/[locale]/(app)/app/analytics/page.tsx`.
   */
  test('/en/app/analytics shows the full system-vs-actual metric set', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/en/app/analytics');

    for (const label of [
      'Win rate',
      'Average R',
      'Expectancy',
      'Profit factor',
      'Total R',
      'Max drawdown',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    const figure = page.getByRole('figure').filter({ hasText: 'Cumulative R over time' });
    await expect(figure).toBeVisible();
    await expect(figure.getByRole('table', { name: /cumulative r by week/i })).toBeAttached();
  });

  /**
   * PHASE 1.1 NEW COVERAGE. The chart-backed mistake breakdown ("What your
   * mistakes cost") that the dashboard used to show is now exclusive to the
   * analytics page — the dashboard shows only the top-3 plain list (asserted
   * above, per route).
   */
  test('/en/app/analytics shows the full mistake cost breakdown as a figure', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.goto('/en/app/analytics');

    const figure = page.getByRole('figure').filter({ hasText: 'What your mistakes cost' });
    await expect(figure).toBeVisible();
    await expect(figure.getByText('Moved stop').first()).toBeVisible();
    await expect(figure.getByRole('table', { name: /cost in r by mistake/i })).toBeAttached();
  });

  /**
   * PHASE 1.1 REWRITE. Edge Leakage is no longer a standalone KPI card on the
   * dashboard — it survives as the reactive number inside the system-vs-
   * trader insight sentence (`dashboard.systemVsTrader.edgeLeakageInsight`),
   * which is what actually responds to the date-range control now. The
   * underlying fixture values are unchanged (`src/lib/demo/fixtures.ts`), so
   * this keeps the original numbers (27.9 / 8.4 / 19.3) — the test just
   * targets where they now render.
   */
  test('date range control changes the figures', async ({ page }) => {
    await page.goto('/en/demo');

    const insight = page.getByText(/Edge leakage: [\d.]+R not captured by execution\./);
    await expect(insight).toBeVisible();

    // All-time is the default bundle.
    await expect(insight).toContainText('27.9');

    await selectRange(page, '30 days');
    await expect(insight).toContainText('8.4');
    await expect(insight).not.toContainText(/21\.1|16\.7|9\.6|27\.9/);

    await selectRange(page, '90 days');
    await expect(insight).toContainText('19.3');
  });

  test('account selector filters the trade list', async ({ page }) => {
    await page.goto('/en/demo');

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
    await page.goto('/en/demo');

    const thirtyDays = page.getByRole('radio', { name: 'Last 30 days' });
    await thirtyDays.focus();
    await expect(thirtyDays).toBeFocused();
    await page.keyboard.press('Space');
    await expect(thirtyDays).toBeChecked();
  });

  test('wide trade table scrolls inside its own container', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/app/trades');

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
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app/trades');

    // The table is present but display:none below `md`, which removes it from
    // the accessibility tree — so a screen reader is offered the trades once.
    await expect(page.getByRole('region', { name: 'Trade history table' })).toBeHidden();

    const view = activeTradesView(page);
    await expect(view).toHaveAttribute('data-trades-view', 'cards');
    await expect(view.getByText('EURUSD').first()).toBeVisible();
  });

  /**
   * Regression: the KPI grids used `sm:grid-cols-2`, which is a single
   * column below 640px — so on a 375px phone, eight short, uniform cards
   * (a label, one number, one line of hint text) rendered as eight
   * full-width rows, turning a five-second glance into a long, sparse
   * scroll. Fixed by starting at two columns from the smallest viewport.
   * Asserted via each card's `data-kpi` attribute and comparing row
   * position, which is what actually distinguishes "two-up" from "stacked"
   * — text content alone would not catch a regression back to one column.
   */
  test('renders KPI cards two-up even at a 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/demo');

    // `data-kpi` carries the exact translated label (`dashboard.netPnl` etc
    // in messages/en.json) — title-case now, not the old "Total net P&L".
    const first = page.locator('[data-kpi="Net P&L"]');
    const second = page.locator('[data-kpi="Actual Win Rate"]');
    const third = page.locator('[data-kpi="Actual Average R"]');

    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    const thirdBox = await third.boundingBox();

    // Same row: equal top, second card to the right of the first. A manual
    // tolerance rather than `toBeCloseTo`, whose precision digits round to
    // whole pixels — tighter than genuine cross-project rendering variance.
    expect(Math.abs((firstBox?.y ?? 0) - (secondBox?.y ?? -100))).toBeLessThan(5);
    expect(secondBox?.x ?? 0).toBeGreaterThan(firstBox?.x ?? 0);

    // Next row: a card three positions later has wrapped down, not sideways.
    expect(thirdBox?.y ?? 0).toBeGreaterThan((firstBox?.y ?? 0) + 20);
  });
});

test.describe('demo charts under reduced motion', () => {
  test('renders without animation when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en/demo');

    // The chart still renders; it simply does not animate in.
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
    // The segmented control uses the static indicator branch.
    await expect(page.locator('[data-segment-indicator="static"]')).toHaveCount(1);
    await expect(page.locator('[data-segment-indicator="animated"]')).toHaveCount(0);
  });

  test('uses the animated indicator when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/en/demo');

    await expect(page.locator('[data-segment-indicator="animated"]')).toHaveCount(1);
    await expect(page.locator('[data-segment-indicator="static"]')).toHaveCount(0);
  });
});
