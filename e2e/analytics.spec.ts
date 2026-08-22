import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  emotionTypes,
  mistakeTypes,
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeExits,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
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
    const gbpusdId = await paired(
      activeAccount.id,
      primary,
      'GBPUSD',
      45,
      '1.0000',
      'win',
      '2.0000',
      'win',
    );
    await paired(activeAccount.id, primary2, 'AUDUSD', 15, '1.0000', 'win', '1.0000', 'win');

    const traderOnlyExit = daysAgo(10, 10);
    await insertTrade({
      ...base(activeAccount.id, primary, 'USDJPY'),
      ...trader(traderOnlyExit, '3.0000', 'win'),
    });
    let nas101Id = '';
    for (const [index, value] of ['-1.0000', '1.0000'].entries()) {
      const exitedAt = daysAgo(12 + index, 10);
      const [nasRow] = await db
        .insert(trades)
        .values({
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
        })
        .returning({ id: trades.id });
      if (index === 1 && nasRow !== undefined) nas101Id = nasRow.id;
    }
    await paired(secondaryAccount.id, primary, 'BTCUSD', 6, '5.0000', 'win', '5.0000', 'win');
    await paired(archivedAccount.id, historical, 'ETHUSD', 7, '-2.0000', 'loss', '2.0000', 'win');

    // Behavioral analytics (Setup Adherence / Condition / Confidence / Emotion) proof:
    // GBPUSD is fully closed (Trader- and System-eligible); NAS101 is System-only
    // (still open, never Trader-eligible). Both carry identical Confidence/Emotion/
    // Condition data so the analytics page must show Trader=1, System=2 everywhere.
    const [momentumCondition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: primary.setupId,
        setupVersionId: primary.setupVersionId,
        label: 'Confirms Momentum',
        sortOrder: 0,
      })
      .returning({
        id: setupConditions.id,
        conditionKey: setupConditions.conditionKey,
      });
    if (momentumCondition === undefined) throw new Error('Analytics E2E condition missing');
    const [fearful] = await db
      .select({ id: emotionTypes.id, key: emotionTypes.key })
      .from(emotionTypes)
      .where(and(eq(emotionTypes.isSystem, true), eq(emotionTypes.key, 'fearful')));
    if (fearful === undefined) throw new Error('Analytics E2E fearful emotion seed missing');

    for (const behavioralTradeId of [gbpusdId, nas101Id]) {
      await db
        .update(trades)
        .set({ confidence: 75, emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
        .where(eq(trades.id, behavioralTradeId));
      await db.insert(tradeEmotions).values({
        workspaceId,
        tradeId: behavioralTradeId,
        emotionTypeId: fearful.id,
      });
      await db.insert(tradeSetupConditionChecks).values({
        workspaceId,
        tradeId: behavioralTradeId,
        setupConditionId: momentumCondition.id,
        setupVersionId: primary.setupVersionId,
        conditionKey: momentumCondition.conditionKey,
        label: 'Confirms Momentum',
        sortOrder: 0,
        checkStatus: 'met',
      });
    }

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
    test.setTimeout(600_000);
    const user = await provisionAnalyticsUser('e2e-analytics-desktop');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await loginAs(page, 'en', user);
    await page.goto('/en/app/analytics');

    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('button', { name: '90D' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Account', { exact: true })).toHaveValue('');

    // Phase 15C — Analytics Overview: RESULTS, EDGE, BEHAVIOR render, in that
    // order, before the pre-existing detailed sections they summarize (the
    // page's core "answer first" contract).
    const overviewHeadings = await page.getByRole('heading', { level: 2 }).allTextContents();
    const resultsIndex = overviewHeadings.indexOf('Results');
    const edgeIndex = overviewHeadings.indexOf('Edge');
    const behaviorIndex = overviewHeadings.indexOf('Behavior');
    const resultsExploreIndex = overviewHeadings.indexOf('Results Explore');
    expect(resultsIndex).toBeGreaterThanOrEqual(0);
    expect(edgeIndex).toBeGreaterThan(resultsIndex);
    expect(behaviorIndex).toBeGreaterThan(edgeIndex);
    expect(resultsExploreIndex).toBe(-1);

    const resultsZone = page.locator('section[aria-labelledby="analytics-overview-results"]');
    const edgeZone = page.locator('section[aria-labelledby="analytics-overview-edge"]');
    const behaviorZone = page.locator('section[aria-labelledby="analytics-overview-behavior"]');

    // RESULTS: the System readiness action is truthfully non-date-scoped (the
    // seeded USDJPY Trade has no System resolution at all, so it is pending
    // regardless of the active 90D/30D/All range) and deep-links to the
    // existing reviewable Trades surface — never a fabricated gap.
    await expect(resultsZone.getByText('1 pending System outcome')).toBeVisible();
    // The Overview's "Review pending" link uses the i18n `Link` component,
    // which prefixes every internal href with the active locale segment —
    // unlike the same-page `#anchor` "Explore" links below, which are plain
    // `<a>` tags and need no such prefix.
    await expect(resultsZone.getByRole('link', { name: 'Review pending' })).toHaveAttribute(
      'href',
      '/en/app/trades?view=log&attention=system-pending',
    );
    await expect(resultsZone.getByText(/captured less than the System/)).toBeVisible();
    await expect(resultsZone.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/en/app/analytics?view=results&range=90d',
    );

    // EDGE: Setup Adherence, plus Phase 15D's Best observed Strategy/Setup —
    // "Best observed", never "Best Strategy"/"Best Setup" outright, and
    // never a fake "Coming soon" placeholder.
    await expect(edgeZone.getByText('Average Setup Adherence')).toBeVisible();
    await expect(edgeZone.getByText('Best observed Strategy')).toBeVisible();
    await expect(edgeZone.getByText('Breakout Momentum')).toBeVisible();
    await expect(edgeZone.getByText('Best observed Setup')).toBeVisible();
    await expect(edgeZone.getByText('Opening Retest')).toBeVisible();
    await expect(edgeZone.getByText(/^Best Strategy$|^Best Setup$|Coming soon/i)).toHaveCount(0);
    await expect(edgeZone.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/en/app/analytics?view=edge&range=90d',
    );

    // BEHAVIOR: strongest observed Confidence/Emotion, not the full table.
    await expect(behaviorZone.getByText('Strongest observed confidence')).toBeVisible();
    await expect(behaviorZone.getByText('75%')).toBeVisible();
    await expect(behaviorZone.getByText('Strongest observed state')).toBeVisible();
    await expect(behaviorZone.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/en/app/analytics?view=behavior&range=90d',
    );

    await resultsZone.getByRole('link', { name: 'Explore' }).click();
    await expect(page).toHaveURL(/view=results/, { timeout: 120_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Results Explore' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Edge Explore' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Behavior Explore' })).toHaveCount(0);

    const systemPanel = page.locator('[data-analytics-panel="system"]');
    const traderPanel = page.locator('[data-analytics-panel="trader"]');
    await expect(systemPanel.getByText('6 Trades')).toBeVisible();
    await expect(traderPanel.getByText('5 Trades')).toBeVisible();
    await expect(
      page.locator('[data-analytics-panel="comparison"]').getByText('-0.50R'),
    ).toBeVisible();
    await expect(
      page.locator('[data-analytics-panel="comparison"]').getByText('-2.00R'),
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

    // Behavioral analytics (Phase 13H completion): NAS101 is System-only (still
    // open — never Trader-eligible) while GBPUSD is fully closed and eligible on
    // both axes. Every dimension must independently show Trader=1, System=2.
    await page.goto('/en/app/analytics?view=edge&range=90d');
    await expect(page.getByRole('heading', { level: 2, name: 'Edge Explore' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Results Explore' })).toHaveCount(0);
    const setupAdherencePanel = page.locator('[data-analytics-panel="setup-adherence"]');
    const adherenceBucket100 = setupAdherencePanel.locator('li', { hasText: '100%' });
    await expect(adherenceBucket100.locator('[data-analytics-axis="trader"]')).toContainText(
      '1 Trade',
    );
    await expect(adherenceBucket100.locator('[data-analytics-axis="system"]')).toContainText(
      '2 Trades',
    );

    const conditionsPanel = page.locator('[data-analytics-panel="conditions"]');
    const conditionMet = conditionsPanel.locator('[data-analytics-condition-status="met"]');
    const conditionNotMet = conditionsPanel.locator('[data-analytics-condition-status="notMet"]');
    await expect(conditionMet.locator('[data-analytics-axis="trader"]')).toContainText('1 Trade');
    await expect(conditionMet.locator('[data-analytics-axis="system"]')).toContainText('2 Trades');
    await expect(conditionNotMet.locator('[data-analytics-axis="trader"]')).toContainText(
      '0 Trades',
    );
    await expect(conditionNotMet.locator('[data-analytics-axis="system"]')).toContainText(
      '0 Trades',
    );

    await page.goto('/en/app/analytics?view=behavior&range=90d');
    await expect(page.getByRole('heading', { level: 2, name: 'Behavior Explore' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Edge Explore' })).toHaveCount(0);
    const confidencePanel = page.locator('[data-analytics-panel="confidence"]');
    const confidenceLevel75 = confidencePanel.locator('li', { hasText: '75%' });
    await expect(confidenceLevel75.locator('[data-analytics-axis="trader"]')).toContainText(
      '1 Trade',
    );
    await expect(confidenceLevel75.locator('[data-analytics-axis="system"]')).toContainText(
      '2 Trades',
    );

    const emotionsPanel = page.locator('[data-analytics-panel="emotions"]');
    const fearfulGroup = emotionsPanel.locator('li', { hasText: 'Fearful' });
    await expect(fearfulGroup.locator('[data-analytics-axis="trader"]')).toContainText('1 Trade');
    await expect(fearfulGroup.locator('[data-analytics-axis="system"]')).toContainText('2 Trades');

    // Phase 15D — Edge Explore: Strategy/Setup Performance groups by identity
    // across Strategy Versions (Breakout Momentum v1 + v2 collapse into one
    // "Breakout Momentum" group) — every seeded Trade in this fixture is
    // classified, so coverage discloses zero unclassified on both axes.
    await page.goto('/en/app/analytics?view=edge&range=90d');
    const strategyPerformancePanel = page.locator('[data-analytics-panel="strategy-performance"]');
    await expect(strategyPerformancePanel.getByText('Breakout Momentum')).toBeVisible();
    await expect(strategyPerformancePanel.getByText(/5 classified/)).toBeVisible();
    await expect(strategyPerformancePanel.getByText(/0 unclassified/).first()).toBeVisible();

    const setupPerformancePanel = page.locator('[data-analytics-panel="setup-performance"]');
    await expect(setupPerformancePanel.getByText('Opening Retest')).toBeVisible();
    await expect(setupPerformancePanel.getByText(/5 classified/)).toBeVisible();

    // Phase 15D — Context breakdowns (Trader-only): 5 distinct Symbols, one
    // Trade each, and a single Direction group (every seeded Trade is Long).
    await page.goto('/en/app/analytics?view=results&range=90d');
    const symbolPanel = page.locator('[data-analytics-panel="context-By Symbol"]');
    await expect(symbolPanel.getByText('XAUUSD')).toBeVisible();
    await expect(symbolPanel.getByText('EURUSD')).toBeVisible();
    const directionPanel = page.locator('[data-analytics-panel="context-By Direction"]');
    await expect(directionPanel.getByText('Long')).toBeVisible();
    await expect(directionPanel.getByText('5 Trades')).toBeVisible();

    // Phase 15D — Explore navigation: jumping to the Edge view lands on Edge
    // Explore, preserving the active filter scope. The click triggers a real
    // RSC navigation (new `searchParams` re-run every parallel Analytics
    // query server-side against the remote test database) behind this
    // page's `<Suspense>` boundary, so the heading mounts only once that
    // round-trip resolves — a longer timeout than the suite's other,
    // already-loaded-page assertions, not a flaky wait.
    await page.goto('/en/app/analytics?view=edge&range=90d');
    await expect(page.getByRole('heading', { level: 2, name: 'Edge Explore' })).toBeInViewport({
      timeout: 15_000,
    });

    await page.goto('/en/app/analytics?view=edge&range=30d');
    await expect(page.getByRole('button', { name: '30D' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'Edge', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const strategyId = await page
      .getByLabel('Strategy', { exact: true })
      .getByRole('option', { name: 'Breakout Momentum v2', exact: true })
      .getAttribute('value');
    const setupId = await page
      .getByLabel('Setup', { exact: true })
      .getByRole('option', { name: 'Opening Retest v2', exact: true })
      .getAttribute('value');
    const versionId = await page
      .getByLabel('Strategy Version')
      .getByRole('option', { name: 'Breakout Momentum · v1', exact: true })
      .getAttribute('value');
    if (strategyId === null || setupId === null || versionId === null) {
      throw new Error('Analytics E2E filter option IDs missing');
    }
    await page.goto(
      `/en/app/analytics?view=edge&range=all&account=all&strategy=${strategyId}&setup=${setupId}&version=${versionId}`,
    );
    await expect(page.getByLabel('Account', { exact: true })).toHaveValue('all');
    await expect(page.getByLabel('Current analytics scope')).toContainText('All Accounts');

    const persistedUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(persistedUrl);
    await expect(page.getByLabel('Strategy', { exact: true })).not.toHaveValue('');
    await expect(page.getByLabel('Setup', { exact: true })).not.toHaveValue('');
    await expect(page.getByLabel('Strategy Version')).not.toHaveValue('');

    const behaviorUrl = persistedUrl.replace('view=edge', 'view=behavior');
    await page.goto(behaviorUrl);
    await expect(page).toHaveURL(/view=behavior/);
    await page.goBack();
    await expect(page).toHaveURL(/view=edge/, { timeout: 120_000 });
    await expect(page).toHaveURL(/account=all/);
    await page.goForward();
    await expect(page).toHaveURL(/view=behavior/, { timeout: 120_000 });

    await page.goto('/en/app/analytics?view=overview');
    await expect(page.getByLabel('Account', { exact: true })).toHaveValue('');
    await expect(page.getByText(/fictional demo data/i)).toHaveCount(0);
    await expect(
      page.getByText(/Discipline Score|Costliest|Mistake Cost|Total P&L|FX/i),
    ).toHaveCount(0);
  });

  test.skip('legacy all-sections mobile composition superseded by Phase 15G.3 views', async ({
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
    // Phase 15C — Analytics Overview zones must stack cleanly at 320px, above
    // the pre-existing detailed sections, without contributing to overflow
    // (checked below via the page's scroll/client width comparison).
    // `exact: true` disambiguates from Phase 15D's "Results Explore"/"Edge
    // Explore"/"Behavior Explore" headings, whose accessible names otherwise
    // match these as a substring.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Results', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Edge', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Behavior', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-analytics-panel="system"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="trader"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="comparison"]')).toBeVisible();
    await expect(page.getByText('Trader Equity Curve')).toBeVisible();
    await expect(page.getByText('System Equity Curve')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="rules"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="mistakes"]')).toBeVisible();
    // Phase 13H behavioral-dimension panels (Setup Adherence / Condition /
    // Confidence / Emotion) must also render without overflow at 320px —
    // the desktop test already covers these; mobile previously did not.
    await expect(page.locator('[data-analytics-panel="setup-adherence"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="conditions"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="confidence"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="emotions"]')).toBeVisible();
    // Phase 15D — Explore nav + zones + net-new panels must also render
    // cleanly at 320px, above the same overflow assertion below.
    await expect(page.getByRole('navigation', { name: 'Analytics views' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Results Explore' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Edge Explore' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Behavior Explore' })).toBeVisible();
    await expect(page.locator('[data-analytics-panel="strategy-performance"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="setup-performance"]')).toBeVisible();
    await expect(page.locator('[data-analytics-panel="context-By Symbol"]')).toBeVisible();
    const rangeBox = await page.getByRole('button', { name: '30D' }).boundingBox();
    expect(rangeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  });

  test('Phase 15G.3 renders one Analytics view at a time at 390/320 in EN/TH', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(300_000);
    const user = await provisionAnalyticsUser('e2e-analytics-g3-mobile');
    await loginAs(page, 'en', user);

    for (const locale of ['en', 'th'] as const) {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`/${locale}/app/analytics?view=overview`);
        await expect(page.locator('#analytics-overview-results')).toBeVisible();
        await expect(page.locator('#analytics-overview-edge')).toBeVisible();
        await expect(page.locator('#analytics-overview-behavior')).toBeVisible();
        await expect(page.locator('#analytics-performance-heading')).toHaveCount(0);

        await page.locator(`nav a[href="/${locale}/app/analytics?view=results"]`).first().click();
        await expect(page.locator('#analytics-performance-heading')).toBeVisible();
        await expect(page.locator('#analytics-setup-quality-heading')).toHaveCount(0);
        await expect(page.locator('#analytics-psychology-heading')).toHaveCount(0);

        await page.locator(`nav a[href="/${locale}/app/analytics?view=edge"]`).first().click();
        await expect(page.locator('#analytics-setup-quality-heading')).toBeVisible();
        await expect(page.locator('#analytics-performance-heading')).toHaveCount(0);

        await page.locator(`nav a[href="/${locale}/app/analytics?view=behavior"]`).first().click();
        await expect(page.locator('#analytics-psychology-heading')).toBeVisible();
        await expect(page.locator('#analytics-setup-quality-heading')).toHaveCount(0);

        const dimensions = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      }
    }

    await page.goto('/en/app/analytics?view=not-a-view');
    await expect(page.locator('#analytics-overview-results')).toBeVisible();
    await expect(page.locator('#analytics-performance-heading')).toHaveCount(0);
  });
});
