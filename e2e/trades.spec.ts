import { expect, test, type Page } from '@playwright/test';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

async function provisionJournalUser(prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(testUrl, {
    email,
    password: 'Correct-Horse9!',
    name: 'E2E Journal Tester',
  });
}

async function seedFramework(userId: string, withConditions = true): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      workspaces,
      strategies,
      strategyVersions,
      strategyRules,
      setups,
      setupConditions,
      strategySetupVersions,
    },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Trade E2E workspace missing');
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: workspace.id })
      .returning();
    if (strategy === undefined) throw new Error('Trade E2E Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 1,
        name: 'Golden Breakout',
      })
      .returning();
    if (version === undefined) throw new Error('Trade E2E Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
    await db.insert(strategyRules).values({
      workspaceId: workspace.id,
      strategyVersionId: version.id,
      category: 'entry',
      title: 'Wait for confirmation',
      isRequired: true,
      isPreTradeCheck: true,
    });
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: workspace.id, strategyId: strategy.id })
      .returning();
    if (setup === undefined) throw new Error('Trade E2E Setup insert failed');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        name: 'Clean Retest',
        sortOrder: 0,
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('Trade E2E Setup Version insert failed');
    if (withConditions) {
      await db.insert(setupConditions).values(
        [
          'Breakout candle closed',
          'Retest held',
          'Volume expanded',
          'Invalidation is clear',
          'Session is aligned',
        ].map((label, sortOrder) => ({
          workspaceId: workspace.id,
          setupId: setup.id,
          setupVersionId: setupVersion.id,
          label,
          sortOrder,
        })),
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Trading Calendar (Phase 14D) fixture — direct inserts, exactly the load-
 * bearing date scenarios the phase brief names: Trade B (Actual-first, System
 * still Pending), Trade C (Actual Aug 20, System resolves the NEXT day, Aug
 * 21 — proving the two axes never collapse to one date), and an unclassified
 * open/System-No-Trade Trade (proving "Add Strategy"/late-classification remains reachable
 * from a Calendar-filtered day). All Money-only Plan (never Price) — this
 * fixture exercises the Calendar's READ side against known dates; the
 * Open/Close/System-resolve WRITE flows are already proven end-to-end by the
 * Phase 13/14C journeys elsewhere in this file.
 */
async function seedCalendarTrades(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaces, tradingAccounts, trades, tradeExits } });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Trade E2E Calendar workspace missing');
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Trade E2E Calendar account missing');

    const basePlan = {
      workspaceId: workspace.id,
      tradingAccountId: account.id,
      direction: 'long' as const,
      plannedRiskMinor: 100n,
      plannedRewardMinor: 200n,
      plannedR: '2.0000',
    };

    // Trade B — Actual-first: closed Aug 20, System left Pending.
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(trades)
        .values({
          ...basePlan,
          symbol: 'ACTUALFIRST',
          status: 'closed',
          systemStatus: 'pending',
          actualResultMode: 'money',
          actualInitialRiskMinor: 100n,
          enteredAt: new Date('2026-08-20T08:00:00Z'),
          exitedAt: new Date('2026-08-20T10:00:00Z'),
          netPnlMinor: -50n,
          actualR: '-0.5000',
          traderOutcome: 'loss',
        })
        .returning({ id: trades.id });
      if (row === undefined) throw new Error('Trade B insert failed');
      await tx.insert(tradeExits).values({
        workspaceId: workspace.id,
        tradeId: row.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: 10_000,
        realizedPnlMinor: -50n,
        exitedAt: new Date('2026-08-20T10:00:00Z'),
      });
    });

    // Trade C — Actual finalizes Aug 20; System resolves the NEXT day, Aug 21.
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(trades)
        .values({
          ...basePlan,
          symbol: 'CROSSDATE',
          status: 'closed',
          systemStatus: 'resolved',
          actualResultMode: 'money',
          actualInitialRiskMinor: 100n,
          enteredAt: new Date('2026-08-20T09:00:00Z'),
          exitedAt: new Date('2026-08-20T11:00:00Z'),
          netPnlMinor: 100n,
          actualR: '1.0000',
          traderOutcome: 'win',
          systemResolutionKind: 'money_target',
          systemGrossRInput: '2.0000',
          systemExitedAt: new Date('2026-08-21T09:00:00Z'),
          systemExitReason: 'target_hit',
          systemResolvedAt: new Date('2026-08-21T09:00:00Z'),
          systemR: '5.0000',
          systemOutcome: 'win',
        })
        .returning({ id: trades.id });
      if (row === undefined) throw new Error('Trade C insert failed');
      await tx.insert(tradeExits).values({
        workspaceId: workspace.id,
        tradeId: row.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: 10_000,
        realizedPnlMinor: 100n,
        exitedAt: new Date('2026-08-20T11:00:00Z'),
      });
    });

    // Unclassified, still-Open/System-No-Trade Trade entered Aug 20 — gives
    // classification its own one-action row without competing with the
    // higher-priority pending-System action proven by ACTUALFIRST.
    await db.insert(trades).values({
      ...basePlan,
      symbol: 'UNCLASSIFIEDOPEN',
      status: 'open',
      systemStatus: 'no_trade',
      systemExitReason: 'setup_invalidated',
      systemResolvedAt: new Date('2026-08-20T12:05:00Z'),
      actualResultMode: 'money',
      actualInitialRiskMinor: 100n,
      enteredAt: new Date('2026-08-20T12:00:00Z'),
    });
  } finally {
    await client.end();
  }
}

async function readConditionChecks(tradeId: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, { schema: { tradeSetupConditionChecks } });
  try {
    return await db
      .select({
        label: tradeSetupConditionChecks.label,
        checkStatus: tradeSetupConditionChecks.checkStatus,
      })
      .from(tradeSetupConditionChecks)
      .where(eq(tradeSetupConditionChecks.tradeId, tradeId))
      .orderBy(asc(tradeSetupConditionChecks.sortOrder));
  } finally {
    await client.end();
  }
}

const TRADE_SECTION_LABEL = {
  actual: 'Actual',
  system: 'System',
  strategy: 'Strategy & Setup',
  entry: 'Entry Snapshot',
  review: 'Review',
} as const;

/**
 * Phase 15E — Trade Detail now shows exactly one of five sections at a time
 * (`TradeSectionNav`). Clicks the matching nav item, the same way a real user
 * would reach that section, rather than editing the `?section=` URL param
 * directly.
 */
async function openTradeSection(page: Page, section: keyof typeof TRADE_SECTION_LABEL) {
  await page
    .getByRole('navigation', { name: 'Trade sections' })
    .getByRole('link', { name: new RegExp(`^${TRADE_SECTION_LABEL[section]}`) })
    .click();
}

/** Expands Entry Snapshot's "Show full details" native disclosure — idempotent per fresh render. */
async function expandEntrySnapshotDetails(page: Page) {
  await page.getByText('Show full details', { exact: true }).click();
}

/**
 * Phase 14E — Open/Close-Only Trade Flow: the normal customer New Trade form
 * now requires one authoritative Actual execution basis alongside the
 * optional Plan, and creates the Trade already `open` in one atomic action
 * — never a separate "Open" step after. Price mode: Actual Entry/Stop match
 * the Plan's own Entry/Stop (100/90) exactly, so every downstream R-value
 * assertion in this file (weighted Partial Close R, etc.) is unaffected by
 * this phase's change.
 */
async function createOpenTrade(page: Page) {
  await page.getByRole('link', { name: 'Log a trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
  await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
  await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);
  await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
  await page.getByRole('button', { name: 'Long' }).click();
  await page.getByLabel('Entry', { exact: true }).fill('100');
  await page.getByLabel('Stop', { exact: true }).fill('90');
  await page.getByLabel(/Target/).fill('130');
  await page.getByLabel('Actual entry').fill('100');
  await page.getByLabel('Initial Stop').fill('90');
  await page.getByLabel('Breakout candle closed').check();
  await page.getByLabel('Retest held').check();
  await page.getByLabel('Volume expanded').check();
  await page.getByLabel('Invalidation is clear').check();
  await page.getByLabel('Session is aligned').check();
  await page.getByRole('button', { name: 'Open Trade' }).click();
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
}

/**
 * Founder-UAT Trade Plan UX correction slice — a Money-only Plan (no Price
 * fields at all). Phase 14E: the required Actual execution basis is Money
 * mode too, Initial risk matching the Plan's own Planned risk (100.00)
 * exactly, so downstream R-value assertions are unaffected.
 */
async function createMoneyOnlyOpenTrade(page: Page) {
  await page.getByRole('link', { name: 'Log a trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
  await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
  await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);
  await page.getByRole('textbox', { name: 'Symbol' }).fill('EURUSD');
  await page.getByRole('button', { name: 'Short' }).click();
  await page.getByRole('button', { name: 'Add a Money plan' }).click();
  await page.getByLabel('Planned risk').fill('100.00');
  await page.getByLabel(/Planned reward/).fill('300.00');
  await page.getByLabel('Actual result mode').selectOption('money');
  await page.getByLabel('Initial risk').fill('100.00');
  await page.getByLabel('Breakout candle closed').check();
  await page.getByLabel('Retest held').check();
  await page.getByLabel('Volume expanded').check();
  await page.getByLabel('Invalidation is clear').check();
  await page.getByLabel('Session is aligned').check();
  await page.getByRole('button', { name: 'Open Trade' }).click();
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
}

async function completeTradeLifecycle(page: Page) {
  // Phase 15E — Rule status and Mistake attachment now live in the Review
  // section, colocated with the rest of Trade Management (brief §29).
  await openTradeSection(page, 'review');
  const ruleStatus = page.getByRole('combobox', {
    name: 'Rule status for Wait for confirmation',
  });
  await ruleStatus.selectOption('followed');
  await expect(ruleStatus).toBeEnabled({ timeout: 30_000 });
  await expect(ruleStatus).toHaveValue('followed');

  await page.getByLabel('Mistake type').selectOption({ label: 'Moved stop' });
  await page.getByLabel(/Note/).fill('E2E lifecycle note');
  const attachMistake = page.getByRole('button', { name: 'Attach mistake' });
  await attachMistake.click();
  await expect(page.getByText('E2E lifecycle note')).toBeVisible({ timeout: 120_000 });
  await page.reload();
  await openTradeSection(page, 'review');
  await expect(page.getByText('E2E lifecycle note')).toBeVisible();

  // Phase 14E — the Trade is already Open from creation (no separate Open
  // step); proceed straight to Close, colocated on the Actual section
  // (brief §12).
  await openTradeSection(page, 'actual');
  await page.getByRole('button', { name: 'Full Close' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Exit', { exact: true }).fill('110');
  await dialog.getByRole('button', { name: 'Full Close' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  const detail = page.getByRole('article', { name: 'XAUUSD' });
  await openTradeSection(page, 'actual');
  await expect(detail.getByText('+1.00R').first()).toBeVisible();

  // System resolves independently on its own section (brief §14).
  await openTradeSection(page, 'system');
  await page.getByRole('button', { name: 'Resolve System result' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('System exit price').fill('120');
  await dialog.getByRole('button', { name: 'Confirm resolved result' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText('Resolved', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  await openTradeSection(page, 'system');
  await expect(detail.getByText('+2.00R').first()).toBeVisible();
  await expect(detail.getByLabel('System Result').getByText('Win', { exact: true })).toBeVisible();

  await openTradeSection(page, 'actual');
  await expect(detail.getByText('+1.00R').first()).toBeVisible();
  await expect(
    detail.getByLabel('Actual Execution').getByText('Win', { exact: true }).first(),
  ).toBeVisible();
}

test.describe('real Trade Journal creation', () => {
  test.beforeEach(() => test.skip(!hasE2eDatabase, E2E_SKIP_REASON));

  test('desktop creates, completes, corrects discipline, resolves, and deletes a Trade', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionJournalUser('e2e-trades-desktop');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await expect(page.getByRole('heading', { level: 1, name: 'Trades' })).toBeVisible();
    await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/fixture preview/i)).toHaveCount(0);
    await expect(page.getByText('London Open Sweep')).toHaveCount(0);
    await createOpenTrade(page);
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    const detail = page.getByRole('article', { name: 'XAUUSD' });
    await expect(page.getByText('Long').first()).toBeVisible();
    await openTradeSection(page, 'strategy');
    await expect(page.getByText('Golden Breakout').last()).toBeVisible();
    await expect(page.getByText('Clean Retest').last()).toBeVisible();
    await openTradeSection(page, 'entry');
    // Appears once as Entry Snapshot's compact summary Planned R and again
    // inside its full-detail Plan disclosure — both by design (brief §22).
    await expect(detail.getByText('+3.00R').first()).toBeVisible();
    // Phase 14E — created already Open, never a customer-visible Planned step.
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Pending').last()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await openTradeSection(page, 'entry');
    await expect(detail.getByText('+3.00R').first()).toBeVisible();
    await completeTradeLifecycle(page);

    await page.getByRole('button', { name: 'Delete Trade' }).click();
    const deleteDialog = page.getByRole('alertdialog');
    await expect(deleteDialog.getByText(/no restore flow/i)).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete Trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades$/);
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toHaveCount(0);
  });

  test('creates a Money-only Trade (no Price fields) and renders it truthfully', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-money-only');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createMoneyOnlyOpenTrade(page);
    await expect(page.getByRole('heading', { name: 'EURUSD' })).toBeVisible();
    const detail = page.getByRole('article', { name: 'EURUSD' });
    await expect(page.getByText('Short').first()).toBeVisible();
    // A Money-only Trade never fabricates Price fields — Entry is truthfully absent.
    await expect(page.getByText('Entry', { exact: true })).toHaveCount(0);
    await openTradeSection(page, 'entry');
    await expect(detail.getByText('+3.00R').first()).toBeVisible();
    await expect(page.getByText('Planned risk')).toBeVisible();
    await expect(page.getByText('Planned reward')).toBeVisible();
  });

  test('Price Partial Close weights every leg, closes the exact remainder, and corrects an earlier Exit', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionJournalUser('e2e-trades-price-exits');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createOpenTrade(page);
    const detail = page.getByRole('article', { name: 'XAUUSD' });
    // Phase 14E — created already Open; no separate Open step.
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: 'Partial Close' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Closed').fill('50');
    await dialog.getByLabel('Exit', { exact: true }).fill('120');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(
      detail.getByText('Realized R to date').locator('..').getByText('+1.00R'),
    ).toBeVisible();
    // The "Close Remaining" button (rendered above the dl) and the dl's own
    // "Remaining" label both contain the substring "Remaining" — `.last()`
    // reaches the dl row, which is the one with a sibling percent value.
    await expect(detail.getByText('Remaining').last().locator('..').getByText('50%')).toBeVisible();

    await page.getByRole('button', { name: 'Partial Close' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Closed').fill('25');
    await dialog.getByLabel('Exit', { exact: true }).fill('140');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();

    await page.getByRole('button', { name: 'Close Remaining' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Closing the exact remaining 25%.')).toBeVisible();
    await dialog.getByLabel('Exit', { exact: true }).fill('160');
    await dialog.getByRole('button', { name: 'Close Remaining' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(detail.getByText('+3.50R').first()).toBeVisible();

    await page.getByRole('button', { name: 'Correct Exit' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Exit', { exact: true }).fill('130');
    await dialog.getByRole('button', { name: 'Correct Exit' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(detail.getByText('+4.00R').first()).toBeVisible();
    await expect(detail.getByText('100%').first()).toBeVisible();
  });

  test('Money Partial Close sums already-net leg P&L without weighting it twice', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionJournalUser('e2e-trades-money-exits');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createMoneyOnlyOpenTrade(page);
    // Phase 14E — created already Open; no separate Open step.
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();

    for (const leg of [
      { percent: '50', pnl: '100.00' },
      { percent: '25', pnl: '100.00' },
    ]) {
      await page.getByRole('button', { name: 'Partial Close' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Closed').fill(leg.percent);
      await dialog.getByLabel('Realized net P&L').fill(leg.pnl);
      await dialog.getByRole('button', { name: 'Partial Close' }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await page.reload();
    }

    await expect(
      page.getByText('Realized R to date').locator('..').getByText('+2.00R'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close Remaining' }).click();
    const closeDialog = page.getByRole('dialog');
    await closeDialog.getByLabel('Realized net P&L').fill('150.00');
    await closeDialog.getByRole('button', { name: 'Close Remaining' }).click();
    await expect(closeDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'EURUSD' }).getByText('+3.50R').first(),
    ).toBeVisible();
  });

  test('Money-only System Target resolves independently while Actual remains partially open', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionJournalUser('e2e-system-money-target');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createMoneyOnlyOpenTrade(page);
    // Phase 14E — created already Open; no separate Open step.

    await page.getByRole('button', { name: 'Partial Close' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Closed').fill('50');
    await dialog.getByLabel('Realized net P&L').fill('100.00');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();

    await openTradeSection(page, 'system');
    await page.getByRole('button', { name: 'Resolve System result' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('System exit price')).toHaveCount(0);
    await expect(dialog.getByLabel('System result')).toHaveValue('money_target');
    await dialog.getByLabel('System Cost R').fill('0.10');
    await expect(dialog.getByText('2.9000R')).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm resolved result' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Resolved', { exact: true }).last()).toBeVisible();
    // Appears once in Trade Overview's own System hero and once in the
    // System section's compact result-first hero — both by design.
    await expect(
      page.getByRole('article', { name: 'EURUSD' }).getByText('+2.90R').first(),
    ).toBeVisible();
  });

  test('Money-only System Stop can be corrected to Custom gross R', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(240_000);
    const user = await provisionJournalUser('e2e-system-money-custom');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createMoneyOnlyOpenTrade(page);

    await openTradeSection(page, 'system');
    await page.getByRole('button', { name: 'Resolve System result' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('System result').selectOption('money_stop');
    await dialog.getByRole('button', { name: 'Confirm resolved result' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'EURUSD' }).getByText('-1.00R').last(),
    ).toBeVisible();

    await openTradeSection(page, 'system');
    await page.getByRole('button', { name: 'Correct System result' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('System result').selectOption('money_custom');
    await dialog.getByLabel('Gross System R').fill('2.75');
    await dialog.getByLabel('System Cost R').fill('0.25');
    await expect(dialog.getByText('2.5000R')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'EURUSD' }).getByText('+2.50R').first(),
    ).toBeVisible();
  });

  test('confirms unmet Conditions and persists the exact mixed snapshots', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-conditions');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new');
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
    await page.getByRole('textbox', { name: 'Symbol' }).fill('GBPUSD');
    await page.getByRole('button', { name: 'Long' }).click();
    await page.getByLabel('Entry', { exact: true }).fill('1.25');
    await page.getByLabel('Stop', { exact: true }).fill('1.24');
    await page.getByLabel('Actual entry').fill('1.25');
    await page.getByLabel('Initial Stop').fill('1.24');
    await page.getByLabel('Breakout candle closed').check();
    await page.getByLabel('Retest held').check();
    await page.getByLabel('Volume expanded').check();
    await expect(page.getByText('3/5 met · 60%')).toBeVisible();
    await page.locator('[data-slot="confidence-option"][data-step="75"]').click();
    await page.getByRole('button', { name: 'Fearful' }).click();
    await page.getByRole('button', { name: 'Hesitant' }).click();
    await page.getByLabel('Entry Reason').fill('Breakout confirmed on the retest.');
    await page.getByRole('button', { name: 'Open Trade' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(/3 of 5 Conditions are met \(60%\)/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Open Trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    const tradeId = new URL(page.url()).searchParams.get('trade');
    if (tradeId === null) throw new Error('created Trade ID missing from URL');

    // Phase 15E — recorded Emotions live in Entry Snapshot's full detail.
    await openTradeSection(page, 'entry');
    await expandEntrySnapshotDetails(page);
    await expect(page.getByRole('button', { name: 'Fearful' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Hesitant' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Post-trade review lives in the Review section (brief §29).
    await openTradeSection(page, 'review');
    const reviewNotes = page.getByRole('textbox', { name: 'Post-trade review', exact: true });
    await reviewNotes.fill('Stayed patient after entry.');
    await page.getByRole('button', { name: 'Save review' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await openTradeSection(page, 'review');
    await expect(reviewNotes).toHaveValue('Stayed patient after entry.');

    await openTradeSection(page, 'entry');
    await expandEntrySnapshotDetails(page);
    await page.getByRole('button', { name: 'Fearful' }).click();
    await page.getByRole('button', { name: 'Hesitant' }).click();
    await page.getByRole('button', { name: 'Focused' }).click();
    await page.getByRole('button', { name: 'Save emotions' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await openTradeSection(page, 'entry');
    await expandEntrySnapshotDetails(page);
    await expect(page.getByRole('button', { name: 'Focused' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Fearful' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await openTradeSection(page, 'review');
    await reviewNotes.fill('Waited for confirmation and managed risk.');
    await page.getByRole('button', { name: 'Save review' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await openTradeSection(page, 'review');
    await expect(reviewNotes).toHaveValue('Waited for confirmation and managed risk.');
    expect(await readConditionChecks(tradeId)).toEqual([
      { label: 'Breakout candle closed', checkStatus: 'met' },
      { label: 'Retest held', checkStatus: 'met' },
      { label: 'Volume expanded', checkStatus: 'met' },
      { label: 'Invalidation is clear', checkStatus: 'not_met' },
      { label: 'Session is aligned', checkStatus: 'not_met' },
    ]);
  });

  test('zero-Condition Setup shows Not configured and saves without a warning', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-zero-conditions');
    await seedFramework(user.id, false);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new');
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
    await expect(page.getByText('Not configured')).toBeVisible();
    await expect(page.getByText(/0\/0/)).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Symbol' }).fill('USDJPY');
    await page.getByRole('button', { name: 'Long' }).click();
    await page.getByLabel('Entry', { exact: true }).fill('150');
    await page.getByLabel('Stop', { exact: true }).fill('149');
    await page.getByLabel('Actual entry').fill('150');
    await page.getByLabel('Initial Stop').fill('149');
    await page.getByRole('button', { name: 'Open Trade' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    await openTradeSection(page, 'entry');
    // Appears once in the scan-summary <dl> and once in the full-detail
    // TradeEmotionsEditor behind "Show full details" — both by design.
    await expect(page.getByText('No emotions selected').first()).toBeVisible();
  });

  test('blocks creation when Price and Money plans disagree, and allows it once resolved', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-mismatch');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await page.getByRole('link', { name: 'Log a trade' }).first().click();
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
    await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
    await page.getByRole('button', { name: 'Long' }).click();
    await page.getByLabel('Entry', { exact: true }).fill('100');
    await page.getByLabel('Stop', { exact: true }).fill('90');
    await page.getByLabel(/Target/).fill('130'); // Price implies +3R
    await page.getByRole('button', { name: 'Add a Money plan' }).click();
    await page.getByLabel('Planned risk').fill('50.00');
    await page.getByLabel(/Planned reward/).fill('500.00'); // Money implies +10R

    await expect(page.getByText('Price and Money plans disagree')).toBeVisible();
    await page.getByRole('button', { name: 'Open Trade' }).click();
    await expect(
      page.getByText('Price and Money plans disagree — adjust one before continuing.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);

    // Resolve the disagreement — Money now agrees with Price (+3R) — and proceed.
    await page.getByLabel(/Planned reward/).fill('150.00');
    await expect(page.getByText('Price and Money plans disagree')).toHaveCount(0);
    await page.getByLabel('Actual entry').fill('100');
    await page.getByLabel('Initial Stop').fill('90');
    await page.getByLabel('Breakout candle closed').check();
    await page.getByLabel('Retest held').check();
    await page.getByLabel('Volume expanded').check();
    await page.getByLabel('Invalidation is clear').check();
    await page.getByLabel('Session is aligned').check();
    await page.getByRole('button', { name: 'Open Trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
  });

  test('Trade Plan screen has no horizontal overflow and stays usable at 390px/768px/1024px (responsive gap)', async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'Viewport sweep on the desktop Chromium engine — not a mobile-device profile',
    );
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-responsive');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);

    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/en/app/trades/new');

      const form = page.locator('form');
      await expect(form).toBeVisible();
      const formBox = await form.boundingBox();
      expect(formBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
      await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);

      // Long/Short usable: both direction buttons are visible, and clicking
      // one visibly selects it (not color-only — Founder-UAT correction
      // slice, `aria-pressed` plus a checkmark icon).
      const longButton = page.getByRole('button', { name: 'Long' });
      const shortButton = page.getByRole('button', { name: 'Short' });
      await expect(longButton).toBeVisible();
      await expect(shortButton).toBeVisible();
      await longButton.click();
      await expect(longButton).toHaveAttribute('aria-pressed', 'true');

      // A favorite Symbol chip wraps within its container rather than
      // forcing page-level horizontal scroll. A width-specific symbol keeps
      // each loop iteration's favorite distinct — favorites persist in
      // localStorage across the `page.goto` calls within this same test.
      const symbol = `SYM${width}`;
      const symbolField = page.getByRole('textbox', { name: 'Symbol' });
      await symbolField.fill(symbol);
      await page.getByRole('button', { name: `Add "${symbol}" to favorites` }).click();
      const quickValues = page.getByRole('group', { name: 'Quick values for Symbol' });
      // `exact: true` — the favorite-toggle button's own aria-label ("Remove
      // SYM390 from favorites") contains the symbol as a substring, and
      // Playwright's default accessible-name matching is substring-based
      // (the same footgun already fixed once this slice for `getByLabel`).
      await expect(quickValues.getByRole('button', { name: symbol, exact: true })).toBeVisible();
      const quickValuesBox = await quickValues.boundingBox();
      expect(quickValuesBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Phase 14E — the required Actual Execution section does not overflow
      // at this width either.
      const actualExecutionHeading = page.getByRole('heading', { name: 'Actual Execution' });
      await expect(actualExecutionHeading).toBeVisible();
      const actualExecutionBox = await actualExecutionHeading.locator('..').boundingBox();
      expect(actualExecutionBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Price/Money disclosure does not overflow — opening the Money
      // section (Price is open by default) stays within the viewport.
      await page.getByRole('button', { name: 'Add a Money plan' }).click();
      const moneyHeading = page.getByRole('heading', { name: 'Money / Risk & Reward' });
      await expect(moneyHeading).toBeVisible();
      const moneySectionBox = await moneyHeading.locator('..').locator('..').boundingBox();
      expect(moneySectionBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Confidence's five-step selector remains usable at this width: all
      // five segments stay immediately available (no horizontal scroll to
      // reach any of them — Founder-UAT Confidence redesign §9), and
      // clicking one genuinely selects it.
      const confidenceGroup = page.getByRole('group', { name: 'Confidence' });
      await expect(confidenceGroup).toBeVisible();
      const confidenceGroupBox = await confidenceGroup.boundingBox();
      expect(confidenceGroupBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);
      // The radio input itself is visually hidden in favor of its styled
      // label (the same native-radio-plus-styled-label architecture
      // `src/components/ui/segmented-control.tsx` already establishes) — a
      // real user clicks the visible "75%" label, which the browser's own
      // label/for association forwards to the hidden input, so the test
      // clicks the same visible surface rather than the hidden input's own
      // (zero-size, unreliable-to-hit) point.
      const highOption = page.getByRole('radio', { name: '75% · High' });
      // Clicks the styled (visible, pointer-events-auto) label directly —
      // the segment's step number is rendered in a separate
      // `pointer-events-none` overlay layer (so it never steals the pill's
      // drag gesture), so it is not itself a valid click target.
      await confidenceGroup.locator('[data-slot="confidence-option"][data-step="75"]').click();
      await expect(highOption).toBeChecked();

      const calmEmotion = page.getByRole('button', { name: 'Calm' });
      await expect(calmEmotion).toBeVisible();
      const emotionContainer = calmEmotion.locator('..');
      const emotionBox = await emotionContainer.boundingBox();
      expect(emotionBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);
      if (width === 390) {
        await calmEmotion.click();
        await expect(calmEmotion).toHaveAttribute('aria-pressed', 'true');
      }

      // Attachment UI (the TradingView URL field, since Upload is
      // unconfigured in this environment) does not clip.
      const chartField = page.getByLabel('TradingView URL');
      await expect(chartField).toBeVisible();
      const chartBox = await chartField.boundingBox();
      expect(chartBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // No document-level horizontal overflow at this width.
      const dimensions = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    }
  });

  test('mobile creation remains usable without horizontal overflow', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-mobile');
    await seedFramework(user.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    // Phase 14E — created already Open, in one atomic New Trade submission;
    // the required Actual Execution section's own mobile-width overflow
    // coverage lives in the "Trade Plan screen" responsive sweep above.
    await createMoneyOnlyOpenTrade(page);
    await expect(page.getByRole('heading', { name: 'EURUSD' })).toBeVisible();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: 'Full Close' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Exit', { exact: true }).fill('110');
    await dialog.getByLabel('Realized net P&L').fill('100.00');
    await dialog.getByRole('button', { name: 'Full Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'system');
    await page.getByRole('button', { name: 'Resolve System result' }).click();
    dialog = page.getByRole('dialog');
    const systemDialogBox = await dialog.boundingBox();
    expect(systemDialogBox?.width ?? 999).toBeLessThanOrEqual(390);
    await expect(dialog.getByLabel('System result')).toHaveValue('money_target');
    await dialog.getByLabel('System Cost R').fill('0.10');
    await dialog.getByRole('button', { name: 'Confirm resolved result' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Resolved', { exact: true }).last()).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const back = await page.getByRole('link', { name: 'Back to trades' }).first().boundingBox();
    expect(back?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('Phase 14C mobile — minimal New Trade (no Plan/Strategy/Setup), late classification dialog, and Needs Attention stay usable at 390px', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-14c-mobile');
    await seedFramework(user.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/trades');
    await page.getByRole('link', { name: 'Log a trade' }).first().click();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
    await page.getByRole('textbox', { name: 'Symbol' }).fill('NZDCAD');
    await page.getByRole('button', { name: 'Long' }).click();
    // Genuinely no Plan, Strategy, or Setup at all (Phase 14C.1/Phase 14E) —
    // Account/Symbol/Direction plus the one required Actual execution basis.
    await page.getByLabel('Actual entry').fill('0.8500');
    await page.getByLabel('Initial Stop').fill('0.8450');
    await page.getByRole('button', { name: 'Open Trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);

    const detail = page.getByRole('article', { name: 'NZDCAD' });
    await openTradeSection(page, 'strategy');
    const classification = detail.getByLabel('Strategy & Setup');
    await expect(classification.getByText('Not assigned')).toBeVisible();
    const addStrategyButton = classification.getByRole('button', { name: 'Add Strategy' });
    await expect(addStrategyButton).toBeVisible();
    await addStrategyButton.click();
    const classifyDialog = page.getByRole('dialog');
    await expect(classifyDialog).toBeVisible();
    const classifyDialogBox = await classifyDialog.boundingBox();
    expect(classifyDialogBox?.width ?? 999).toBeLessThanOrEqual(390);
    await classifyDialog
      .getByLabel('Strategy')
      .selectOption({ label: 'Golden Breakout · Version 1' });
    await classifyDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(classifyDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'strategy');
    await expect(classification.getByText('Golden Breakout')).toBeVisible({ timeout: 60_000 });
    let dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);

    // Needs Attention on the Dashboard — this workspace now has one Open,
    // unresolved-System Trade, so the widget renders.
    await page.goto('/en/app');
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention).toBeVisible();
    const attentionBox = await attention.boundingBox();
    expect(attentionBox?.width ?? 999).toBeLessThanOrEqual(390);
    await expect(attention.getByRole('link', { name: /Review/ })).toBeVisible();
    dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  });

  /**
   * Founder-UAT Phase 13I readiness proof, updated for Phase 14E's Open/
   * Close-Only Trade Flow. Every scenario above is a focused slice of one
   * part of the Journal V2 feature set in isolation; this is the one
   * continuous session that walks the whole customer journey end to end —
   * Create (already Open, one atomic action) -> Partial Close -> independent
   * System resolve -> Final Close -> Review -> Detail -> List -> Analytics —
   * proving they compose correctly together, not merely that each works
   * alone. The Founder should never need to ask "Where is the Close Trade
   * button?" (brief §7) — this test proves it is visible immediately after
   * create, with no intermediate customer-visible Planned step.
   */
  test('walks one Trade through create (already Open), partial close, independent System resolve, final close, review, and confirms Detail, List, and Analytics all agree', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(420_000);
    const user = await provisionJournalUser('e2e-trades-full-journey');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);

    // 1. Create — Account -> Strategy -> a Setup with >= 2 Conditions -> Symbol/
    // Direction -> a Money-only Plan (simplest to assert R math on) -> some-but-
    // not-all Conditions (exercises the "N of M met" disclosure) -> the one
    // required Actual execution basis (Money mode, matching the Plan's own
    // risk so R math stays comparable) -> Confidence -> an Emotion -> an Entry
    // Reason -> [Open Trade]. One atomic action — no separate "Open" step.
    await page.goto('/en/app/trades');
    await page.getByRole('link', { name: 'Log a trade' }).first().click();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
    await expect(page.getByLabel('Trading Account', { exact: true })).toHaveValue(/.+/);
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
    await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);
    await page.getByRole('textbox', { name: 'Symbol' }).fill('NZDUSD');
    await page.getByRole('button', { name: 'Long' }).click();
    await page.getByRole('button', { name: 'Add a Money plan' }).click();
    await page.getByLabel('Planned risk').fill('100.00');
    await page.getByLabel(/Planned reward/).fill('300.00');
    await page.getByLabel('Actual result mode').selectOption('money');
    await page.getByLabel('Initial risk').fill('100.00');
    await page.getByLabel('Breakout candle closed').check();
    await page.getByLabel('Retest held').check();
    await page.getByLabel('Volume expanded').check();
    await expect(page.getByText('3/5 met · 60%')).toBeVisible();
    await page.locator('[data-slot="confidence-option"][data-step="75"]').click();
    await page.getByRole('button', { name: 'Focused' }).click();
    await page
      .getByLabel('Entry Reason')
      .fill('Clean breakout confirmed on the retest with expanding volume.');
    await page.getByRole('button', { name: 'Open Trade' }).click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog.getByText(/3 of 5 Conditions are met \(60%\)/)).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Open Trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);

    // Arrives directly on Detail already Open — Partial Close/Close Trade are
    // immediately visible (brief §7), no premature final Actual R/outcome.
    const detail = page.getByRole('article', { name: 'NZDUSD' });
    await expect(page.getByText('Long').first()).toBeVisible();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Pending').last()).toBeVisible();
    // Setup Adherence, Confidence, Emotion, and Entry Reason all live in
    // Entry Snapshot (brief §22) — Planned R stays in its always-visible
    // compact summary; the rest is behind "Show full details".
    await openTradeSection(page, 'entry');
    await expect(detail.getByText('+3.00R').first()).toBeVisible(); // Planned R = 300.00 / 100.00
    await expandEntrySnapshotDetails(page);
    await expect(page.getByRole('button', { name: 'Focused' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Partial Close/Close Trade are colocated on the Actual section (brief §12).
    await openTradeSection(page, 'actual');
    await expect(page.getByRole('button', { name: 'Partial Close' })).toBeVisible();
    // Zero Exits recorded yet, so the full-close variant reads "Full Close" —
    // "Close Remaining" only appears once at least one partial Exit exists.
    await expect(page.getByRole('button', { name: 'Full Close' })).toBeVisible();
    await expect(
      detail.getByText('Actual R', { exact: true }).locator('..').getByText('Not available'),
    ).toBeVisible();
    await expect(
      detail.getByLabel('Actual Execution').getByText('Win', { exact: true }),
    ).toHaveCount(0);

    // 2. Partial Close roughly half the position with a realized P&L — Realized R
    // to date and remaining % appear; the Trade still reads Open, with no final
    // Actual R/outcome yet.
    await page.getByRole('button', { name: 'Partial Close' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Closed').fill('50');
    await dialog.getByLabel('Realized net P&L').fill('150.00');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'actual');
    await expect(
      detail.getByText('Realized R to date').locator('..').getByText('+1.50R'),
    ).toBeVisible();
    // The "Close Remaining" button (rendered above the dl) and the dl's own
    // "Remaining" label both contain the substring "Remaining" — `.last()`
    // reaches the dl row, which is the one with a sibling percent value.
    await expect(detail.getByText('Remaining').last().locator('..').getByText('50%')).toBeVisible();
    await expect(
      detail.getByText('Actual R', { exact: true }).locator('..').getByText('Not available'),
    ).toBeVisible();
    await expect(
      detail.getByLabel('Actual Execution').getByText('Win', { exact: true }),
    ).toHaveCount(0);

    // 3. System resolve — resolved completely independently of the Actual side's
    // partial-open state; the System Result is visible while Actual is untouched.
    await openTradeSection(page, 'system');
    await page.getByRole('button', { name: 'Resolve System result' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('System exit price')).toHaveCount(0);
    await expect(dialog.getByLabel('System result')).toHaveValue('money_target');
    await dialog.getByLabel('System Cost R').fill('0.10');
    await expect(dialog.getByText('2.9000R')).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm resolved result' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Resolved', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(
      detail.getByLabel('System Result').getByText('Win', { exact: true }),
    ).toBeVisible();
    await openTradeSection(page, 'actual');
    await expect(
      detail.getByLabel('Actual Execution').getByText('Win', { exact: true }),
    ).toHaveCount(0);

    // 4. Final Close — close the remaining half; the Trade now reads Closed with
    // the correct final Actual R: SUM(realized_pnl) / initial_risk =
    // (150.00 + 250.00) / 100.00 = +4.00R — no double-weighting of already-
    // realized legs.
    await page.getByRole('button', { name: 'Close Remaining' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Closing the exact remaining 50%.')).toBeVisible();
    await dialog.getByLabel('Realized net P&L').fill('250.00');
    await dialog.getByRole('button', { name: 'Close Remaining' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'actual');
    await expect(detail.getByLabel('Actual Execution').getByText('+4.00R').first()).toBeVisible();
    // Appears once in the compact result-first hero and once in the full
    // detail's Trader Outcome row — both by design (brief §11).
    await expect(
      detail.getByLabel('Actual Execution').getByText('Win', { exact: true }).first(),
    ).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(
      detail.getByLabel('System Result').getByText('Win', { exact: true }),
    ).toBeVisible();

    // 5. Review — tag a Mistake, mark the Execution Rule status, and write a
    // Post-Trade Review note, all colocated in the Review section (brief §29).
    await openTradeSection(page, 'review');
    const ruleStatus = page.getByRole('combobox', {
      name: 'Rule status for Wait for confirmation',
    });
    await ruleStatus.selectOption('followed');
    await expect(ruleStatus).toBeEnabled({ timeout: 30_000 });
    await expect(ruleStatus).toHaveValue('followed');

    await page.getByLabel('Mistake type').selectOption({ label: 'Moved stop' });
    await page.getByLabel(/Note/).fill('Trimmed the first leg early, ahead of plan.');
    await page.getByRole('button', { name: 'Attach mistake' }).click();
    await expect(page.getByText('Trimmed the first leg early, ahead of plan.')).toBeVisible({
      timeout: 120_000,
    });

    const reviewNotes = page.getByRole('textbox', { name: 'Post-trade review', exact: true });
    await reviewNotes.fill('Followed the Setup but exited the first leg too early.');
    await page.getByRole('button', { name: 'Save review' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // 6. Detail — reload and confirm every recorded fact reads back correctly,
    // with Actual and System kept in clearly independent sections, never blended.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'NZDUSD' })).toBeVisible();

    await openTradeSection(page, 'entry');
    await expandEntrySnapshotDetails(page);
    await expect(detail.getByText('3/5 met · 60%')).toBeVisible();
    await expect(detail.getByText('75% · High')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Focused' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      detail.getByText('Clean breakout confirmed on the retest with expanding volume.'),
    ).toBeVisible();

    await openTradeSection(page, 'actual');
    const actualSection = detail.getByLabel('Actual Execution');
    await expect(actualSection.getByText('Money', { exact: true })).toBeVisible();
    await expect(actualSection.getByText('+4.00R').first()).toBeVisible();
    await expect(actualSection.getByText('Win', { exact: true }).first()).toBeVisible();
    await expect(actualSection.getByText('Exit 1', { exact: true })).toBeVisible();
    await expect(actualSection.getByText('Exit 2', { exact: true })).toBeVisible();

    await openTradeSection(page, 'system');
    const systemSection = detail.getByLabel('System Result');
    await expect(systemSection.getByText('+2.90R')).toBeVisible();
    await expect(systemSection.getByText('Win', { exact: true })).toBeVisible();

    await openTradeSection(page, 'review');
    await expect(ruleStatus).toHaveValue('followed');
    await expect(page.getByText('Trimmed the first leg early, ahead of plan.')).toBeVisible();
    await expect(reviewNotes).toHaveValue('Followed the Setup but exited the first leg too early.');

    // 7. List — the compact Log reflects the authoritative CLOSED Actual R,
    // never a stale partial figure; outcome wording remains Detail-only.
    await page.goto('/en/app/trades');
    const listRow = page.getByRole('listitem', { name: 'NZDUSD' });
    await expect(listRow.getByText('+4.00R')).toBeVisible();
    await expect(listRow.getByText('Win', { exact: true })).toHaveCount(0);
    await expect(listRow.getByText('Realized R to date')).toHaveCount(0);

    // 8. Analytics — this Trade contributes to both Trader and System
    // performance, and its Setup Adherence / Confidence / Emotion appear in the
    // behavioral sections.
    await page.goto('/en/app/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'All' }).click();
    await expect(page).toHaveURL(/range=all/);

    const systemPanel = page.locator('[data-analytics-panel="system"]');
    const traderPanel = page.locator('[data-analytics-panel="trader"]');
    await expect(systemPanel.getByText('1 Trade')).toBeVisible();
    await expect(traderPanel.getByText('1 Trade')).toBeVisible();

    const setupAdherencePanel = page.locator('[data-analytics-panel="setup-adherence"]');
    const adherenceBucket = setupAdherencePanel.locator('li', { hasText: /50.{1,2}74%/ });
    await expect(adherenceBucket.locator('[data-analytics-axis="trader"]')).toContainText(
      '1 Trade',
    );
    await expect(adherenceBucket.locator('[data-analytics-axis="system"]')).toContainText(
      '1 Trade',
    );

    const conditionsPanel = page.locator('[data-analytics-panel="conditions"]');
    const metCondition = conditionsPanel.locator('li', { hasText: 'Breakout candle closed' });
    await expect(
      metCondition.locator(
        '[data-analytics-condition-status="met"] [data-analytics-axis="trader"]',
      ),
    ).toContainText('1 Trade');
    const notMetCondition = conditionsPanel.locator('li', { hasText: 'Invalidation is clear' });
    await expect(
      notMetCondition.locator(
        '[data-analytics-condition-status="notMet"] [data-analytics-axis="system"]',
      ),
    ).toContainText('1 Trade');

    const confidencePanel = page.locator('[data-analytics-panel="confidence"]');
    const confidenceLevel75 = confidencePanel.locator('li', { hasText: '75%' });
    await expect(confidenceLevel75.locator('[data-analytics-axis="trader"]')).toContainText(
      '1 Trade',
    );

    const emotionsPanel = page.locator('[data-analytics-panel="emotions"]');
    const focusedGroup = emotionsPanel.locator('li', { hasText: 'Focused' });
    await expect(focusedGroup.locator('[data-analytics-axis="system"]')).toContainText('1 Trade');

    await expect(
      page.locator('[data-analytics-panel="mistakes"]').getByText('1 Trade'),
    ).toBeVisible();
    await expect(page.locator('[data-analytics-panel="rules"]').getByText('100.00%')).toBeVisible();
  });

  test('Phase 14C/14E — minimal New Trade with no Plan/Strategy/Setup opens atomically, Actual closes while System stays Pending, then classifies the Trade later', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionJournalUser('e2e-trades-independent-ux');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);

    // Journey A — the minimal New Trade contract (Phase 14E): Account
    // (auto-selected), Symbol, Direction, and the one required Actual
    // execution basis — genuinely NO Plan, Strategy, or Setup at all (the
    // Phase 14C.1 no-Plan contract, migration 0016, still holds — Plan
    // remains optional data). Creates the Trade already Open in one atomic
    // action; Open never silently reintroduces a Plan requirement.
    await page.goto('/en/app/trades');
    await page.getByRole('link', { name: 'Log a trade' }).first().click();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
    await expect(page.getByLabel('Trading Account', { exact: true })).toHaveValue(/.+/);
    await expect(page.getByLabel('Strategy')).toHaveValue('');
    await expect(page.getByLabel('Entry', { exact: true })).toHaveValue('');
    await page.getByRole('textbox', { name: 'Symbol' }).fill('GBPUSD');
    await page.getByRole('button', { name: 'Long' }).click();
    await page.getByLabel('Actual entry').fill('1.2500');
    await page.getByLabel('Initial Stop').fill('1.2400');
    await page.getByRole('button', { name: 'Open Trade' }).click();
    // No Setup was chosen, so the unmet-Conditions confirmation never appears
    // — the Trade opens directly.
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const tradeUrl = page.url();

    const detail = page.getByRole('article', { name: 'GBPUSD' });
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'entry');
    await expandEntrySnapshotDetails(page);
    const planSection = detail.getByLabel('Plan');
    await expect(planSection.getByText('Not set').first()).toBeVisible();
    await expect(planSection.getByText('Not available')).toBeVisible();
    await openTradeSection(page, 'strategy');
    const classification = detail.getByLabel('Strategy & Setup');
    await expect(classification.getByText('Not assigned')).toBeVisible();
    await expect(classification.getByText('You can classify this Trade later.')).toBeVisible();
    const addStrategyButton = classification.getByRole('button', { name: 'Add Strategy' });
    await expect(addStrategyButton).toBeVisible();

    // The Trade List already reflects this unclassified, no-Plan, already-
    // Open Trade truthfully — it appears normally, nothing hidden or blocked.
    await page.goto('/en/app/trades');
    await expect(page.getByRole('listitem', { name: 'GBPUSD' })).toBeVisible();
    await page.goto(tradeUrl);

    // Journey B — Full Close the Actual side; System remains explicitly
    // Pending throughout — never inferred, never blocked.
    await openTradeSection(page, 'actual');
    await page.getByRole('button', { name: 'Full Close' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Exit', { exact: true }).fill('1.2700');
    await dialog.getByRole('button', { name: 'Full Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'actual');
    // Appears once in the compact result-first hero and once in the full
    // detail's Trader Outcome row — both by design (brief §11).
    await expect(
      detail.getByLabel('Actual Execution').getByText('Win', { exact: true }).first(),
    ).toBeVisible();
    // System is still Pending — Actual closing never advances it.
    await expect(page.getByText('Pending', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(
      detail
        .getByLabel('System Result')
        .getByText('The System result is Pending. System R and outcome are not available yet.'),
    ).toBeVisible();
    // No fake Execution Gap while one side has no final result yet.
    await expect(detail.getByText('Execution Gap')).toHaveCount(0);

    // The closed-but-System-pending Trade is immediately eligible for Trader
    // Analytics, and the Analytics page truthfully discloses the pending
    // System outcome rather than silently omitting or miscounting it.
    await page.goto('/en/app/analytics');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'All' }).click();
    await expect(page).toHaveURL(/range=all/);
    const traderPanel = page.locator('[data-analytics-panel="trader"]');
    const systemPanel = page.locator('[data-analytics-panel="system"]');
    await expect(traderPanel.getByText('1 Trade')).toBeVisible();
    await expect(systemPanel.getByText('0 resolved')).toBeVisible();
    await expect(systemPanel.getByText('1 pending System outcome')).toBeVisible();

    // Journey D — Classify Later: assign Strategy AND Setup together in the
    // same submission (the sanctioned none -> Strategy+Setup transition).
    await page.goto(tradeUrl);
    await expect(page.getByRole('heading', { name: 'GBPUSD' })).toBeVisible();
    await openTradeSection(page, 'strategy');
    await addStrategyButton.click();
    const classifyDialog = page.getByRole('dialog');
    await expect(classifyDialog.getByText('Classify this Trade')).toBeVisible();
    await classifyDialog
      .getByLabel('Strategy')
      .selectOption({ label: 'Golden Breakout · Version 1' });
    await classifyDialog.getByLabel('Setup').selectOption({ label: 'Clean Retest' });
    await classifyDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(classifyDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'strategy');

    await expect(classification.getByText('Golden Breakout')).toBeVisible({ timeout: 60_000 });
    await expect(classification.getByText('Clean Retest')).toBeVisible();
    // Assigned well after the Trade was entered and closed, so it reads as
    // added after entry, never falsely as captured at entry.
    await expect(classification.getByText('Added after entry').first()).toBeVisible();

    // Late Setup assignment never fabricates a retrospective Condition
    // snapshot — the Setup has Conditions configured, but this Trade recorded
    // none of them, so it reads "Not recorded", never 0/5 or all-unmet.
    await openTradeSection(page, 'entry');
    await expandEntrySnapshotDetails(page);
    const conditionsHeading = detail.getByRole('heading', {
      name: 'Setup Checklist',
      level: 4,
    });
    await expect(conditionsHeading.locator('..').getByText('Not recorded')).toBeVisible();
  });

  test('Phase 14D — Trading Calendar loads above the Trade Log, independent Trader/System dates never collapse, and day selection filters the Log truthfully', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-calendar');
    await seedCalendarTrades(user.id);
    await loginAs(page, 'en', user);

    // A — Calendar loads above the Trade Log, on the current month by default.
    await page.goto('/en/app/trades');
    const calendar = page.getByTestId('trading-calendar');
    await expect(calendar.getByText('Trading Calendar')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Trade journal' })).toBeVisible();

    // Navigate to August 2026, where the fixture's dates live.
    await page.goto('/en/app/trades?month=2026-08');

    // B/D — Trader axis: Aug 20 sums both Trades' Actual R (-0.5 + 1.0 = 0.5),
    // never including Trade C's System R.
    await expect(
      calendar.getByRole('button', { name: /^20 August 2026.*Trader result.*\+0\.50R.*2 trades/ }),
    ).toBeVisible();

    // C/D — System axis: Aug 21 shows ONLY Trade C's System R — the two
    // events never collapse onto the same date.
    // `SegmentedControl`'s radio input is visually hidden in favor of its
    // styled label (same architecture as the Confidence control below) — the
    // established E2E pattern is focus + keyboard Space, matching
    // `demo-dashboard.spec.ts`'s own filter-radio test, rather than a direct
    // `.click()` on a zero-size hidden input.
    const systemAxis = calendar.getByRole('radio', { name: 'System' });
    await systemAxis.focus();
    await page.keyboard.press('Space');
    await expect(systemAxis).toBeChecked();
    await expect(
      calendar.getByRole('button', { name: /^21 August 2026.*System result.*\+5\.00R.*1 result/ }),
    ).toBeVisible();
    await expect(
      calendar.getByRole('button', { name: /^20 August 2026.*System result/ }),
    ).toHaveCount(0);

    // E — Selecting Aug 20 filters the Trade Log to that day's journal
    // chronology, independent of the (System) axis currently selected.
    await calendar.getByRole('button', { name: /^20 August 2026/ }).click();
    await expect(page).toHaveURL(/month=2026-08&date=2026-08-20/);
    await expect(page.getByText('20 August 2026')).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'ACTUALFIRST' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'CROSSDATE' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'UNCLASSIFIEDOPEN' })).toBeVisible();

    // F — Clear date restores the normal, unfiltered Log.
    await page.getByRole('button', { name: 'Clear date' }).click();
    await expect(page).not.toHaveURL(/date=/);

    // G — the unclassified, still-Open Trade remains fully accessible from
    // the Calendar-filtered day, with its late-classification action intact.
    await page.goto('/en/app/trades?month=2026-08&date=2026-08-20');
    await page
      .getByRole('listitem', { name: 'UNCLASSIFIEDOPEN' })
      .getByRole('link', { name: /Add Strategy/ })
      .click();
    await expect(page).toHaveURL(/trade=.*&section=strategy/);
    const unclassifiedDetail = page.getByRole('article', { name: 'UNCLASSIFIEDOPEN' });
    await expect(
      unclassifiedDetail.getByLabel('Strategy & Setup').getByText('Not assigned'),
    ).toBeVisible();
    await expect(
      unclassifiedDetail
        .getByLabel('Strategy & Setup')
        .getByRole('button', { name: 'Add Strategy' }),
    ).toBeVisible();

    // H — Trade B's System-Pending action remains reachable from the
    // Calendar-filtered day too — Actual closing never blocks it.
    await page.goto('/en/app/trades?month=2026-08&date=2026-08-20');
    await page
      .getByRole('listitem', { name: 'ACTUALFIRST' })
      .getByRole('link', { name: /Update outcome/ })
      .click();
    await expect(page).toHaveURL(/trade=.*&section=system/);
    const actualFirstDetail = page.getByRole('article', { name: 'ACTUALFIRST' });
    await expect(
      actualFirstDetail.getByRole('button', { name: 'Resolve System result' }),
    ).toBeVisible();
    await actualFirstDetail.getByRole('button', { name: 'Resolve System result' }).click();
    const systemDialog = page.getByRole('dialog');
    await expect(systemDialog.getByLabel('System result')).toHaveValue('money_target');
    await systemDialog.getByRole('button', { name: 'Confirm resolved result' }).click();
    await expect(systemDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'ACTUALFIRST' }).getByText('Resolved').last(),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/month=2026-08&date=2026-08-20/);
    await expect(page).not.toHaveURL(/trade=/);
  });

  test('Phase 14D mobile — Trading Calendar stays usable at 390px above the Trade Log', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(120_000);
    const user = await provisionJournalUser('e2e-trades-calendar-mobile');
    await seedCalendarTrades(user.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/trades?month=2026-08');
    const calendar = page.getByTestId('trading-calendar');
    await expect(calendar.getByText('Trading Calendar')).toBeVisible();
    const calendarBox = await calendar.boundingBox();
    expect(calendarBox?.width ?? 999).toBeLessThanOrEqual(390);

    await calendar.getByRole('button', { name: /^20 August 2026/ }).click();
    await expect(page.getByText('20 August 2026')).toBeVisible();
    const actualFirstRow = page.getByRole('listitem', { name: 'ACTUALFIRST' });
    await expect(actualFirstRow).toBeVisible();
    await actualFirstRow.getByRole('link', { name: /Update outcome/ }).click();
    await expect(page).toHaveURL(/trade=.*&section=system/);
    await expect(
      page.getByRole('article', { name: 'ACTUALFIRST' }).getByLabel('System', { exact: true }),
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);

    // Explicit 320px + Thai smoke: the same compact record reflows without
    // horizontal scroll and translated status/action copy remains reachable.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/th/app/trades?month=2026-08&date=2026-08-20');
    await expect(page.getByRole('list', { name: 'สมุดบันทึกการเทรด' })).toBeVisible();
    await expect(
      page
        .getByRole('listitem', { name: 'ACTUALFIRST' })
        .getByRole('link', { name: /อัปเดตผลลัพธ์/ }),
    ).toBeVisible();
    const narrowDimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(narrowDimensions.scroll).toBeLessThanOrEqual(narrowDimensions.client + 1);
  });
});

/**
 * Founder-UAT Confidence drag interaction. RTL/jsdom cannot exercise Framer
 * Motion's drag gesture (it needs real layout and real pointer capture), so
 * this is the actual proof that dragging the pill snaps to a valid discrete
 * step and never persists an intermediate value.
 */
test.describe('Confidence pill drag interaction', () => {
  test.beforeEach(() => test.skip(!hasE2eDatabase, E2E_SKIP_REASON));

  async function reachConfidenceStep(page: Page, prefix: string) {
    const user = await provisionJournalUser(prefix);
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await page.getByRole('link', { name: 'Log a trade' }).first().click();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
    await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
    await page.getByRole('button', { name: 'Long' }).click();
  }

  /** Clicks a Confidence segment's styled (visible) label — the step number itself renders in a separate pointer-events-none overlay, so it is not a valid click target. */
  async function clickConfidenceOption(page: Page, step: 0 | 25 | 50 | 75 | 100) {
    await page.locator(`[data-slot="confidence-option"][data-step="${step}"]`).click();
  }

  /**
   * Waits for the pill's Motion spring transition (triggered by a preceding
   * click or drag) to finish animating before any test reads its geometry —
   * without this, a drag begun immediately after a click can read a
   * mid-flight `boundingBox()` and compute the wrong relative start point.
   * Polls until two consecutive reads agree, rather than a fixed sleep.
   */
  async function waitForPillSettled(page: Page) {
    const pill = page.locator('[data-slot="confidence-pill"]');
    await expect(async () => {
      const first = await pill.boundingBox();
      const second = await pill.boundingBox();
      if (!first || !second || first.x !== second.x) throw new Error('pill still animating');
    }).toPass({ timeout: 5_000, intervals: [50] });
  }

  /** Moves a held pill to an absolute viewport X via enough intermediate events for Motion to recognize a pan. */
  async function beginPillDragTo(page: Page, toX: number) {
    await waitForPillSettled(page);
    const pill = page.locator('[data-slot="confidence-pill"]');
    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error('Confidence pill has no geometry');
    const startX = pillBox.x + pillBox.width / 2;
    const y = pillBox.y + pillBox.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + (toX - startX) * 0.3, y, { steps: 5 });
    await page.mouse.move(startX + (toX - startX) * 0.7, y, { steps: 5 });
    await page.mouse.move(toX, y, { steps: 5 });
  }

  /** Drags and releases the pill at an absolute viewport X. */
  async function dragPillTo(page: Page, toX: number) {
    await beginPillDragTo(page, toX);
    await page.mouse.up();
  }

  async function trackBox(page: Page) {
    const box = await page.locator('[data-slot="confidence-track"]').boundingBox();
    if (!box) throw new Error('Confidence track has no geometry');
    return box;
  }

  test('dragging the pill from 0% toward 25% snaps to exactly 25%', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium pointer-drag coverage');
    test.setTimeout(120_000);
    await reachConfidenceStep(page, 'e2e-confidence-drag-a');
    await clickConfidenceOption(page, 0);
    await expect(page.getByRole('radio', { name: '0% · Very Low' })).toBeChecked();

    const track = await trackBox(page);
    // Ratio 0.25 of the track's width maps to nearest index round(0.25*4)=1 -> 25%.
    await dragPillTo(page, track.x + track.width * 0.25);

    await expect(page.getByRole('radio', { name: '25% · Low' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '0% · Very Low' })).not.toBeChecked();
    // The live "25% · Low" value readout sits in the header row above the
    // fieldset, not inside the `group` itself, so it's asserted page-wide.
    await expect(page.getByText('25% · Low', { exact: true })).toBeVisible();
  });

  test('dragging the pill from 25% toward 75% snaps to exactly 75%', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium pointer-drag coverage');
    test.setTimeout(120_000);
    await reachConfidenceStep(page, 'e2e-confidence-drag-b');
    await clickConfidenceOption(page, 25);
    await expect(page.getByRole('radio', { name: '25% · Low' })).toBeChecked();

    const track = await trackBox(page);
    // Ratio 0.75 of the track's width maps to nearest index round(0.75*4)=3 -> 75%.
    await dragPillTo(page, track.x + track.width * 0.75);

    await expect(page.getByRole('radio', { name: '75% · High' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '25% · Low' })).not.toBeChecked();
  });

  test('dragging near a step boundary picks the geometrically nearest step', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium pointer-drag coverage');
    test.setTimeout(120_000);
    await reachConfidenceStep(page, 'e2e-confidence-drag-c');
    await clickConfidenceOption(page, 50);
    await expect(page.getByRole('radio', { name: '50% · Neutral' })).toBeChecked();

    // The 50%/75% boundary sits at ratio 0.625 (round(x*4) flips from 2 to 3
    // there). 0.60 is nearer to 50%; 0.66 is nearer to 75%.
    const track = await trackBox(page);
    await dragPillTo(page, track.x + track.width * 0.6);
    await expect(page.getByRole('radio', { name: '50% · Neutral' })).toBeChecked();

    await dragPillTo(page, track.x + track.width * 0.66);
    await expect(page.getByRole('radio', { name: '75% · High' })).toBeChecked();
  });

  test('drag cannot push the pill past the 0% or 100% bounds of the track', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium pointer-drag coverage');
    test.setTimeout(120_000);
    await reachConfidenceStep(page, 'e2e-confidence-drag-d');
    await clickConfidenceOption(page, 50);
    await expect(page.getByRole('radio', { name: '50% · Neutral' })).toBeChecked();

    const track = await trackBox(page);
    // Motion's hard constraint must clamp the rendered pill even while the
    // synthetic pointer is outside the track. Cancel after inspecting it:
    // headless Chromium does not emit dragend for that artificial gesture.
    const pill = page.locator('[data-slot="confidence-pill"]');
    await beginPillDragTo(page, track.x - 1);
    const pillPastLeft = await pill.boundingBox();
    const leftScaleTolerance = (pillPastLeft?.width ?? 0) * 0.02 + 1;
    expect(pillPastLeft?.x ?? -1).toBeGreaterThanOrEqual(track.x - leftScaleTolerance);
    await pill.dispatchEvent('pointercancel');
    await page.mouse.up();
    await expect(page.getByRole('radio', { name: '50% · Neutral' })).toBeChecked();

    // A valid release in the outer step commits the exact boundary value.
    await dragPillTo(page, track.x + track.width * 0.05);
    await expect(page.getByRole('radio', { name: '0% · Very Low' })).toBeChecked();

    await beginPillDragTo(page, track.x + track.width + 1);
    const pillPastRight = await pill.boundingBox();
    const rightScaleTolerance = (pillPastRight?.width ?? 0) * 0.02 + 1;
    expect((pillPastRight?.x ?? 0) + (pillPastRight?.width ?? 0)).toBeLessThanOrEqual(
      track.x + track.width + rightScaleTolerance,
    );
    await pill.dispatchEvent('pointercancel');
    await page.mouse.up();
    await expect(page.getByRole('radio', { name: '0% · Very Low' })).toBeChecked();

    await dragPillTo(page, track.x + track.width * 0.95);
    await expect(page.getByRole('radio', { name: '100% · Very High' })).toBeChecked();
  });

  test('a cancelled pointer gesture leaves the Confidence value in a valid, unchanged discrete state', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium pointer-drag coverage');
    test.setTimeout(120_000);
    await reachConfidenceStep(page, 'e2e-confidence-drag-e');
    await clickConfidenceOption(page, 25);
    await expect(page.getByRole('radio', { name: '25% · Low' })).toBeChecked();

    const pill = page.locator('[data-slot="confidence-pill"]');
    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error('Confidence pill has no geometry');
    const startX = pillBox.x + pillBox.width / 2;
    const y = pillBox.y + pillBox.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 60, y, { steps: 5 });
    // Interrupt the gesture with a real pointercancel — nothing was ever
    // persisted mid-drag, so cancelling must leave the last committed value
    // exactly as it was, not some in-between value.
    await pill.dispatchEvent('pointercancel');
    await page.mouse.up();

    await expect(page.getByRole('radio', { name: '25% · Low' })).toBeChecked();
    const checkedCount = await page.getByRole('radio', { checked: true }).count();
    expect(checkedCount).toBe(1);
  });

  test('dragging the pill on a narrow 390px mobile viewport snaps correctly with no page scroll hijack', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'mobile-chrome', 'Touch-capable viewport coverage');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await reachConfidenceStep(page, 'e2e-confidence-drag-mobile');
    const confidenceGroup = page.getByRole('group', { name: 'Confidence' });
    await expect(confidenceGroup).toBeVisible();
    const groupBox = await confidenceGroup.boundingBox();
    expect(groupBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(390);

    await clickConfidenceOption(page, 0);
    await expect(page.getByRole('radio', { name: '0% · Very Low' })).toBeChecked();

    const track = await trackBox(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await dragPillTo(page, track.x + track.width * 0.9);
    await expect(page.getByRole('radio', { name: '100% · Very High' })).toBeChecked();
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBe(scrollBefore);

    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  });
});
