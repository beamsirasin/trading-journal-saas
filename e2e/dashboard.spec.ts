import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
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
  await seedDashboardData(user.id);
  return user;
}

async function seedDashboardData(userId: string): Promise<void> {
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
      trades,
    },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Dashboard E2E workspace missing');
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
      systemExitPrice: '102.0000000000',
      systemExitedAt,
      systemExitReason: 'target_hit' as const,
      systemResolvedAt: systemExitedAt,
      systemR,
      systemOutcome,
    });

    const divergentExit = daysAgo(5, 10);
    await db.insert(trades).values({
      ...framework,
      symbol: 'XAUUSD',
      ...traderFields(divergentExit, '-1.0000', 'loss'),
      ...systemFields(new Date(divergentExit.getTime() + 30 * 60 * 1000), '3.0000', 'win'),
    });
    const pendingExit = daysAgo(8, 10);
    await db.insert(trades).values({
      ...framework,
      symbol: 'EURUSD',
      ...traderFields(pendingExit, '2.0000', 'win'),
    });
    const openTime = daysAgo(10, 10);
    await db.insert(trades).values({
      ...framework,
      symbol: 'NAS100',
      status: 'open',
      actualEntry: '100.0000000000',
      actualInitialStop: '99.0000000000',
      actualInitialRiskMinor: 100n,
      enteredAt: openTime,
      ...systemFields(new Date(openTime.getTime() + 30 * 60 * 1000), '-1.0000', 'loss'),
    });
    const olderExit = daysAgo(45, 10);
    await db.insert(trades).values({
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
  } finally {
    await client.end();
  }
}

test.describe('real Dashboard overview', () => {
  test('desktop renders canonical attribution, refreshes ranges, and links to real records', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionDashboardUser('e2e-dashboard-desktop');
    await loginAs(page, 'en', user);
    await page.goto('/en/app');

    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByText(/fictional demo data/i)).toHaveCount(0);
    await expect(page.getByText(/trade journaling is coming/i)).toHaveCount(0);

    const system = page.locator('[data-dashboard-panel="system"]');
    const trader = page.locator('[data-dashboard-panel="trader"]');
    const comparison = page.locator('[data-dashboard-panel="comparison"]');
    await expect(system.getByRole('heading', { name: 'System Performance' })).toBeVisible();
    await expect(trader.getByRole('heading', { name: 'Trader Performance' })).toBeVisible();
    await expect(system.getByText('3 Trades')).toBeVisible();
    await expect(trader.getByText('3 Trades')).toBeVisible();
    await expect(system.getByText('+4.00R')).toBeVisible();
    await expect(trader.getByText('+2.00R')).toBeVisible();
    await expect(system.getByText('+1.33R')).toBeVisible();
    await expect(trader.getByText('+0.67R')).toBeVisible();
    await expect(system.getByText('66.67%')).toBeVisible();
    await expect(trader.getByText('66.67%')).toBeVisible();
    await expect(system.getByText('5.00')).toBeVisible();
    await expect(trader.getByText('3.00')).toBeVisible();
    await expect(comparison.getByText('+5.00R')).toBeVisible();
    await expect(comparison.getByText('0.00%')).toBeVisible();
    await expect(page.getByText('Pinned Momentum v1').first()).toBeVisible();
    await expect(page.getByText('Pinned Opening Retest').first()).toBeVisible();
    await expect(page.getByText('Current Momentum Name')).toHaveCount(0);

    // Wait for the App Router client boundary before exercising its Link.
    // The server-rendered values are visible sooner than hydration completes.
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: '30D' }).click();
    await expect(page).toHaveURL(/\/en\/app\?range=30d$/);
    await expect(page.getByRole('link', { name: '30D' })).toHaveAttribute('aria-current', 'page');
    await expect(system.getByText('2 Trades')).toBeVisible();
    await expect(trader.getByText('2 Trades')).toBeVisible();
    await expect(system.getByText('+2.00R')).toBeVisible();
    await expect(trader.getByText('+1.00R')).toBeVisible();
    await expect(comparison.getByText('+4.00R')).toBeVisible();
    await expect(comparison.getByText('-33.33%')).toBeVisible();

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
    const comparison = page.locator('[data-dashboard-panel="comparison"]');
    await expect(system).toBeVisible();
    await expect(trader).toBeVisible();
    await expect(comparison).toBeVisible();
    const systemBox = await system.boundingBox();
    const traderBox = await trader.boundingBox();
    expect(traderBox?.y ?? 0).toBeGreaterThan((systemBox?.y ?? 0) + (systemBox?.height ?? 0));

    const range = page.getByRole('link', { name: '30D' });
    const rangeBox = await range.boundingBox();
    expect(rangeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.waitForLoadState('networkidle');
    await range.click();
    await expect(page).toHaveURL(/range=30d/);
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
