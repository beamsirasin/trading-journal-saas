import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
  tradeMistakes,
  tradeRuleChecks,
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

interface Framework {
  strategyId: string;
  strategyVersionId: string;
  setupId: string;
  setupVersionId: string;
}

async function provisionAnalyticsUser(prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await provisionVerifiedUser(testUrl, {
    email,
    password: 'Correct-Horse9!',
    name: 'E2E Analytics Tester',
  });
  await seedAnalyticsData(user.id);
  return user;
}

async function seedAnalyticsData(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client);
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Analytics E2E workspace missing');
    const workspaceId = workspace.id;
    const [activeAccount] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    if (activeAccount === undefined) throw new Error('Analytics E2E Account missing');
    await db
      .update(tradingAccounts)
      .set({ name: 'Primary Analytics Account' })
      .where(eq(tradingAccounts.id, activeAccount.id));
    const [secondaryAccount, archivedAccount] = await db
      .insert(tradingAccounts)
      .values([
        {
          workspaceId,
          name: 'Secondary Analytics Account',
          accountMode: 'demo',
          baseCurrency: 'USD',
          startingBalance: '10000.0000000000',
          timezone: 'UTC',
        },
        {
          workspaceId,
          name: 'Archived History Account',
          accountMode: 'demo',
          baseCurrency: 'EUR',
          startingBalance: '10000.0000000000',
          timezone: 'UTC',
          isArchived: true,
        },
      ])
      .returning({ id: tradingAccounts.id });
    if (secondaryAccount === undefined || archivedAccount === undefined) {
      throw new Error('Analytics E2E historical Accounts missing');
    }

    async function createFramework(name: string, setupName: string): Promise<Framework> {
      const [strategy] = await db
        .insert(strategies)
        .values({ workspaceId })
        .returning({ id: strategies.id });
      if (strategy === undefined) throw new Error('Analytics E2E Strategy missing');
      const [version] = await db
        .insert(strategyVersions)
        .values({
          workspaceId,
          strategyId: strategy.id,
          versionNumber: 1,
          name,
        })
        .returning({ id: strategyVersions.id });
      if (version === undefined) throw new Error('Analytics E2E Version missing');
      await db
        .update(strategies)
        .set({ currentVersionId: version.id })
        .where(eq(strategies.id, strategy.id));
      const [setup] = await db
        .insert(setups)
        .values({ workspaceId, strategyId: strategy.id })
        .returning({ id: setups.id });
      if (setup === undefined) throw new Error('Analytics E2E Setup missing');
      const [setupVersion] = await db
        .insert(strategySetupVersions)
        .values({
          workspaceId,
          strategyId: strategy.id,
          strategyVersionId: version.id,
          setupId: setup.id,
          name: setupName,
        })
        .returning({ id: strategySetupVersions.id });
      if (setupVersion === undefined) throw new Error('Analytics E2E Setup Version missing');
      return {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
      };
    }

    const primary = await createFramework('Breakout Momentum', 'Opening Retest');
    const historical = await createFramework('Historical Mean Reversion', 'Archived Fade');
    await db
      .update(strategies)
      .set({ isArchived: true })
      .where(eq(strategies.id, historical.strategyId));
    await db.update(setups).set({ isArchived: true }).where(eq(setups.id, historical.setupId));

    const [primaryV2] = await db
      .insert(strategyVersions)
      .values({
        workspaceId,
        strategyId: primary.strategyId,
        versionNumber: 2,
        name: 'Breakout Momentum v2',
      })
      .returning({ id: strategyVersions.id });
    if (primaryV2 === undefined) throw new Error('Analytics E2E v2 missing');
    const [primarySetupV2] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId,
        strategyId: primary.strategyId,
        strategyVersionId: primaryV2.id,
        setupId: primary.setupId,
        name: 'Opening Retest v2',
      })
      .returning({ id: strategySetupVersions.id });
    if (primarySetupV2 === undefined) throw new Error('Analytics E2E Setup v2 missing');
    await db
      .update(strategies)
      .set({ currentVersionId: primaryV2.id })
      .where(eq(strategies.id, primary.strategyId));
    const primary2: Framework = {
      ...primary,
      strategyVersionId: primaryV2.id,
      setupVersionId: primarySetupV2.id,
    };

    const base = (accountId: string, framework: Framework, symbol: string) => ({
      workspaceId,
      tradingAccountId: accountId,
      strategyId: framework.strategyId,
      strategyVersionId: framework.strategyVersionId,
      setupId: framework.setupId,
      setupVersionId: framework.setupVersionId,
      symbol,
      direction: 'long' as const,
      plannedEntry: '100.0000000000',
      plannedStop: '99.0000000000',
      plannedTarget: '102.0000000000',
      plannedR: '2.0000',
    });
    const trader = (exitedAt: Date, actualR: string, outcome: 'win' | 'loss') => ({
      status: 'closed' as const,
      actualResultMode: 'money' as const,
      actualEntry: '100.0000000000',
      actualInitialStop: '99.0000000000',
      actualInitialRiskMinor: 100n,
      enteredAt: new Date(exitedAt.getTime() - 3_600_000),
      actualExit: '101.0000000000',
      netPnlMinor: actualR.startsWith('-') ? -100n : 100n,
      exitedAt,
      actualR,
      traderOutcome: outcome,
    });
    const system = (exitedAt: Date, systemR: string, outcome: 'win' | 'loss') => ({
      systemStatus: 'resolved' as const,
      systemExitPrice: '102.0000000000',
      systemExitedAt: exitedAt,
      systemExitReason: 'target_hit' as const,
      systemResolvedAt: exitedAt,
      systemR,
      systemOutcome: outcome,
    });

    async function insertTrade(values: typeof trades.$inferInsert): Promise<string> {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(trades).values(values).returning({ id: trades.id });
        if (row === undefined) throw new Error('Analytics E2E Trade missing');
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

    async function paired(
      accountId: string,
      framework: Framework,
      symbol: string,
      days: number,
      actualR: string,
      traderOutcome: 'win' | 'loss',
      systemR: string,
      systemOutcome: 'win' | 'loss',
    ) {
      const exitedAt = daysAgo(days, 10);
      return insertTrade({
        ...base(accountId, framework, symbol),
        ...trader(exitedAt, actualR, traderOutcome),
        ...system(new Date(exitedAt.getTime() + 1_800_000), systemR, systemOutcome),
      });
    }

    const divergentId = await paired(
      activeAccount.id,
      primary,
      'XAUUSD',
      5,
      '-1.0000',
      'loss',
      '3.0000',
      'win',
    );
    const secondId = await paired(
      activeAccount.id,
      primary,
      'EURUSD',
      8,
      '2.0000',
      'win',
      '-1.0000',
      'loss',
    );
    await paired(activeAccount.id, primary, 'GBPUSD', 45, '1.0000', 'win', '2.0000', 'win');
    await paired(activeAccount.id, primary2, 'AUDUSD', 15, '1.0000', 'win', '1.0000', 'win');

    const traderOnlyExit = daysAgo(10, 10);
    await insertTrade({
      ...base(activeAccount.id, primary, 'USDJPY'),
      ...trader(traderOnlyExit, '3.0000', 'win'),
    });
    for (const [index, value] of ['-1.0000', '1.0000'].entries()) {
      const exitedAt = daysAgo(12 + index, 10);
      await db.insert(trades).values({
        ...base(activeAccount.id, primary, `NAS10${index}`),
        status: 'open',
        actualResultMode: 'money',
        actualEntry: '100.0000000000',
        actualInitialStop: '99.0000000000',
        actualInitialRiskMinor: 100n,
        enteredAt: exitedAt,
        ...system(
          new Date(exitedAt.getTime() + 1_800_000),
          value,
          value.startsWith('-') ? 'loss' : 'win',
        ),
      });
    }
    await paired(secondaryAccount.id, primary, 'BTCUSD', 6, '5.0000', 'win', '5.0000', 'win');
    await paired(archivedAccount.id, historical, 'ETHUSD', 7, '-2.0000', 'loss', '2.0000', 'win');

    const statuses = ['followed', 'followed', 'violated', 'not_checked', 'not_applicable'] as const;
    const ruleRows = await db
      .insert(strategyRules)
      .values(
        statuses.map((_, sortOrder) => ({
          workspaceId,
          strategyVersionId: primary.strategyVersionId,
          ruleKey: crypto.randomUUID(),
          category: 'entry',
          title: `Analytics Rule ${sortOrder}`,
          isRequired: true,
          isPreTradeCheck: true,
          sortOrder,
        })),
      )
      .returning({
        id: strategyRules.id,
        ruleKey: strategyRules.ruleKey,
        sortOrder: strategyRules.sortOrder,
      });
    await db.insert(tradeRuleChecks).values(
      ruleRows.map((rule, index) => ({
        workspaceId,
        tradeId: divergentId,
        strategyRuleId: rule.id,
        strategyVersionId: primary.strategyVersionId,
        ruleKey: rule.ruleKey,
        checkStatus: statuses[index] as (typeof statuses)[number],
        title: `Analytics Rule Snapshot ${index}`,
        category: 'entry',
        isRequired: true,
        isPreTradeCheck: true,
        sortOrder: rule.sortOrder,
      })),
    );

    const canonicalMistakes = await db
      .select()
      .from(mistakeTypes)
      .where(eq(mistakeTypes.isSystem, true))
      .orderBy(mistakeTypes.sortOrder)
      .limit(2);
    if (canonicalMistakes[0] === undefined || canonicalMistakes[1] === undefined) {
      throw new Error('Analytics E2E mistake seeds missing');
    }
    await db.insert(tradeMistakes).values([
      {
        workspaceId,
        tradeId: divergentId,
        mistakeTypeId: canonicalMistakes[0].id,
        severityAtTime: canonicalMistakes[0].severity,
        weightAtTime: canonicalMistakes[0].defaultWeight,
      },
      {
        workspaceId,
        tradeId: secondId,
        mistakeTypeId: canonicalMistakes[0].id,
        severityAtTime: canonicalMistakes[0].severity,
        weightAtTime: canonicalMistakes[0].defaultWeight,
      },
      {
        workspaceId,
        tradeId: divergentId,
        mistakeTypeId: canonicalMistakes[1].id,
        severityAtTime: canonicalMistakes[1].severity,
        weightAtTime: canonicalMistakes[1].defaultWeight,
      },
    ]);
  } finally {
    await client.end();
  }
}

test.describe('real deep Analytics', () => {
  test('desktop renders canonical sections and persists every approved filter', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionAnalyticsUser('e2e-analytics-desktop');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/analytics');

    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('button', { name: '90D' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Account', { exact: true })).toHaveValue('');
    const systemPanel = page.locator('[data-analytics-panel="system"]');
    const traderPanel = page.locator('[data-analytics-panel="trader"]');
    await expect(systemPanel.getByText('6 Trades')).toBeVisible();
    await expect(traderPanel.getByText('5 Trades')).toBeVisible();
    await expect(
      page.locator('[data-analytics-panel="comparison"]').getByText('+2.00R'),
    ).toBeVisible();
    await expect(
      page.locator('[data-analytics-panel="comparison"]').getByText('60.00%'),
    ).toBeVisible();
    await expect(page.getByText('Trader Equity Curve')).toBeVisible();
    await expect(page.getByText('System Equity Curve')).toBeVisible();
    await expect(page.locator('.recharts-wrapper')).toHaveCount(2);
    await expect(page.locator('[data-analytics-panel="rules"]').getByText('66.67%')).toBeVisible();
    await expect(
      page.locator('[data-analytics-panel="rules"]').getByText('Not Checked', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-analytics-panel="mistakes"]').getByText('2 Trades'),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Archived History Account · Archived' }),
    ).toBeAttached();

    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '30D' }).click();
    await expect(page).toHaveURL(/range=30d/);
    await expect(systemPanel.getByText('5 Trades')).toBeVisible();
    await page.getByRole('button', { name: 'All' }).click();
    await expect(page).toHaveURL(/range=all/);

    await page.getByLabel('Account', { exact: true }).selectOption('all');
    await expect(page).toHaveURL(/account=all/);
    await expect(page.getByLabel('Account', { exact: true })).toHaveValue('all');
    await expect(page.getByLabel('Current analytics scope')).toContainText('All Accounts');
    await page
      .getByLabel('Strategy', { exact: true })
      .selectOption({ label: 'Breakout Momentum v2' });
    await expect(page).toHaveURL(/strategy=[0-9a-f-]+/);
    await expect(page).not.toHaveURL(/setup=|version=/);
    await page.getByLabel('Setup').selectOption({ label: 'Opening Retest v2' });
    await expect(page).toHaveURL(/setup=[0-9a-f-]+/);
    await page.getByLabel('Strategy Version').selectOption({ label: 'Breakout Momentum · v1' });
    await expect(page).toHaveURL(/version=[0-9a-f-]+/);

    const persistedUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(persistedUrl);
    await expect(page.getByLabel('Strategy', { exact: true })).not.toHaveValue('');
    await expect(page.getByLabel('Setup')).not.toHaveValue('');
    await expect(page.getByLabel('Strategy Version')).not.toHaveValue('');

    await page.getByRole('link', { name: /Reset filters/ }).click();
    await expect(page).toHaveURL(/\/en\/app\/analytics$/);
    await expect(page.getByLabel('Account', { exact: true })).toHaveValue('');
    await expect(page.getByText(/fictional demo data/i)).toHaveCount(0);
    await expect(
      page.getByText(/Discipline Score|Costliest|Mistake Cost|Total P&L|FX/i),
    ).toHaveCount(0);
  });

  test('mobile keeps filters, sections, and both independent charts usable without overflow', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(240_000);
    const user = await provisionAnalyticsUser('e2e-analytics-mobile');
    await page.setViewportSize({ width: 320, height: 800 });
    await loginAs(page, 'en', user);
    await page.goto('/en/app/analytics');

    await expect(page.getByLabel('Account', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Strategy', { exact: true })).toBeVisible();
    await expect(page.locator('[data-analytics-panel="system"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="trader"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="comparison"]')).toBeVisible();
    await expect(page.getByText('Trader Equity Curve')).toBeVisible();
    await expect(page.getByText('System Equity Curve')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="rules"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="mistakes"]')).toBeVisible();
    const rangeBox = await page.getByRole('button', { name: '30D' }).boundingBox();
    expect(rangeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  });
});
