import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  emotionTypes,
  mistakeTypes,
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
  tradingAccounts,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { applyToolbarRange } from './support/dashboard-toolbar';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

function daysAgo(days: number, hour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, hour));
}

/** The Dashboard with no applied filter parameters at all. */
const RANGE_UNSET_URL = new RegExp('/en/app$');

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
    };
    /*
      ADD TRADE CONTRACT v1 ROWS (migration 0021). Canonical analytics read only
      these (Add Trade contract §25, §28): Actual R = Final Net P&L / Risk at
      Entry. Price is context only, so no Price plan or Price actual is stored;
      the plan is a Money plan aiming at twice its risk, which is the 1:2 plan
      Avg Planned RR reads from `planned_r`. `planned` rows cannot be contract
      rows and stay legacy.
    */
    const contractPlan = (riskMinor: bigint) => ({
      recordingContract: 'add_trade_v1' as const,
      plannedRiskMinor: riskMinor,
      plannedRewardMinor: riskMinor * 2n,
      targetState: 'fixed' as const,
      plannedR: '2.0000',
    });
    /*
      Final Net P&L and Risk at Entry are chosen so the stored Actual R is
      exactly their quotient: -$1.00 / $1.00 = -1R, +$1.00 / $0.50 = +2R and
      +$1.00 / $1.00 = +1R. The money totals stay ±$1.00 per Trade, which is
      what the Risk Performance figures below are written against.
    */
    const traderFields = (
      exitedAt: Date,
      actualR: string,
      traderOutcome: 'win' | 'loss',
      netPnlMinor: bigint,
      riskMinor: bigint,
    ) => ({
      ...contractPlan(riskMinor),
      status: 'closed' as const,
      actualResultMode: 'money' as const,
      actualInitialRiskMinor: riskMinor,
      actualRiskAnswer: 'matched' as const,
      enteredAt: new Date(exitedAt.getTime() - 60 * 60 * 1000),
      netPnlMinor,
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
      // Migrations 0017/0018: a resolved System result stores its gross R and a
      // known cost, and net R must equal gross minus cost.
      systemGrossR: systemR,
      systemCostR: '0.0000',
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
            realizedPnlMinor: values.netPnlMinor ?? null,
            exitedAt: values.exitedAt as Date,
          });
        }
        return row.id;
      });
    }

    /*
      The System results below are stored exactly as before, and they are all
      LEGACY System R: no trader-confirmed System Assessment exists yet, so
      canonical analytics admit none of them and disclose them as excluded
      coverage instead (docs/calculation-spec.md, "Canonical analytics
      populations").
    */
    const divergentExit = daysAgo(5, 10);
    await insertTrade({
      ...framework,
      symbol: 'XAUUSD',
      ...traderFields(divergentExit, '-1.0000', 'loss', -100n, 100n),
      ...systemFields(new Date(divergentExit.getTime() + 30 * 60 * 1000), '3.0000', 'win'),
    });
    const pendingExit = daysAgo(8, 10);
    await insertTrade({
      ...framework,
      symbol: 'EURUSD',
      ...traderFields(pendingExit, '2.0000', 'win', 100n, 50n),
    });
    const openTime = daysAgo(10, 10);
    await db.insert(trades).values({
      ...framework,
      ...contractPlan(100n),
      symbol: 'NAS100',
      status: 'open',
      actualResultMode: 'money',
      actualInitialRiskMinor: 100n,
      actualRiskAnswer: 'matched',
      enteredAt: openTime,
      ...systemFields(new Date(openTime.getTime() + 30 * 60 * 1000), '-1.0000', 'loss'),
    });
    const olderExit = daysAgo(45, 10);
    await insertTrade({
      ...framework,
      symbol: 'GBPUSD',
      ...traderFields(olderExit, '1.0000', 'win', 100n, 100n),
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

    // D3 Basic KPI row. The seeded Trader population is three Add Trade
    // contract rows: XAUUSD -1R (-100 minor), EURUSD +2R (+100) and GBPUSD +1R
    // (+100), all USD.
    const netPnl = page.locator('[data-dashboard-widget="basic.net-pnl"]');
    const totalR = page.locator('[data-dashboard-widget="basic.total-r"]');
    const winRate = page.locator('[data-dashboard-widget="basic.trade-win-rate"]');
    const plannedRr = page.locator('[data-dashboard-widget="basic.avg-planned-rr"]');
    const avgRPerTrade = page.locator('[data-dashboard-widget="basic.avg-r-per-trade"]');

    await expect(netPnl).toHaveAttribute('data-kpi-status', 'available');
    await expect(netPnl.getByText('+$1.00')).toBeVisible();
    // The currency left the card face — the account strip above already names
    // it — and the population size is the one supporting line that stayed.
    await expect(netPnl.getByText('3 Trades')).toBeVisible();
    await expect(netPnl.getByText('USD · 3 Trades')).toHaveCount(0);
    /*
      -1R + 2R + 1R = +2.00R over three Trades, so +0.67R each, each measured
      against its own Risk at Entry. Every seeded Trade plans a reward of twice
      its risk, which is a 1:2 plan.
    */
    await expect(totalR.getByText('+2.00R')).toBeVisible();
    await expect(plannedRr.getByText('1 : 2.00')).toBeVisible();
    await expect(avgRPerTrade.getByText('+0.67R')).toBeVisible();
    /*
      WIN RATE HAS NO CANONICAL OUTCOMES TO COUNT (Add Trade contract §12, §25).
      Every stored Trader Outcome, contract rows included, is still derived
      from R on close; the trader has chosen none. So the card says so instead
      of printing the 66.67% a derived outcome would give, and it has no
      outcome ring or W/BE/L breakdown to open.
    */
    await expect(winRate).toHaveAttribute('data-kpi-status', 'unavailable');
    await expect(winRate).toHaveAttribute('data-kpi-reason', 'no_outcomes_answered');
    await expect(winRate.getByText('No outcomes chosen yet')).toBeVisible();
    await expect(winRate.getByText('66.67%')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show Win Rate breakdown' })).toHaveCount(0);

    // The three retired cards are gone from the band, not merely renamed.
    for (const retired of ['Profit Factor', 'Day Win %', 'Avg Win / Loss', 'Trade Win %']) {
      await expect(page.locator('#basic-kpi-heading ~ dl').getByText(retired)).toHaveCount(0);
    }
    // Nothing is permanently printed under those four figures any more.
    await expect(winRate.getByText('2W · 0BE · 1L')).toHaveCount(0);

    /*
      Every Trader row here is canonical, so nothing Actual is disclosed as
      excluded. The three stored System results are legacy System R (no
      trader-confirmed System Assessment exists yet), and the page says so in
      one sentence rather than letting the empty comparison below read as lost
      data.
    */
    const coverage = page.locator('[data-legacy-coverage]');
    await expect(coverage).toHaveCount(1);
    await expect(coverage).toHaveAttribute('data-legacy-actual', '0');
    await expect(coverage).toHaveAttribute('data-legacy-system', '3');
    await expect(
      coverage.getByText(
        '3 System results use the earlier System model and are not included. System figures return once System Assessment is recorded under the new model.',
      ),
    ).toBeVisible();

    // Three cards carry an indicator; Net P&L has none, because no Population
    // A money series is published to draw one from, and Win Rate has none
    // because it has no canonical outcomes to split.
    await expect(netPnl.locator('[data-kpi-indicator]')).toHaveCount(0);
    await expect(winRate.locator('[data-kpi-indicator]')).toHaveCount(0);
    for (const [card, kind] of [
      [totalR, 'cumulativeR'],
      [plannedRr, 'riskRewardSplit'],
      [avgRPerTrade, 'divergingBar'],
    ] as const) {
      await expect(card.locator('[data-kpi-indicator]')).toHaveCount(1);
      await expect(card.locator('[data-kpi-indicator]')).toHaveAttribute(
        'data-kpi-indicator',
        kind,
      );
    }

    // One balanced desktop row: five cards, same top edge, equal widths.
    const kpiBoxes = await Promise.all(
      [netPnl, totalR, winRate, plannedRr, avgRPerTrade].map((card) => card.boundingBox()),
    );
    const tops = kpiBoxes.map((box) => Math.round(box?.y ?? -1));
    expect(new Set(tops).size).toBe(1);
    const widths = kpiBoxes.map((box) => box?.width ?? 0);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

    // The definition affordance is a real button: keyboard-operable, not hover-only.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'About Avg Planned RR' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/for every 1R of risk/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/for every 1R of risk/i)).toHaveCount(0);

    /*
      So is the indicator, and it is where the breakdowns went. With no
      canonical outcomes the Win Rate breakdown no longer exists (asserted
      above), so the keyboard path is exercised on the Avg Planned RR detail:
      reached from the keyboard, read back in words, closed with Escape.
    */
    await page.getByRole('button', { name: 'Show Avg Planned RR detail' }).focus();
    await page.keyboard.press('Enter');
    const breakdown = page.locator('[data-slot="kpi-indicator-content"]');
    await expect(
      breakdown.getByText('For every 1R you risked, your Plans aimed at 2.00R.'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(breakdown).toHaveCount(0);

    // Tap, not hover: the same panel opens from a plain click, which is the
    // only gesture a touch device has. It states the plan in words and names
    // the population it averaged, which is the one denominator on this row
    // that can be smaller than the others.
    await page.getByRole('button', { name: 'Show Avg Planned RR detail' }).click();
    await expect(
      page.getByText('For every 1R you risked, your Plans aimed at 2.00R.'),
    ).toBeVisible();
    await expect(page.getByText('Averaged over 3 Trades that had a planned target.')).toBeVisible();
    await page.keyboard.press('Escape');

    /*
      ONE ACCOUNT NAME IN THE DASHBOARD'S OWN CONTENT, AND IT IS THE ONE THAT
      CAN BE CLICKED.

      The toolbar's Account control prints the active Account's name as its
      trigger label. The context strip beneath the page title used to print
      the same string again, roughly 60 vertical pixels below it — the same
      fact twice in one viewport, with the un-actionable copy second. The
      strip keeps what the trigger does NOT carry: mode, currency, balance.
      The shell header's own account indicator is a separate surface, outside
      this page's content, and is deliberately untouched.

      Read from the trigger rather than hard-coded, so this asserts the
      RELATIONSHIP between the two surfaces rather than a seeded literal.
    */
    const accountTrigger = page.locator('[data-dashboard-toolbar-control="account"]');
    const accountName = ((await accountTrigger.textContent()) ?? '').trim();
    expect(accountName.length).toBeGreaterThan(0);
    const accountStrip = page.getByRole('region', { name: 'Active trading account summary' });
    await expect(accountStrip).toBeVisible();
    await expect(accountStrip.getByText(accountName)).toHaveCount(0);
    await expect(accountStrip.getByText('Active account')).toBeVisible();
    await expect(accountStrip.getByText('USD', { exact: true })).toBeVisible();
    // Still read-only context, never a second selector.
    await expect(accountStrip.getByRole('button')).toHaveCount(0);
    // And the shell header stands its own switcher down here for the same
    // reason — the toolbar control below it is this route's account selector.
    // It still renders on every other route, where it is the only one.
    await expect(page.getByRole('button', { name: 'Switch trading account' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

    /*
      The toolbar's open state is a real DOM state, which is what both the
      chevron rotation and the panel's entrance animation are driven from.
      Asserting `data-state` rather than a computed transform keeps this a
      behaviour test: the CSS that reads the attribute is a stylesheet
      concern, the attribute being there at all is not.
    */
    for (const control of ['date-range', 'filters', 'account']) {
      const trigger = page.locator(`[data-dashboard-toolbar-control="${control}"]`);
      await expect(trigger).toHaveAttribute('data-state', 'closed');
      await trigger.click();
      await expect(trigger).toHaveAttribute('data-state', 'open');
      await expect(
        page.locator('[data-slot="popover-content"][data-motion="toolbar"]'),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('data-state', 'closed');
      // Focus returns to the trigger, so the keyboard path is unbroken.
      await expect(trigger).toBeFocused();
    }

    /*
      THE SYSTEM vs TRADER CARD — one merged card since the Dashboard folded
      the System baseline, the Trader baseline and the Execution Gap together
      (every figure in it reads the paired Population C).

      No stored System result is canonical yet: the trader-confirmed System
      Assessment is not implemented, so every seeded System result is legacy
      System R and Population C admits nothing (docs/calculation-spec.md,
      "Canonical analytics populations"). The card must therefore say that
      nothing is comparable — never pair a legacy System R with a canonical
      Actual R, and never draw a plot or a table of nothing.
    */
    const comparison = page.locator('[data-dashboard-panel="execution-gap"]');
    await expect(page.locator('[data-execution-gap-status]')).toHaveAttribute(
      'data-execution-gap-status',
      'empty',
    );
    await expect(
      comparison.getByRole('heading', { level: 2, name: 'System vs Trader' }),
    ).toBeVisible();
    await expect(comparison.locator('[data-execution-gap-state="empty"]')).toBeVisible();
    await expect(
      comparison.getByText(
        'A Trade joins this comparison only once it has both a completed Actual result and a confirmed System result. No eligible Trade in this range has both yet.',
      ),
    ).toBeVisible();
    const gapSummary = comparison.locator('[data-execution-gap-summary]');
    const gapMetric = (key: string) => gapSummary.locator(`[data-execution-gap-metric="${key}"]`);
    // The two headline figures stay in place and say why they have no value.
    await expect(gapSummary.locator('[data-execution-gap-metric]')).toHaveCount(2);
    for (const key of ['totalGap', 'systemEdgeCaptured']) {
      await expect(gapMetric(key)).toHaveAttribute('data-metric-status', 'unavailable');
      await expect(gapMetric(key).getByText('No comparable Trades')).toBeVisible();
    }
    await expect(gapSummary.getByText('Execution Gap')).toBeVisible();
    await expect(gapSummary.getByText('System Edge Captured')).toBeVisible();
    for (const retired of ['averageGap', 'pairedTrades']) {
      await expect(gapSummary.locator(`[data-execution-gap-metric="${retired}"]`)).toHaveCount(0);
    }
    // The legacy figures the seed WOULD have produced never appear: a -5.00R
    // summed gap and a +4.00R System total over legacy System R.
    await expect(comparison.getByText(/-5\.00R|\+4\.00R|0\.00%/)).toHaveCount(0);
    // No plot, no comparison table, no retired strip or distribution bar.
    await expect(comparison.getByRole('img')).toHaveCount(0);
    await expect(comparison.locator('[data-comparison-table]')).toHaveCount(0);
    await expect(comparison.locator('[data-execution-gap-distribution]')).toHaveCount(0);
    await expect(comparison.getByText('Underperformed System')).toHaveCount(0);
    // The two retired baseline cards did not come back beside it.
    await expect(page.locator('[data-dashboard-panel="system"]')).toHaveCount(0);
    await expect(page.locator('[data-dashboard-panel="trader"]')).toHaveCount(0);
    // And no Recent Trades row prints a System R or a Gap beside its Actual R.
    await expect(
      page.locator('[data-dashboard-panel="recent-trades"]').getByText('System R'),
    ).toHaveCount(0);
    // §14 — the Recent Trades preview is three fields (day, symbol, Actual R),
    // so the Strategy and Setup names no longer render anywhere on the
    // Dashboard. The pinned-vs-renamed version-name invariant they used to
    // prove has NOT lost its coverage: it is asserted at the end of this test
    // on the Trade record the row links to, which is where those names live
    // now. Both are checked here so a regression that quietly reintroduces
    // EITHER name on the preview row fails.
    const recentRow = page.locator('[data-recent-trade-row]').first();
    await expect(recentRow).not.toContainText('Pinned Momentum v1');
    await expect(recentRow).not.toContainText('Current Momentum Name');

    // Wait for the App Router client boundary before exercising its Link.
    // The server-rendered values are visible sooner than hydration completes.
    await page.waitForLoadState('networkidle');
    await applyToolbarRange(page, 'Last 30 days');
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
    // Rendered from the SERVER's resolved filter state, so the toolbar button
    // only reads "Last 30 days" once the new tree has actually committed —
    // which is what makes this the assertion that the transition settled
    // rather than merely started.
    await expect(page.locator('[data-dashboard-toolbar-control="date-range"]')).toContainText(
      'Last 30 days',
    );
    // The retired section-local control must not have come back.
    await expect(page.getByRole('link', { name: '30D' })).toHaveCount(0);
    /*
      The range change reaches the canonical Trader figures: 30D holds XAUUSD
      -1R and EURUSD +2R, so +1.00R over two Trades, and the 45-day GBPUSD
      +1R has left the total.
    */
    await expect(totalR.getByText('+1.00R', { exact: true })).toBeVisible();
    await expect(avgRPerTrade.getByText('+0.50R', { exact: true })).toBeVisible();
    // It reaches the coverage disclosure on the System axis's own date gate
    // too: only the XAUUSD (5 days) and NAS100 (10 days) System exits remain.
    await expect(coverage).toHaveAttribute('data-legacy-system', '2');
    // Still no comparable pair — the XAUUSD Actual -1R against its legacy
    // System +3R would have been a -4.00R Gap and -33.33% captured.
    await expect(page.locator('[data-execution-gap-status]')).toHaveAttribute(
      'data-execution-gap-status',
      'empty',
    );
    await expect(gapMetric('totalGap').getByText('No comparable Trades')).toBeVisible();
    await expect(comparison.getByText(/-4\.00R|-33\.33%/)).toHaveCount(0);
    // 30D Net P&L is -100 + 100 = exactly zero: unsigned and neutral, never "+$0.00".
    await expect(netPnl.getByText('$0.00', { exact: true })).toBeVisible();

    /*
      §16 — the row's navigation contract, unchanged in destination and now
      exercised on the whole row rather than on the symbol alone: since the
      preview carries three fields the row itself is the link, so its
      accessible name is "<day> <symbol> <Actual R>" rather than the bare
      symbol.

      This is also where the pinned-version-name invariant is now asserted.
      The Trade shows the Strategy and Setup names PINNED when it was
      recorded, never the renamed current version — the guarantee the Recent
      Trades row used to carry before §14 reduced it to three fields.
    */
    await page.locator('[data-recent-trade-row] a').filter({ hasText: 'XAUUSD' }).first().click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    const details = page.locator('[data-trade-details]');
    await expect(details.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await expect(page.getByText('Current Momentum Name')).toHaveCount(0);
    // The Trades workspace opens the Trade in its Details sheet, whose Plan
    // tab owns both pinned names. It is opened rather than assumed, and read
    // inside the sheet so the Trade table behind it cannot satisfy it.
    await details.locator('[data-trade-details-tab="plan"]').click();
    await expect(details.getByText('Pinned Momentum v1').first()).toBeVisible();
    await expect(details.getByText('Pinned Opening Retest').first()).toBeVisible();
    await expect(page.getByText('Current Momentum Name')).toHaveCount(0);
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

    /*
      The System and Trader baselines were merged into the one System vs
      Trader card, which is what stacks here now. Its canonical state for this
      seed is empty: every seeded System result is legacy System R.
    */
    const comparison = page.locator('[data-dashboard-panel="execution-gap"]');
    // Assert the count rather than letting strict mode throw on it. Under a
    // loaded machine the streamed server tree and the hydrated one can both be
    // attached for a frame; `toHaveCount` polls through that, while a panel
    // that genuinely rendered twice still fails here.
    await expect(comparison).toHaveCount(1);
    await expect(comparison).toBeVisible();
    await expect(page.locator('[data-dashboard-panel="system"]')).toHaveCount(0);
    await expect(page.locator('[data-dashboard-panel="trader"]')).toHaveCount(0);

    // Two-column KPI grid at narrow widths, with the fifth card spanning both.
    const netPnl = page.locator('[data-dashboard-widget="basic.net-pnl"]');
    const totalR = page.locator('[data-dashboard-widget="basic.total-r"]');
    const winRate = page.locator('[data-dashboard-widget="basic.trade-win-rate"]');
    const avgRPerTrade = page.locator('[data-dashboard-widget="basic.avg-r-per-trade"]');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const [first, second, last] = await Promise.all([
        netPnl.boundingBox(),
        totalR.boundingBox(),
        avgRPerTrade.boundingBox(),
      ]);
      // Cards one and two share a row; neither value nor label is clipped away.
      expect(Math.round(first?.y ?? -1)).toBe(Math.round(second?.y ?? -2));
      expect(second?.x ?? 0).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0) - 1);
      expect(last?.width ?? 0).toBeGreaterThan((first?.width ?? 0) * 1.5);
      await expect(netPnl.getByText('+$1.00')).toBeVisible();
      await expect(totalR.getByText('+2.00R')).toBeVisible();
      // The unavailable Win Rate reason is a sentence, and it must stay
      // readable inside its half-width card rather than overflow it.
      await expect(winRate.getByText('No outcomes chosen yet')).toBeVisible();
      const winRateInner = await winRate.evaluate((node) => ({
        scroll: node.scrollWidth,
        client: node.clientWidth,
      }));
      expect(winRateInner.scroll).toBeLessThanOrEqual(winRateInner.client + 1);

      // The merged comparison card stacks full width and never scrolls
      // sideways; its empty state and headline labels stay legible.
      const gapBox = await comparison.boundingBox();
      expect(gapBox?.width ?? 0).toBeGreaterThan(width * 0.7);
      const gapInner = await comparison.evaluate((node) => ({
        scroll: node.scrollWidth,
        client: node.clientWidth,
      }));
      expect(gapInner.scroll).toBeLessThanOrEqual(gapInner.client + 1);
      await expect(comparison.getByText('Execution Gap', { exact: true }).first()).toBeVisible();
      await expect(comparison.locator('[data-execution-gap-state="empty"]')).toBeVisible();
      const size = await comparison
        .locator('[data-execution-gap-metric="totalGap"] dd')
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(size).toBeGreaterThanOrEqual(12);
      await expect(page.getByRole('button', { name: 'About Net P&L' })).toBeVisible();
      const kpiOverflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(kpiOverflow.scroll).toBeLessThanOrEqual(kpiOverflow.client + 1);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    // The comparison card sits below the KPI band, never beside it.
    const kpiBox = await avgRPerTrade.boundingBox();
    const comparisonBox = await comparison.boundingBox();
    expect(comparisonBox?.y ?? 0).toBeGreaterThan((kpiBox?.y ?? 0) + (kpiBox?.height ?? 0) - 1);

    const range = page.locator('[data-dashboard-toolbar-control="date-range"]');
    const rangeBox = await range.boundingBox();
    expect(rangeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.waitForLoadState('networkidle');

    // At this width the picker opens as a near-full-height sheet rather than a
    // shrunken popover: two stacked months, and a Clear/Apply footer that stays
    // put while the months scroll.
    await range.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-range-month]')).toHaveCount(2);
    await sheet.getByRole('button', { name: 'Last 30 days', exact: true }).click();
    // DRAFT ONLY — still the original URL, still the original applied range.
    await expect(page).toHaveURL(RANGE_UNSET_URL);
    await sheet.locator('[data-dashboard-toolbar-apply="date-range"]').click();
    // The mobile half of the very same App Router transition the desktop case
    // above describes, and load-sensitive for the identical reason — so it
    // carries the identical bounded allowance rather than the 5s default.
    await expect(page).toHaveURL(/range=30d/, { timeout: 15_000 });
    // Server-rendered from the resolved filter state, so it only reads 'page'
    // once the new tree has committed: the transition settled, not just started.
    await expect(range).toContainText('Last 30 days');
    await expect(page.getByRole('link', { name: 'XAUUSD' })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/app?range=90d');
    await expect(comparison).toBeVisible();
    await expect(page.locator('[data-dashboard-widget="basic.total-r"]')).toBeVisible();
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

    /*
      R2C §2 — a Dashboard URL that names NO range resolves to All time.
      Asserted here, on the one section that labels the applied range, so the
      default cannot drift back to a silent bounded window unnoticed.
    */
    await gotoRisk(page, '/en/app');
    await expect(page.locator('[data-risk-range]')).toHaveAttribute('data-risk-range', 'all');
    // The All range carries nothing in, so its opening sentence moved to the
    // info popover — only the carried (bounded) case keeps it on the face.
    await expect(page.locator('[data-risk-opening]')).toHaveCount(0);
    await expect(
      section.getByText('Modeled from the declared Starting Balance of $10,000.00.'),
    ).toHaveCount(0);

    /*
      90D — a BOUNDED window that happens to reach back past all three closed
      Trades. It is no longer the default, so it is named explicitly; without
      it this test would lose the third opening case entirely.
    */
    await gotoRisk(page, '/en/app?range=90d&unit=r');
    await expect(page.getByRole('heading', { level: 2, name: RISK_HEADING })).toBeVisible();
    await expect(status).toHaveAttribute('data-risk-status', 'available');
    await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
    await expect(metric('modeledBalance').getByText('Modeled Balance')).toBeVisible();
    // The face is exactly two figures. Current Drawdown leads with its
    // percentage and names the money amount as the distance below the peak.
    await expect(metric('currentDrawdown').getByText('0.01%')).toBeVisible();
    await expect(metric('currentDrawdown').getByText('$1.00 below peak')).toBeVisible();
    await expect(section.locator('[data-risk-metric]')).toHaveCount(2);
    for (const retired of ['periodPnl', 'peakBalance', 'maxDrawdown']) {
      await expect(section.locator(`[data-risk-metric="${retired}"]`)).toHaveCount(0);
    }
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
    // The carried-opening guard is REQUIRED here: a bounded window inherits a
    // balance and a high-water mark from before it opened.
    await expect(page.locator('[data-risk-opening]')).toHaveAttribute(
      'data-risk-opening',
      'carried',
    );
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
    await expect(page.locator('[data-risk-opening]')).toHaveCount(0);
    await expect(metric('modeledBalance').getByText('$10,001.00')).toBeVisible();
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
      await expect(metric('currentDrawdown').getByText('0.01%')).toBeVisible();
      await expect(metric('currentDrawdown').getByText('$1.00 below peak')).toBeVisible();
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
    /*
      A BOUNDED range, named explicitly. The opening sentence asserted below
      is the bounded case — "nothing was carried into this range" — and since
      R2C §2 the Dashboard's own default is All time, which has no "before the
      range" to carry anything from and correctly says something else. Naming
      the range here keeps this test on the case it was written for.
    */
    await gotoRisk(page, '/en/app?range=90d&unit=r');

    const section = page.locator('[data-dashboard-panel="risk-performance"]');
    const metric = (key: string) => section.locator(`[data-risk-metric="${key}"]`);

    // AVAILABLE, not empty and not an error: every figure below is true.
    await expect(page.locator('[data-risk-status]')).toHaveAttribute(
      'data-risk-status',
      'available',
    );
    await expect(metric('modeledBalance').getByText('$10,000.00')).toBeVisible();
    // §8 — the zero case states its status in words instead of leaving a
    // bare $0.00 that reads as missing data. The percentage still leads.
    await expect(metric('currentDrawdown').getByText('0.00%')).toBeVisible();
    await expect(metric('currentDrawdown').getByText('At high-water mark')).toBeVisible();
    await expect(metric('currentDrawdown').getByText(/no risk|risk.free|safe/i)).toHaveCount(0);
    await expect(metric('currentDrawdown')).toHaveAttribute('data-risk-drawdown', 'zero');
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
      await expect(metric('currentDrawdown').getByText('$1.00 below peak')).toBeVisible();
      await expect(section.locator('[data-risk-metric]')).toHaveCount(2);

      // The mobile priority order, read straight off the DOM: capital state
      // first, then how far below the peak it stands.
      const order = await section.evaluate((node) =>
        [...node.querySelectorAll('[data-risk-metric]')].map((child) =>
          child.getAttribute('data-risk-metric'),
        ),
      );
      expect(order).toEqual(['modeledBalance', 'currentDrawdown']);

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

/**
 * D8B — the three compact insight pillars.
 *
 * This block seeds its OWN workspace rather than reusing
 * `provisionDashboardUser`. The shared Dashboard seed has three closed
 * Trades, which is below D8A's five-observation policy floor by design — good
 * for asserting an insufficient sample, useless for asserting a real insight.
 * Seeding separately also means none of D3–D7's existing assertions move.
 *
 * Two Accounts:
 *   rich    24 closed Trades, Emotion tags, canonical confidence levels,
 *           snapshotted required rule checks, and a mistake-tagged cohort
 *   empty   no Trades at all
 */
test.describe('Dashboard insight pillars', () => {
  interface InsightFixture {
    readonly email: string;
    readonly password: string;
    readonly id: string;
    readonly richAccountId: string;
    readonly emptyAccountId: string;
    readonly strategyId: string;
    readonly setupId: string;
  }

  async function provisionInsightUser(prefix: string): Promise<InsightFixture> {
    const { testUrl } = validateTestDatabaseEnvironment();
    const email = `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const user = await provisionVerifiedUser(
      testUrl,
      { email, password: 'Correct-Horse9!', name: 'E2E Insight Tester' },
      { entitlement: { status: 'active', planKey: 'professional' } },
    );

    const client = postgres(testUrl, { max: 1 });
    const db = drizzle(client, {
      schema: {
        workspaces,
        tradingAccounts,
        strategies,
        strategyVersions,
        strategyRules,
        setups,
        strategySetupVersions,
        trades,
        tradeExits,
        tradeEmotions,
        tradeRuleChecks,
        tradeMistakes,
        emotionTypes,
        mistakeTypes,
      },
    });
    try {
      const [workspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.personalOwnerUserId, user.id));
      if (workspace === undefined) throw new Error('Insight E2E workspace missing');
      const workspaceId = workspace.id;

      const [rich] = await db
        .select({ id: tradingAccounts.id })
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      if (rich === undefined) throw new Error('Insight E2E Account missing');
      await db
        .update(tradingAccounts)
        .set({ name: 'Insight Rich', timezone: 'UTC' })
        .where(eq(tradingAccounts.id, rich.id));

      const [empty] = await db
        .insert(tradingAccounts)
        .values({
          workspaceId,
          name: 'Insight Empty',
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '10000',
          timezone: 'UTC',
        })
        .returning({ id: tradingAccounts.id });
      if (empty === undefined) throw new Error('Insight E2E empty Account insert failed');

      const [strategy] = await db
        .insert(strategies)
        .values({ workspaceId })
        .returning({ id: strategies.id });
      if (strategy === undefined) throw new Error('Insight E2E Strategy insert failed');
      const [version] = await db
        .insert(strategyVersions)
        .values({
          workspaceId,
          strategyId: strategy.id,
          versionNumber: 1,
          name: 'Insight Momentum v1',
        })
        .returning({ id: strategyVersions.id });
      if (version === undefined) throw new Error('Insight E2E Version insert failed');
      await db
        .update(strategies)
        .set({ currentVersionId: version.id })
        .where(eq(strategies.id, strategy.id));
      const [setup] = await db
        .insert(setups)
        .values({ workspaceId, strategyId: strategy.id })
        .returning({ id: setups.id });
      if (setup === undefined) throw new Error('Insight E2E Setup insert failed');
      const [setupVersion] = await db
        .insert(strategySetupVersions)
        .values({
          workspaceId,
          strategyId: strategy.id,
          strategyVersionId: version.id,
          setupId: setup.id,
          name: 'Insight Opening Retest',
        })
        .returning({ id: strategySetupVersions.id });
      if (setupVersion === undefined) throw new Error('Insight E2E Setup Version insert failed');

      const [rule] = await db
        .insert(strategyRules)
        .values({
          workspaceId,
          strategyVersionId: version.id,
          category: 'entry',
          title: 'Wait for confirmation candle',
          isRequired: true,
          isPreTradeCheck: true,
          sortOrder: 0,
        })
        .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
      if (rule === undefined) throw new Error('Insight E2E rule insert failed');
      const ruleId = rule.id;
      const ruleKey = rule.ruleKey;
      const versionId = version.id;
      const strategyId = strategy.id;
      const setupId = setup.id;
      const setupVersionId = setupVersion.id;

      const emotionRows = await db
        .select({ id: emotionTypes.id, key: emotionTypes.key })
        .from(emotionTypes);
      const emotionByKey = new Map(emotionRows.map((row) => [row.key, row.id]));
      const [movedStop] = await db
        .select({ id: mistakeTypes.id })
        .from(mistakeTypes)
        .where(eq(mistakeTypes.key, 'moved_stop'));

      for (let index = 0; index < 24; index += 1) {
        // 0–13 disciplined and calm; 14–21 fear-tagged rule violations that
        // also carry a mistake tag; 22–23 with an incomplete required check.
        const violating = index >= 14 && index < 22;
        const incomplete = index >= 22;
        const actualR = violating ? '-0.9000' : index % 4 === 0 ? '-0.6000' : '1.1000';
        const systemR = violating ? '0.8000' : index % 4 === 0 ? '-0.5000' : '1.2000';
        const exitedAt = daysAgo(60 - index * 2, 12);
        await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(trades)
            .values({
              workspaceId,
              tradingAccountId: rich.id,
              strategyId,
              strategyVersionId: versionId,
              setupId,
              setupVersionId,
              symbol: ['XAUUSD', 'EURUSD', 'GBPUSD', 'NAS100'][index % 4] as string,
              direction: 'long',
              // An Add Trade contract v1 Money row: Actual R is Final Net P&L
              // over Risk at Entry, the only Actual R canonical analytics read.
              recordingContract: 'add_trade_v1',
              plannedRiskMinor: 10_000n,
              plannedRewardMinor: 20_000n,
              targetState: 'fixed',
              plannedR: '2.0000',
              status: 'closed',
              actualResultMode: 'money',
              actualInitialRiskMinor: 10_000n,
              actualRiskAnswer: 'matched',
              enteredAt: new Date(exitedAt.getTime() - 3_600_000),
              exitedAt,
              netPnlMinor: BigInt(Math.round(Number(actualR) * 10_000)),
              actualR,
              traderOutcome: Number(actualR) >= 0 ? 'win' : 'loss',
              confidence: violating ? 25 : 75,
              systemStatus: 'resolved',
              systemResolutionKind: 'price_exit',
              systemExitPrice: '102.0000000000',
              systemCostR: '0.0000',
              systemExitedAt: new Date(exitedAt.getTime() + 1_800_000),
              systemExitReason: 'target_hit',
              systemResolvedAt: new Date(exitedAt.getTime() + 1_800_000),
              systemGrossR: systemR,
              systemR,
              systemOutcome: Number(systemR) >= 0 ? 'win' : 'loss',
            })
            .returning({ id: trades.id });
          if (row === undefined) throw new Error('Insight E2E Trade insert failed');
          await tx.insert(tradeExits).values({
            workspaceId,
            tradeId: row.id,
            mutationKey: crypto.randomUUID(),
            sequence: 1,
            closedBps: 10_000,
            realizedPnlMinor: BigInt(Math.round(Number(actualR) * 10_000)),
            exitedAt,
          });
          const emotionTypeId = emotionByKey.get(violating ? 'fear' : 'calm');
          if (emotionTypeId !== undefined) {
            await tx.insert(tradeEmotions).values({ workspaceId, tradeId: row.id, emotionTypeId });
          }
          await tx.insert(tradeRuleChecks).values({
            workspaceId,
            tradeId: row.id,
            strategyRuleId: ruleId,
            strategyVersionId: versionId,
            ruleKey,
            checkStatus: incomplete ? 'not_checked' : violating ? 'violated' : 'followed',
            title: 'Wait for confirmation candle',
            category: 'entry',
            isRequired: true,
            isPreTradeCheck: true,
            sortOrder: 0,
          });
          if (violating && movedStop !== undefined) {
            await tx.insert(tradeMistakes).values({
              workspaceId,
              tradeId: row.id,
              mistakeTypeId: movedStop.id,
              severityAtTime: 'moderate',
              weightAtTime: '1.0000',
            });
          }
        });
      }

      return {
        email: user.email,
        password: user.password,
        id: user.id,
        richAccountId: rich.id,
        emptyAccountId: empty.id,
        strategyId,
        setupId,
      };
    } finally {
      await client.end();
    }
  }

  /**
   * Navigate, then wait for the pillars to settle at exactly three.
   *
   * D8 is a streamed Suspense boundary, so under load the streamed server
   * tree and the hydrated one can both be attached for a frame — the same
   * accommodation D7's Risk section makes. Polling the count settles that
   * before any strict locator reads from it.
   */
  async function gotoInsights(page: Page, url: string) {
    await page.goto(url);
    await expect(page.locator('[data-insight-pillar]')).toHaveCount(3, { timeout: 20_000 });
    /*
      COUNT IS NOT LAYOUT. The pillars are a streamed Suspense boundary, so
      `toHaveCount(3)` resolves the instant their HTML lands — which can be
      before the browser has laid the subtree out. A `boundingBox()` taken in
      that window returns `null`, and any caller measuring geometry then reads
      it as a zero-width card.

      That is a race in the measurement, not in the product: it only surfaced
      when this file ran alongside the other Dashboard specs against one
      shared Neon test database, where the insight read queues behind them
      (the same contention `dashboard-calendar.spec.ts` pins itself to serial
      mode for). Waiting for visibility is Playwright's own answer and costs
      the assertions nothing — every geometric expectation below still runs
      against the real rendered card.
    */
    for (const name of ['strategy', 'psychology', 'discipline'] as const) {
      await expect(pillar(page, name)).toBeVisible({ timeout: 20_000 });
    }
  }

  const pillar = (page: Page, name: 'strategy' | 'psychology' | 'discipline') =>
    page.locator(`[data-insight-pillar="${name}"]`);

  test('desktop renders three pillars that follow Account and range but not Strategy', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionInsightUser('e2e-insight-desktop');
    await loginAs(page, 'en', user);
    const rich = `account=${user.richAccountId}`;

    await gotoInsights(page, `/en/app?range=all&unit=r&${rich}`);
    await expect(
      page.getByRole('heading', { level: 3, name: 'Strategy Performance' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Psychology Performance' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Discipline Performance' }),
    ).toBeVisible();
    /*
      THE UNFILTERED STRATEGY CARD RANKS STRATEGIES BY SYSTEM EXPECTANCY, AND
      NO SYSTEM RESULT IS CANONICAL YET. The 24 seeded System results are
      legacy System R, so no Strategy has the five System observations a
      ranking needs: the card reports a sample below policy instead of naming a
      "strongest" Strategy from legacy evidence. It is not an empty card — the
      24 canonical Actual results are still in scope.
    */
    await expect(pillar(page, 'strategy')).toHaveAttribute(
      'data-insight-status',
      'insufficient_sample',
    );
    await expect(pillar(page, 'strategy')).toHaveAttribute(
      'data-insight-reason',
      'sample_below_policy',
    );
    await expect(pillar(page, 'strategy').locator('[data-insight-headline]')).toHaveCount(0);
    await expect(pillar(page, 'strategy').getByText('Strongest observed Strategy')).toHaveCount(0);
    // Discipline reads rule checks over the canonical Actual population: 22 of
    // the 24 Trades completed their required check, a supported sample.
    await expect(pillar(page, 'discipline')).toHaveAttribute('data-insight-status', 'available');
    await expect(pillar(page, 'discipline').locator('[data-insight-headline]')).not.toHaveCount(0);

    // §5 — typography only. No chart, gauge, meter or ranking table anywhere
    // in the section.
    for (const name of ['strategy', 'psychology', 'discipline'] as const) {
      await expect(pillar(page, name).locator('svg.recharts-surface')).toHaveCount(0);
      await expect(
        pillar(page, name).locator('table, [role="progressbar"], [role="meter"]'),
      ).toHaveCount(0);
    }
    // §16/§17 — never causal, never a cost, never an unsupported score.
    const section = page.locator('[data-insight-pillar]').first().locator('xpath=../..');
    await expect(
      section.getByText(/discipline score|trader grade|cost you|caused by/i),
    ).toHaveCount(0);

    // Each pillar routes into the EXISTING Analytics view contract.
    await expect(
      page.getByRole('link', { name: 'View Strategy Performance in Analytics' }),
    ).toHaveAttribute('href', /\/analytics\?view=edge/);
    await expect(
      page.getByRole('link', { name: 'View Psychology Performance in Analytics' }),
    ).toHaveAttribute('href', /view=behavior/);
    await expect(
      page.getByRole('link', { name: 'View Discipline Performance in Analytics' }),
    ).toHaveAttribute('href', /view=results/);

    /*
      THE DATE RANGE MOVES THE INSIGHTS. 30D reaches only the most recent
      Trades, which is a genuinely smaller cohort than All: seven evaluated
      Trades instead of 22, so Discipline drops from a supported to a limited
      sample. (Asserted on Discipline because the Strategy card is below
      policy in every range until canonical System results exist.)
    */
    await gotoInsights(page, `/en/app?range=30d&unit=r&${rich}`);
    await expect(pillar(page, 'discipline')).toHaveAttribute(
      'data-insight-status',
      'limited_sample',
    );
    await expect(pillar(page, 'strategy')).toHaveAttribute(
      'data-insight-status',
      'insufficient_sample',
    );

    /*
      THE ACCOUNT MOVES THE INSIGHTS, AND AN EMPTY ACCOUNT KEEPS ALL THREE
      PILLARS AS PRODUCT SURFACES (§25) — never a vanished section, never a
      fabricated zero.
    */
    await gotoInsights(page, `/en/app?range=all&unit=r&account=${user.emptyAccountId}`);
    for (const name of ['strategy', 'psychology', 'discipline'] as const) {
      await expect(pillar(page, name)).toHaveAttribute('data-insight-status', 'no_eligible_trades');
      await expect(pillar(page, name).locator('[data-insight-headline]')).toHaveCount(0);
    }
    /*
      Scoped to the pillars on purpose. D7's Risk section also says "No closed
      Trades yet." on an empty Account — both are true, each explains itself
      differently underneath, and §25 specifies this exact Strategy wording, so
      the assertion names WHICH section it means rather than the copy being
      changed to dodge a strict-mode collision.
    */
    await expect(pillar(page, 'strategy').getByText('No eligible closed Trades yet')).toBeVisible();
    await expect(pillar(page, 'psychology').getByText('No eligible Trades yet')).toBeVisible();
    await expect(pillar(page, 'discipline').getByText('No evaluated Trades yet')).toBeVisible();

    /*
      §7 — with a Strategy selected the Strategy card must not re-announce
      that same Strategy as a winner. D8A answers with the selected
      Strategy's health (or its Setup breakdown) instead.
    */
    await gotoInsights(page, `/en/app?range=all&unit=r&${rich}&strategy=${user.strategyId}`);
    await expect(pillar(page, 'strategy').getByText('Strongest observed Strategy')).toHaveCount(0);
    await expect(pillar(page, 'strategy')).toHaveAttribute(
      'data-insight-status',
      /available|limited_sample/,
    );

    // Strategy/Setup deliberately scope Psychology and Discipline too.
    await expect(pillar(page, 'psychology').locator('[data-insight-statement]')).not.toHaveCount(0);
    await expect(pillar(page, 'discipline').locator('[data-insight-statement]')).not.toHaveCount(0);
  });

  /**
   * D7 Risk is an ACCOUNT-level metric. A Strategy or Setup filter narrows
   * the three insight pillars and must leave the modeled balance untouched —
   * the one cross-section invariant D8 could plausibly have broken.
   */
  test('leaves D7 Risk Performance unchanged under a Strategy or Setup filter', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionInsightUser('e2e-insight-risk');
    await loginAs(page, 'en', user);
    const rich = `account=${user.richAccountId}`;
    const riskFigures = async () => {
      const risk = page.locator('[data-dashboard-panel="risk-performance"]');
      return {
        balance: await risk.locator('[data-risk-metric="modeledBalance"]').innerText(),
        current: await risk.locator('[data-risk-metric="currentDrawdown"]').innerText(),
      };
    };

    await gotoInsights(page, `/en/app?range=all&unit=r&${rich}`);
    await expect(page.locator('[data-dashboard-panel="risk-performance"]')).toHaveCount(1);
    const unfiltered = await riskFigures();

    await gotoInsights(page, `/en/app?range=all&unit=r&${rich}&strategy=${user.strategyId}`);
    expect(await riskFigures()).toEqual(unfiltered);

    await gotoInsights(page, `/en/app?range=all&unit=r&${rich}&setup=${user.setupId}`);
    expect(await riskFigures()).toEqual(unfiltered);
    // And the section says why its figures did not move.
    await expect(
      page.getByText(
        'Account-level metric. Strategy and Setup filters do not change modeled balance.',
      ),
    ).toBeVisible();
  });

  test('mobile stacks the three pillars with no horizontal overflow', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(300_000);
    const user = await provisionInsightUser('e2e-insight-mobile');
    await loginAs(page, 'en', user);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await gotoInsights(page, `/en/app?range=all&unit=r&account=${user.richAccountId}`);

      const boxes = await Promise.all(
        (['strategy', 'psychology', 'discipline'] as const).map((name) =>
          pillar(page, name).boundingBox(),
        ),
      );
      // One column: each card is nearly the full width, and each starts below
      // the previous one.
      for (const box of boxes) {
        expect(box?.width ?? 0).toBeGreaterThan(width * 0.7);
      }
      for (let i = 1; i < boxes.length; i += 1) {
        const previous = boxes[i - 1];
        const current = boxes[i];
        expect(current?.y ?? 0).toBeGreaterThan((previous?.y ?? 0) + (previous?.height ?? 0) - 1);
      }
      // The primary insight is still readable, not squeezed into a third of
      // the screen. Read on Discipline: the unfiltered Strategy card has no
      // canonical System results to rank and states that instead.
      await expect(
        pillar(page, 'discipline').locator('[data-insight-headline]').first(),
      ).toBeVisible();
      await expect(pillar(page, 'strategy').getByText('Not enough Trades yet')).toBeVisible();

      const document_ = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(document_.scroll).toBeLessThanOrEqual(document_.client + 1);
    }
  });
});
