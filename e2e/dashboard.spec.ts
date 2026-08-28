import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
  trades,
  tradingAccounts,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

function daysAgo(days: number, hour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, hour));
}

async function provisionDashboardUser(prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await provisionVerifiedUser(testUrl, {
    email,
    password: 'Correct-Horse9!',
    name: 'E2E Dashboard Tester',
  });
  const seeded = await seedDashboardData(user.id);
  return { ...user, ...seeded };
}

interface SeededDashboardIds {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly strategyId: string;
  readonly setupId: string;
}

async function seedDashboardData(userId: string): Promise<SeededDashboardIds> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      workspaces,
      tradingAccounts,
      strategies,
      strategyVersions,
      setups,
      strategySetupVersions,
      tradeExits,
      trades,
    },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Dashboard E2E workspace missing');
    const workspaceId = workspace.id;
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Dashboard E2E Account missing');

    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: workspace.id })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('Dashboard E2E Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 1,
        name: 'Pinned Momentum v1',
      })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('Dashboard E2E Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: workspace.id, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('Dashboard E2E Setup insert failed');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        name: 'Pinned Opening Retest',
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('Dashboard E2E Setup Version insert failed');

    const framework = {
      workspaceId: workspace.id,
      tradingAccountId: account.id,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      setupVersionId: setupVersion.id,
      direction: 'long' as const,
      plannedEntry: '100.0000000000',
      plannedStop: '99.0000000000',
      plannedTarget: '102.0000000000',
      plannedR: '2.0000',
    };
    const traderFields = (exitedAt: Date, actualR: string, traderOutcome: 'win' | 'loss') => ({
      status: 'closed' as const,
      actualResultMode: 'money' as const,
      actualEntry: '100.0000000000',
      actualInitialStop: '99.0000000000',
      actualInitialRiskMinor: 100n,
      enteredAt: new Date(exitedAt.getTime() - 60 * 60 * 1000),
      actualExit: '101.0000000000',
      netPnlMinor: actualR.startsWith('-') ? -100n : 100n,
      exitedAt,
      actualR,
      traderOutcome,
    });
    const systemFields = (
      systemExitedAt: Date,
      systemR: string,
      systemOutcome: 'win' | 'loss',
    ) => ({
      systemStatus: 'resolved' as const,
      systemResolutionKind: 'price_exit' as const,
      systemExitPrice: '102.0000000000',
      systemExitedAt,
      systemExitReason: 'target_hit' as const,
      systemResolvedAt: systemExitedAt,
      systemR,
      systemOutcome,
    });

    async function insertTrade(values: typeof trades.$inferInsert): Promise<string> {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(trades).values(values).returning({ id: trades.id });
        if (row === undefined) throw new Error('Dashboard E2E Trade missing');
        if (values.status === 'closed') {
          await tx.insert(tradeExits).values({
            workspaceId,
            tradeId: row.id,
            mutationKey: crypto.randomUUID(),
            sequence: 1,
            closedBps: 10_000,
            exitPrice: values.actualExit ?? null,
            realizedPnlMinor: values.netPnlMinor ?? null,
            exitedAt: values.exitedAt as Date,
          });
        }
        return row.id;
      });
    }

    const divergentExit = daysAgo(5, 10);
    await insertTrade({
      ...framework,
      symbol: 'XAUUSD',
      ...traderFields(divergentExit, '-1.0000', 'loss'),
      ...systemFields(new Date(divergentExit.getTime() + 30 * 60 * 1000), '3.0000', 'win'),
    });
    const pendingExit = daysAgo(8, 10);
    await insertTrade({
      ...framework,
      symbol: 'EURUSD',
      ...traderFields(pendingExit, '2.0000', 'win'),
    });
    const openTime = daysAgo(10, 10);
    await db.insert(trades).values({
      ...framework,
      symbol: 'NAS100',
      status: 'open',
      actualResultMode: 'money',
      actualEntry: '100.0000000000',
      actualInitialStop: '99.0000000000',
      actualInitialRiskMinor: 100n,
      enteredAt: openTime,
      ...systemFields(new Date(openTime.getTime() + 30 * 60 * 1000), '-1.0000', 'loss'),
    });
    const olderExit = daysAgo(45, 10);
    await insertTrade({
      ...framework,
      symbol: 'GBPUSD',
      ...traderFields(olderExit, '1.0000', 'win'),
      ...systemFields(new Date(olderExit.getTime() + 30 * 60 * 1000), '2.0000', 'win'),
    });
    await db.insert(trades).values({
      ...framework,
      symbol: 'BTCUSD',
      status: 'planned',
      createdAt: daysAgo(2, 10),
    });
    await db.insert(trades).values({
      ...framework,
      symbol: 'USDJPY',
      status: 'canceled',
      createdAt: daysAgo(3, 10),
    });

    const [renamed] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 2,
        name: 'Current Momentum Name',
      })
      .returning({ id: strategyVersions.id });
    if (renamed === undefined) throw new Error('Dashboard E2E rename insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: renamed.id })
      .where(eq(strategies.id, strategy.id));

    return {
      workspaceId,
      accountId: account.id,
      strategyId: strategy.id,
      setupId: setup.id,
    };
  } finally {
    await client.end();
  }
}

test.describe('real Dashboard', () => {
  test('desktop renders canonical attribution, refreshes ranges, and links to real records', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionDashboardUser('e2e-dashboard-desktop');
    await loginAs(page, 'en', user);
    await page.goto('/en/app');

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(/fictional demo data/i)).toHaveCount(0);
    await expect(page.getByText(/trade journaling is coming/i)).toHaveCount(0);

    // D3 Basic KPI row. The seeded 90D Trader population is XAUUSD -1R
    // (-100 minor), EURUSD +2R (+100) and GBPUSD +1R (+100), all USD.
    const netPnl = page.locator('[data-dashboard-widget="basic.net-pnl"]');
    const tradeWin = page.locator('[data-dashboard-widget="basic.trade-win-rate"]');
    const kpiProfitFactor = page.locator('[data-dashboard-widget="basic.profit-factor"]');
    const dayWin = page.locator('[data-dashboard-widget="basic.day-win-rate"]');
    const avgWinLoss = page.locator('[data-dashboard-widget="basic.avg-win-loss"]');

    await expect(netPnl).toHaveAttribute('data-kpi-status', 'available');
    await expect(netPnl.getByText('+$1.00')).toBeVisible();
    await expect(netPnl.getByText('USD · 3 Trades')).toBeVisible();
    await expect(tradeWin.getByText('66.67%')).toBeVisible();
    await expect(tradeWin.getByText('2W · 0BE · 1L')).toBeVisible();
    await expect(kpiProfitFactor.getByText('3.00')).toBeVisible();
    await expect(kpiProfitFactor.getByText('Calculated from R')).toBeVisible();
    await expect(dayWin.getByText('66.67%')).toBeVisible();
    await expect(avgWinLoss.getByText('1.50x')).toBeVisible();
    await expect(avgWinLoss.getByText('+1.50R / -1.00R')).toBeVisible();

    // One balanced desktop row: five cards, same top edge, equal widths.
    const kpiBoxes = await Promise.all(
      [netPnl, tradeWin, kpiProfitFactor, dayWin, avgWinLoss].map((card) => card.boundingBox()),
    );
    const tops = kpiBoxes.map((box) => Math.round(box?.y ?? -1));
    expect(new Set(tops).size).toBe(1);
    const widths = kpiBoxes.map((box) => box?.width ?? 0);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

    // The definition affordance is a real button: keyboard-operable, not hover-only.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'About Profit Factor' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(/Positive Actual R divided by absolute negative Actual R/),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByText(/Positive Actual R divided by absolute negative Actual R/),
    ).toHaveCount(0);

    const system = page.locator('[data-dashboard-panel="system"]');
    const trader = page.locator('[data-dashboard-panel="trader"]');
    const comparison = page.locator('[data-dashboard-panel="execution-gap"]');
    await expect(system.getByRole('heading', { name: 'System Performance' })).toBeVisible();
    await expect(trader.getByRole('heading', { name: 'Trader Performance' })).toBeVisible();
    const metric = (side: typeof system, key: string) =>
      side.locator(`[data-performance-metric="${key}"]`);
    await expect(metric(system, 'sampleCount').getByText('3')).toBeVisible();
    await expect(metric(trader, 'sampleCount').getByText('3')).toBeVisible();
    await expect(system.getByText('+4.00R')).toBeVisible();
    await expect(trader.getByText('+2.00R')).toBeVisible();
    await expect(metric(system, 'averageR').getByText('+1.33R')).toBeVisible();
    await expect(metric(system, 'expectancyR').getByText('+1.33R')).toBeVisible();
    await expect(metric(trader, 'averageR').getByText('+0.67R')).toBeVisible();
    await expect(metric(trader, 'expectancyR').getByText('+0.67R')).toBeVisible();
    await expect(metric(system, 'winRate').getByText('66.67%')).toBeVisible();
    await expect(metric(trader, 'winRate').getByText('66.67%')).toBeVisible();
    await expect(metric(system, 'profitFactor').getByText('5.00')).toBeVisible();
    await expect(metric(trader, 'profitFactor').getByText('3.00')).toBeVisible();

    // D4 card anatomy: taglines, a labelled hero Total R, and the composition.
    await expect(system.getByText('Strategy outcomes')).toBeVisible();
    await expect(trader.getByText('Your actual execution')).toBeVisible();
    await expect(system.getByText('System Total R')).toBeVisible();
    await expect(trader.getByText('Actual Total R')).toBeVisible();
    await expect(system.getByText('2W · 0BE · 1L')).toBeVisible();
    await expect(trader.getByText('2W · 0BE · 1L')).toBeVisible();
    // Maximum Drawdown reads as an unsigned magnitude, never as a gain.
    await expect(metric(trader, 'maximumDrawdownR').getByText('1.00R')).toBeVisible();
    await expect(metric(trader, 'maximumDrawdownR').getByText('+1.00R')).toHaveCount(0);
    // D5 material stays out of both cards.
    for (const side of [system, trader]) {
      await expect(side.getByText(/Execution Gap|System Edge Captured/)).toHaveCount(0);
    }

    // Two equal halves sharing a top edge, neither side dominant.
    const [systemDesktopBox, traderDesktopBox] = await Promise.all([
      system.boundingBox(),
      trader.boundingBox(),
    ]);
    expect(Math.round(systemDesktopBox?.y ?? -1)).toBe(Math.round(traderDesktopBox?.y ?? -2));
    expect(
      Math.abs((systemDesktopBox?.width ?? 0) - (traderDesktopBox?.width ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((systemDesktopBox?.height ?? 0) - (traderDesktopBox?.height ?? 0)),
    ).toBeLessThanOrEqual(1);
    // D5B — the Execution Gap section, reading Population C only.
    const gapSummary = comparison.locator('[data-execution-gap-summary]');
    const gapMetric = (key: string) => gapSummary.locator(`[data-execution-gap-metric="${key}"]`);
    // Average Execution Gap is Actual - System: (-4R + -1R) / 2 = -2.5R.
    await expect(gapMetric('averageGap').getByText('-2.50R')).toBeVisible();
    await expect(gapMetric('systemEdgeCaptured').getByText('0.00%')).toBeVisible();
    await expect(gapSummary.getByText('System Edge Captured')).toBeVisible();
    // Total Gap is the SUM over the two paired Trades: -4R + -1R = -5R.
    await expect(gapMetric('totalGap').getByText('-5.00R')).toBeVisible();
    // Paired count is Population C and is allowed to differ from D4's counts.
    await expect(gapMetric('pairedTrades').getByText('2', { exact: true })).toBeVisible();
    // Both plots exist and are reachable by name, not as bare SVG.
    await expect(
      comparison.getByRole('img', { name: /Cumulative paired System R/i }),
    ).toBeVisible();
    await expect(comparison.getByRole('img', { name: /Execution Gap per day/i })).toBeVisible();
    await expect(comparison.getByText('Underperformed System')).toBeVisible();
    await expect(page.getByText('Pinned Momentum v1').first()).toBeVisible();
    await expect(page.getByText('Pinned Opening Retest').first()).toBeVisible();
    await expect(page.getByText('Current Momentum Name')).toHaveCount(0);

    // Wait for the App Router client boundary before exercising its Link.
    // The server-rendered values are visible sooner than hydration completes.
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: '30D' }).click();
    // 15s, not the 5s default. This is an App Router client transition: the
    // click issues an RSC request for the new range and React commits the URL
    // only once that resolves. Measured in isolation the whole round trip is
    // ~650ms, but inside this test — behind a queue of route prefetches and
    // two preference server actions — it routinely overruns 5s, which made
    // this line fail on timing rather than on behaviour. 15s is a bounded
    // allowance for that queue, still short enough to fail fast if the
    // transition genuinely breaks; it is deliberately NOT the 120s that
    // `analytics.spec.ts` uses for its own filter navigations.
    await expect(page).toHaveURL(/\/en\/app\?range=30d&unit=r$/, { timeout: 15_000 });
    // The URL alone only proves the router accepted the address. `aria-current`
    // is rendered from the SERVER's resolved filter state, so it is only
    // 'page' once the new tree has actually committed — which is what makes
    // this the assertion that the transition settled, not merely started.
    await expect(page.getByRole('link', { name: '30D' })).toHaveAttribute('aria-current', 'page');
    await expect(metric(system, 'sampleCount').getByText('2')).toBeVisible();
    await expect(metric(trader, 'sampleCount').getByText('2')).toBeVisible();
    await expect(system.getByText('+2.00R')).toBeVisible();
    await expect(trader.getByText('+1.00R')).toBeVisible();
    // The one 30D pair is Actual -1R minus System +3R = -4R.
    await expect(gapMetric('averageGap').getByText('-4.00R')).toBeVisible();
    await expect(gapMetric('systemEdgeCaptured').getByText('-33.33%')).toBeVisible();
    // 30D Net P&L is -100 + 100 = exactly zero: unsigned and neutral, never "+$0.00".
    await expect(netPnl.getByText('$0.00', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'XAUUSD' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await page.goto('/en/app');
    await page.getByRole('link', { name: /View full analytics/i }).click();
    await expect(page).toHaveURL(/\/en\/app\/analytics$/);
  });

  test('mobile remains stacked, operable, and free of horizontal overflow', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(240_000);
    const user = await provisionDashboardUser('e2e-dashboard-mobile');
    await page.setViewportSize({ width: 320, height: 800 });
    await loginAs(page, 'en', user);
    await page.goto('/en/app');

    const system = page.locator('[data-dashboard-panel="system"]');
    const trader = page.locator('[data-dashboard-panel="trader"]');
    const comparison = page.locator('[data-dashboard-panel="execution-gap"]');
    // Assert the count rather than letting strict mode throw on it. Under a
    // loaded machine the streamed server tree and the hydrated one can both be
    // attached for a frame; `toHaveCount` polls through that, while a panel
    // that genuinely rendered twice still fails here.
    await expect(system).toHaveCount(1);
    await expect(trader).toHaveCount(1);
    await expect(system).toBeVisible();
    await expect(trader).toBeVisible();
    await expect(comparison).toBeVisible();

    // Two-column KPI grid at narrow widths, with the fifth card spanning both.
    const netPnl = page.locator('[data-dashboard-widget="basic.net-pnl"]');
    const tradeWin = page.locator('[data-dashboard-widget="basic.trade-win-rate"]');
    const avgWinLoss = page.locator('[data-dashboard-widget="basic.avg-win-loss"]');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const [first, second, last] = await Promise.all([
        netPnl.boundingBox(),
        tradeWin.boundingBox(),
        avgWinLoss.boundingBox(),
      ]);
      // Cards one and two share a row; neither value nor label is clipped away.
      expect(Math.round(first?.y ?? -1)).toBe(Math.round(second?.y ?? -2));
      expect(second?.x ?? 0).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0) - 1);
      expect(last?.width ?? 0).toBeGreaterThan((first?.width ?? 0) * 1.5);
      await expect(netPnl.getByText('+$1.00')).toBeVisible();

      // D4: the two performance cards stack full width and never scroll
      // sideways, and their figures stay legible at this width.
      const [systemBox, traderBox] = await Promise.all([
        system.boundingBox(),
        trader.boundingBox(),
      ]);
      expect(traderBox?.y ?? 0).toBeGreaterThan((systemBox?.y ?? 0) + (systemBox?.height ?? 0) - 1);
      expect(Math.abs((systemBox?.width ?? 0) - (traderBox?.width ?? 0))).toBeLessThanOrEqual(1);
      expect(systemBox?.width ?? 0).toBeGreaterThan(width * 0.7);
      for (const side of [system, trader]) {
        const inner = await side.evaluate((node) => ({
          scroll: node.scrollWidth,
          client: node.clientWidth,
        }));
        expect(inner.scroll).toBeLessThanOrEqual(inner.client + 1);
        const size = await side
          .locator('[data-performance-metric="winRate"] dd span')
          .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
        expect(size).toBeGreaterThanOrEqual(12);
      }
      await expect(system.getByText('System Total R')).toBeVisible();
      await expect(trader.getByText('Actual Total R')).toBeVisible();

      // D5B stacks full width and the plots must fit the viewport: a chart the
      // reader has to pan sideways is the failure this asserts against.
      const gapBox = await comparison.boundingBox();
      expect(gapBox?.width ?? 0).toBeGreaterThan(width * 0.7);
      const gapInner = await comparison.evaluate((node) => ({
        scroll: node.scrollWidth,
        client: node.clientWidth,
      }));
      expect(gapInner.scroll).toBeLessThanOrEqual(gapInner.client + 1);
      await expect(comparison.getByText('Total Execution Gap')).toBeVisible();
      await expect(
        comparison.getByRole('img', { name: /Cumulative paired System R/i }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'About Net P&L' })).toBeVisible();
      const kpiOverflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(kpiOverflow.scroll).toBeLessThanOrEqual(kpiOverflow.client + 1);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    const systemBox = await system.boundingBox();
    const traderBox = await trader.boundingBox();
    expect(traderBox?.y ?? 0).toBeGreaterThan((systemBox?.y ?? 0) + (systemBox?.height ?? 0));

    const range = page.getByRole('link', { name: '30D' });
    const rangeBox = await range.boundingBox();
    expect(rangeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.waitForLoadState('networkidle');
    await range.click();
    // The mobile half of the very same App Router transition the desktop case
    // above describes, and load-sensitive for the identical reason — so it
    // carries the identical bounded allowance rather than the 5s default.
    await expect(page).toHaveURL(/range=30d/, { timeout: 15_000 });
    // Server-rendered from the resolved filter state, so it only reads 'page'
    // once the new tree has committed: the transition settled, not just started.
    await expect(range).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'XAUUSD' })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/app?range=90d');
    await expect(system).toBeVisible();
    await expect(trader).toBeVisible();
    const tabletDimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(tabletDimensions.scroll).toBeLessThanOrEqual(tabletDimensions.client + 1);
  });
});

/**
 * D7B — Risk Performance.
 *
 * The seeded Account starts at $10,000 and holds three closed Trades with
 * authoritative money: GBPUSD +$1.00 (45 days ago), EURUSD +$1.00 (8 days
 * ago) and XAUUSD -$1.00 (5 days ago). That makes every figure below exact
 * and every range genuinely different from the others:
 *
 *   All  — opens at the Starting Balance, ends $10,001.00, +$1.00
 *   90D  — the same three Trades, but a bounded opening of $10,000.00
 *   30D  — opens at $10,001.00 with the 45-day Trade already carried in,
 *          ends $10,001.00, and its period P&L is exactly $0.00
 *
 * The 30D case is the one that matters most: the balance reads $10,001.00
 * while the period moved nothing at all, which is only readable because the
 * carried opening is stated.
 */
test.describe('Dashboard Risk Performance', () => {
  const RISK_HEADING = 'Risk Performance';

  /**
   * Navigate, then wait for the Risk section to settle at exactly one node.
   *
   * The section is its own streamed Suspense boundary, and under load the
   * streamed server tree and the hydrated one can both be attached for a
   * frame — the identical accommodation the Dashboard's own mobile case makes
   * above. Polling the count settles that before any strict locator reads an
   * attribute off it, while a section that genuinely rendered twice still
   * fails here.
   */
  async function gotoRisk(page: Page, url: string) {
    await page.goto(url);
    // 20s, not the 5s default. This is a STREAMED Suspense boundary: the
    // section's own server read resolves after the five core reads have
    // already painted, so on a cold database it can arrive well after the
    // rest of the page. The count is still exactly 1 — a section that
    // genuinely rendered twice, or never, still fails here.
    await expect(page.locator('[data-dashboard-panel="risk-performance"]')).toHaveCount(1, {
      timeout: 20_000,
    });
  }

  test('desktop follows the Account and the range, and ignores Strategy and Setup', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionDashboardUser('e2e-dashboard-risk');
    await loginAs(page, 'en', user);

    const section = page.locator('[data-dashboard-panel="risk-performance"]');
    const metric = (key: string) => section.locator(`[data-risk-metric="${key}"]`);
    const status = page.locator('[data-risk-status]');

    // 90D is the Dashboard default range.
    await gotoRisk(page, '/en/app');
    await expect(page.getByRole('heading', { level: 2, name: RISK_HEADING })).toBeVisible();
    await expect(status).toHaveAttribute('data-risk-status', 'available');
    await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
    await expect(metric('modeledBalance').getByText('Modeled Balance')).toBeVisible();
    await expect(metric('periodPnl').getByText('+$1.00')).toBeVisible();
    await expect(metric('peakBalance').getByText('$10,002.00')).toBeVisible();
    await expect(metric('currentDrawdown').getByText('$1.00')).toBeVisible();
    await expect(metric('currentDrawdown').getByText('0.01%')).toBeVisible();
    await expect(metric('maxDrawdown').getByText('$1.00')).toBeVisible();
    /*
      The 90D window reaches back past all three closed Trades, so it carried
      NOTHING into itself and the copy says exactly that. This is the third
      opening case, and it must never borrow the carried-history sentence:
      claiming Trades closed before a range that contains all of them is
      simply false.
    */
    await expect(
      section.getByText(
        'This range opened at the declared Starting Balance of $10,000.00 — no Trade closed before it.',
      ),
    ).toBeVisible();
    await expect(section.getByText(/carried in from Trades closed before it/)).toHaveCount(0);
    // The balance curve exists, is reachable by name, and is the section's
    // only plot: no second underwater drawdown chart belongs on the Dashboard.
    await expect(
      section.getByRole('img', { name: /Modeled Balance after each closed Trade/i }),
    ).toBeVisible();
    // Modeled, never a broker statement.
    await expect(section.getByText(/broker balance|live balance|equity/i)).toHaveCount(0);
    // The section carries a LABEL for the active range and never a control:
    // the one range control on the page belongs to the performance header.
    await expect(page.locator('[data-risk-range]')).toHaveAttribute('data-risk-range', '90d');

    // 30D — the same Account, a genuinely different window, and the reading
    // that would be false without the carried opening.
    await gotoRisk(page, '/en/app?range=30d&unit=r');
    await expect(page.locator('[data-risk-range]')).toHaveAttribute('data-risk-range', '30d');
    await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
    await expect(metric('periodPnl').getByText('$0.00', { exact: true })).toBeVisible();
    await expect(
      section.getByText(
        'This range opened at $10,001.00, carried in from Trades closed before it.',
      ),
    ).toBeVisible();
    // It must be impossible to read this as "$10,000 became $10,001 in 30 days".
    await expect(section.getByText(/opened at \$10,000\.00/)).toHaveCount(0);

    // All — the only range with no bounded opening to carry, and the one
    // place the Starting Balance is named. It still claims no inception date.
    await gotoRisk(page, '/en/app?range=all&unit=r');
    await expect(page.locator('[data-risk-range]')).toHaveAttribute('data-risk-range', 'all');
    await expect(
      section.getByText('Modeled from the declared Starting Balance of $10,000.00.'),
    ).toBeVisible();
    await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
    await expect(metric('periodPnl').getByText('+$1.00')).toBeVisible();
    await expect(section.getByText(/Account opened on|since account creation/i)).toHaveCount(0);

    /*
      Strategy and Setup are authorized and validated but deliberately do not
      filter an Account-level balance. Every figure must be IDENTICAL to the
      unfiltered 90D read above, and the section must say why.
    */
    for (const query of [`strategy=${user.strategyId}`, `setup=${user.setupId}`]) {
      await gotoRisk(page, `/en/app?range=90d&unit=r&${query}`);
      await expect(status).toHaveAttribute('data-risk-status', 'available');
      await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
      await expect(metric('periodPnl').getByText('+$1.00')).toBeVisible();
      await expect(metric('peakBalance').getByText('$10,002.00')).toBeVisible();
      await expect(metric('currentDrawdown').getByText('$1.00')).toBeVisible();
      await expect(
        section.getByText(
          'Account-level metric. Strategy and Setup filters do not change modeled balance.',
        ),
      ).toBeVisible();
    }
    // And the note is absent when no analytical filter is applied.
    await gotoRisk(page, '/en/app?range=90d&unit=r');
    await expect(page.locator('[data-risk-scope-note]')).toHaveCount(0);

    /*
      All Accounts fails closed. A combined historical capital curve would
      have to invent when capital entered each Account, so the section asks
      for one Account instead of showing $0 and an empty axis.
    */
    await gotoRisk(page, '/en/app?range=90d&unit=r&account=all');
    await expect(status).toHaveAttribute('data-risk-status', 'unavailable');
    await expect(page.locator('[data-risk-reason]')).toHaveAttribute(
      'data-risk-reason',
      'select_single_account',
    );
    await expect(section.getByText('Select an Account to view modeled balance.')).toBeVisible();
    await expect(section.getByText(/Balance history is calculated per Account/)).toBeVisible();
    await expect(section.locator('[data-risk-metric]')).toHaveCount(0);
    await expect(section.getByRole('img', { name: /Modeled Balance/i })).toHaveCount(0);

    // The definition affordance is a real button, keyboard-operable.
    await gotoRisk(page, '/en/app?range=90d&unit=r');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'About Modeled Balance' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(/changes only when a Trade closes with an authoritative result/),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('an Account with no closed Trades stays available at its starting balance', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(240_000);
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: `e2e-risk-empty-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      password: 'Correct-Horse9!',
      name: 'E2E Empty Risk Tester',
    });
    await loginAs(page, 'en', user);
    await gotoRisk(page, '/en/app');

    const section = page.locator('[data-dashboard-panel="risk-performance"]');
    const metric = (key: string) => section.locator(`[data-risk-metric="${key}"]`);

    // AVAILABLE, not empty and not an error: every figure below is true.
    await expect(page.locator('[data-risk-status]')).toHaveAttribute(
      'data-risk-status',
      'available',
    );
    await expect(metric('modeledBalance').getByText('$10,000.00')).toBeVisible();
    await expect(metric('periodPnl').getByText('$0.00', { exact: true })).toBeVisible();
    await expect(metric('currentDrawdown').getByText('$0.00')).toBeVisible();
    await expect(metric('currentDrawdown').getByText('0.00%')).toBeVisible();
    await expect(metric('maxDrawdown').getByText('0.00%')).toBeVisible();
    // The opening sentence names the Starting Balance and claims no history:
    // this Account has closed nothing, ever, so nothing was carried into the
    // range. The D7B UAT caught this exact line asserting the opposite.
    await expect(
      section.getByText(
        'This range opened at the declared Starting Balance of $10,000.00 — no Trade closed before it.',
      ),
    ).toBeVisible();
    await expect(section.getByText('No closed Trades yet.')).toBeVisible();
    await expect(
      section.getByText('Your modeled balance remains at the starting balance.'),
    ).toBeVisible();
    // Not an error, and no meaningless flat plot.
    await expect(section.getByRole('alert')).toHaveCount(0);
    await expect(section.getByRole('img', { name: /Modeled Balance/i })).toHaveCount(0);
  });

  test('mobile keeps the figures legible and the section inside the viewport', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(240_000);
    const user = await provisionDashboardUser('e2e-dashboard-risk-mobile');
    await loginAs(page, 'en', user);

    const section = page.locator('[data-dashboard-panel="risk-performance"]');
    const metric = (key: string) => section.locator(`[data-risk-metric="${key}"]`);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await gotoRisk(page, '/en/app?range=90d&unit=r');
      await expect(page.getByRole('heading', { level: 2, name: RISK_HEADING })).toBeVisible();
      await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
      await expect(metric('periodPnl').getByText('+$1.00')).toBeVisible();
      await expect(metric('currentDrawdown').getByText('$1.00')).toBeVisible();
      await expect(metric('maxDrawdown').getByText('$1.00')).toBeVisible();

      // The mobile priority order, read straight off the DOM: the two hero
      // figures, then the two drawdown readings, then the supporting peak.
      const order = await section.evaluate((node) =>
        [...node.querySelectorAll('[data-risk-metric]')].map((child) =>
          child.getAttribute('data-risk-metric'),
        ),
      );
      expect(order).toEqual([
        'modeledBalance',
        'periodPnl',
        'currentDrawdown',
        'maxDrawdown',
        'peakBalance',
      ]);

      // The section stacks full width and its plot fits: a chart the reader
      // has to pan sideways is the failure this asserts against.
      const box = await section.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(width * 0.7);
      const inner = await section.evaluate((node) => ({
        scroll: node.scrollWidth,
        client: node.clientWidth,
      }));
      expect(inner.scroll).toBeLessThanOrEqual(inner.client + 1);

      const document_ = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(document_.scroll).toBeLessThanOrEqual(document_.client + 1);
    }
  });
});
