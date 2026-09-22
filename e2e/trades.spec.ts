import { expect, test, type Locator, type Page } from '@playwright/test';
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
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';
import {
  recordOpenClassify,
  recordOpenMinimum,
  recordOpenSave,
  recordOpenStep,
} from './support/record-open';

async function provisionJournalUser(prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(testUrl, {
    email,
    password: 'Correct-Horse9!',
    name: 'E2E Journal Tester',
  });
}

async function seedRetrospectiveDetailTrade(userId: string): Promise<string> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaces, tradingAccounts, trades, tradeExits } });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Trade E2E retrospective workspace missing');
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Trade E2E retrospective Account missing');

    const exitedAt = new Date('2026-08-21T10:00:00.000Z');
    return db.transaction(async (tx) => {
      const [trade] = await tx
        .insert(trades)
        .values({
          workspaceId: workspace.id,
          tradingAccountId: account.id,
          symbol: 'RETRODETAIL',
          direction: 'long',
          plannedRiskMinor: 100n,
          plannedRewardMinor: 200n,
          plannedR: '2.0000',
          actualResultMode: 'money',
          actualInitialRiskMinor: 100n,
          netPnlMinor: 100n,
          actualR: '1.0000',
          traderOutcome: 'win',
          status: 'closed',
          enteredAt: new Date('2026-08-21T09:00:00.000Z'),
          exitedAt,
          createdAt: new Date('2026-08-21T10:00:00.001Z'),
        })
        .returning({ id: trades.id });
      if (trade === undefined) throw new Error('Trade E2E retrospective Trade missing');
      await tx.insert(tradeExits).values({
        workspaceId: workspace.id,
        tradeId: trade.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: 10_000,
        realizedPnlMinor: 100n,
        exitedAt,
      });
      return trade.id;
    });
  } finally {
    await client.end();
  }
}

/**
 * A LEGACY PRICE TRADE, SEEDED RATHER THAN TYPED.
 *
 * At Entry no longer records a Price plan or a Price-mode Actual (Add Trade
 * contract §3, migration 0021), so a Trade with price geometry can only be a
 * legacy row now. The Price-side Detail, System Plan and weighted Partial
 * Close behaviour it feeds is still real behaviour for every such row already
 * in a customer's history, so these specs exercise a row shaped exactly as the
 * pre-contract form used to write one — and prove the contract migration left
 * it untouched.
 */
async function seedLegacyPriceOpenTrade(userId: string): Promise<string> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: { workspaces, tradingAccounts, trades, strategies, strategySetupVersions },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Trade E2E price workspace missing');
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Trade E2E price Account missing');
    const [strategy] = await db
      .select({ id: strategies.id, currentVersionId: strategies.currentVersionId })
      .from(strategies)
      .where(eq(strategies.workspaceId, workspace.id));
    if (strategy?.currentVersionId == null) throw new Error('Trade E2E price Strategy missing');
    const [setupVersion] = await db
      .select({ id: strategySetupVersions.id, setupId: strategySetupVersions.setupId })
      .from(strategySetupVersions)
      .where(eq(strategySetupVersions.strategyVersionId, strategy.currentVersionId));
    if (setupVersion === undefined) throw new Error('Trade E2E price Setup Version missing');

    const [trade] = await db
      .insert(trades)
      .values({
        workspaceId: workspace.id,
        tradingAccountId: account.id,
        strategyId: strategy.id,
        strategyVersionId: strategy.currentVersionId,
        setupId: setupVersion.setupId,
        setupVersionId: setupVersion.id,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedEntry: '100',
        plannedStop: '90',
        plannedTarget: '130',
        plannedR: '3.0000',
        actualResultMode: 'price',
        actualEntry: '100',
        actualInitialStop: '90',
        status: 'open',
        enteredAt: new Date(Date.now() - 60 * 60 * 1000),
        strategyAssignedAt: new Date(),
        setupAssignedAt: new Date(),
      })
      .returning({ id: trades.id });
    if (trade === undefined) throw new Error('Trade E2E price Trade insert failed');
    /*
      The service snapshots a Strategy Version's applicable Rules onto a Trade
      when it is classified (`snapshotRuleChecks`). A directly-seeded Trade
      must carry the same rows, or the Review tab truthfully reports that no
      Rule snapshots are attached and there is nothing to grade.
    */
    const rules = await db
      .select()
      .from(strategyRules)
      .where(eq(strategyRules.strategyVersionId, strategy.currentVersionId));
    if (rules.length > 0) {
      await db.insert(tradeRuleChecks).values(
        rules.map((rule) => ({
          workspaceId: workspace.id,
          tradeId: trade.id,
          strategyRuleId: rule.id,
          strategyVersionId: rule.strategyVersionId,
          ruleKey: rule.ruleKey,
          checkStatus: 'not_checked' as const,
          title: rule.title,
          category: rule.category,
          isRequired: rule.isRequired,
          isPreTradeCheck: rule.isPreTradeCheck,
          sortOrder: rule.sortOrder,
        })),
      );
    }
    return trade.id;
  } finally {
    await client.end();
  }
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
          // Net = gross − cost, and a Money target's gross is what was entered.
          systemGrossR: '2.0000',
          systemCostR: '0.0000',
          systemR: '2.0000',
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

async function seedPaginatedTrades(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaces, tradingAccounts, trades } });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Trade E2E pagination workspace missing');
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Trade E2E pagination account missing');

    await db.insert(trades).values(
      // 27 Trades: one full 25-row page and a second page of two.
      Array.from({ length: 27 }, (_, index) => {
        const enteredAt = new Date(`2026-08-22T06:${String(index + 1).padStart(2, '0')}:00Z`);
        return {
          workspaceId: workspace.id,
          tradingAccountId: account.id,
          symbol: `PAGE${String(index + 1).padStart(2, '0')}`,
          direction: 'long' as const,
          status: 'open' as const,
          systemStatus: 'no_trade' as const,
          systemExitReason: 'setup_invalidated' as const,
          systemResolvedAt: enteredAt,
          plannedRiskMinor: 100n,
          plannedRewardMinor: 200n,
          plannedR: '2.0000',
          actualResultMode: 'money' as const,
          actualInitialRiskMinor: 100n,
          enteredAt,
        };
      }),
    );
  } finally {
    await client.end();
  }
}

async function seedPendingWorkflowTrades(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaces, tradingAccounts, trades } });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Pending workflow E2E workspace missing');
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Pending workflow E2E account missing');

    const common = {
      workspaceId: workspace.id,
      tradingAccountId: account.id,
      direction: 'long' as const,
      status: 'open' as const,
      plannedRiskMinor: 100n,
      plannedRewardMinor: 200n,
      plannedR: '2.0000',
      actualResultMode: 'money' as const,
      actualInitialRiskMinor: 100n,
    };
    await db.insert(trades).values([
      // 27 pending Trades: the bucket must survive a page boundary.
      ...Array.from({ length: 27 }, (_, index) => ({
        ...common,
        symbol: `PENDING${String(index + 1).padStart(2, '0')}`,
        systemStatus: 'pending' as const,
        enteredAt: new Date(`2026-08-22T06:${String(index + 1).padStart(2, '0')}:00Z`),
      })),
      {
        ...common,
        symbol: 'RESOLVEDROW',
        systemStatus: 'resolved' as const,
        systemResolutionKind: 'money_target' as const,
        systemGrossRInput: '2.0000',
        systemGrossR: '2.0000',
        systemCostR: '0.0000',
        systemR: '2.0000',
        systemOutcome: 'win' as const,
        systemExitReason: 'target_hit' as const,
        systemExitedAt: new Date('2026-08-22T13:00:00Z'),
        systemResolvedAt: new Date('2026-08-22T13:00:00Z'),
        enteredAt: new Date('2026-08-22T13:00:00Z'),
      },
      {
        ...common,
        symbol: 'NOTRADEROW',
        systemStatus: 'no_trade' as const,
        systemExitReason: 'setup_invalidated' as const,
        systemResolvedAt: new Date('2026-08-22T14:00:00Z'),
        enteredAt: new Date('2026-08-22T14:00:00Z'),
      },
    ]);
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

/**
 * THE RETIRED FIVE SECTIONS, MAPPED TO THE SIX TABS THAT NOW HOLD THEM.
 *
 * Trade Details is a side sheet with six tabs (`src/lib/trades/details-tabs.ts`
 * carries the same mapping for old `?section=` links). Each scenario below
 * still asks for the content it always asked for; only the way a trader
 * reaches it changed.
 */
const TRADE_SECTION_TAB = {
  actual: 'Execution',
  system: 'Plan',
  strategy: 'Plan',
  entry: 'Plan',
  review: 'Review',
} as const;

/**
 * Phase 15E — Trade Detail now shows exactly one of five sections at a time
 * (`TradeSectionNav`). Clicks the matching nav item, the same way a real user
 * would reach that section, rather than editing the `?section=` URL param
 * directly.
 */
async function openTradeSection(page: Page, section: keyof typeof TRADE_SECTION_TAB) {
  const sheet = tradeDetails(page);
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const tab = sheet.getByRole('tab', { name: TRADE_SECTION_TAB[section], exact: true });
  await expect(tab).toBeVisible();
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
  }).toPass({ timeout: 30_000, intervals: [250] });
}

/**
 * An action dialog — Close, Correct Exit, System Outcome, Classification.
 *
 * Trade Details is itself a dialog (a side sheet), so a bare `role=dialog`
 * is ambiguous on this page and would resolve to the sheet standing behind
 * whatever the scenario just opened.
 */
function actionDialog(page: Page) {
  return page.locator('[role="dialog"]:not([data-trade-details])');
}

/** The Trade Details tab panel currently on screen. */
function activePanel(page: Page) {
  return tradeDetails(page).getByRole('tabpanel');
}

/**
 * One Trade's row in the Trades workspace.
 *
 * The Trade Log is a table on a desktop and a card list on a phone; both
 * carry `data-trade-row` on the Symbol link, which is what a trader clicks
 * either way.
 */
function tradeRow(page: Page, symbol: string) {
  // A desktop row is a <tr>; a phone card is one <li> link naming the row.
  return page.locator('tr:visible, li:visible').filter({ hasText: symbol }).first();
}

/** Every Trade row currently listed, at either width. */
function tradeRows(page: Page) {
  return page.locator('[data-trade-row]:visible');
}

async function assessSystem(
  page: Page,
  options: {
    readonly closed: string;
    readonly exitPrice?: string;
    readonly grossR?: string;
    readonly cost?: string;
  },
) {
  const dialog = actionDialog(page);
  await expect(dialog).toBeVisible();
  await chooseChoice(dialog, 'Yes');
  await chooseChoice(dialog, options.closed);
  if (options.exitPrice !== undefined) {
    await dialog.getByLabel('System exit price').fill(options.exitPrice);
  }
  // "Custom R" names both the choice and its field; address the field by id.
  if (options.grossR !== undefined) {
    await dialog.locator('#system-assessment-gross').fill(options.grossR);
  }
  if (options.cost !== undefined) await dialog.getByLabel('Trading costs').fill(options.cost);
  return dialog;
}

/** The open Trade Details sheet — the surface that replaced the Trade Detail page. */
function tradeDetails(page: Page) {
  return page.locator('[data-trade-details]');
}

/** The sheet, asserted to be showing the Trade whose Symbol the scenario names. */
function tradeDetailsFor(page: Page, symbol: string) {
  return page
    .locator('[data-trade-details]')
    .filter({ has: page.getByRole('heading', { name: symbol, exact: true }) });
}

/** Advances an existing datetime-local value without assuming the browser's timezone. */
async function advanceDatetimeLocal(input: Locator, minutes: number) {
  await expect(input).toBeVisible();
  const advanced = await input.evaluate((element, offsetMinutes) => {
    const current = new Date((element as HTMLInputElement).value);
    current.setMinutes(current.getMinutes() + offsetMinutes);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`;
  }, minutes);
  await input.fill(advanced);
}

/**
 * Opens the tab holding the recorded Emotions.
 *
 * They used to sit inside Entry Snapshot's "Show full details" disclosure.
 * In the six-tab Trade Details they are on Review, beside the Mistakes —
 * the same question ("what affected my decision?") asked in one place.
 */
async function openRecordedEmotions(page: Page) {
  await openTradeSection(page, 'review');
}

/**
 * CHOOSE A RADIO THE WAY A PERSON DOES — BY ITS LABEL.
 *
 * The recording flow's segmented choices are native radios drawn by their
 * labels (`peer sr-only`). A forced click on the 1px hidden input does not
 * reliably land on it, so this clicks the input's own `<label for>` and then
 * asserts the radio really became checked.
 */
/** Open one of After Trade's five steps from its step list (rail or phone segments). */
async function afterTradeStep(page: Page, step: 'trade' | 'result' | 'plan' | 'context' | 'after') {
  await page.locator(`[data-step-link="${step}"]`).click();
  await expect(page.locator('[data-after-trade-form]')).toHaveAttribute(
    'data-after-trade-step',
    step,
  );
}

/**
 * AFTER TRADE STEP 1 IS READ-FIRST. Each concept shows what is recorded and
 * opens its own editor — a bottom sheet on a phone, a dialog on a desktop — so
 * a test reaches the control the way a trader does.
 */
async function afterTradeEditor(page: Page, field: string) {
  await afterTradeStep(page, 'trade');
  await page.getByRole('button', { name: `Edit ${field}` }).click();
  return page.getByRole('dialog');
}

/** What a Step 1 row holds, without opening its editor. */
function afterTradeConcept(page: Page, concept: string) {
  return page.locator(`[data-concept="${concept}"]`);
}

async function afterTradeIdentity(page: Page, symbol: string, direction: 'Long' | 'Short') {
  /*
    The Symbol editor is a picker: the field searches, and recording is a
    deliberate press — the row when this workspace has traded it before, the
    offer to add it when it has not.
  */
  const symbolEditor = await afterTradeEditor(page, 'Symbol');
  await symbolEditor.getByRole('combobox', { name: 'Symbol' }).fill(symbol);
  const add = symbolEditor.getByRole('button', { name: /^Add/ });
  if ((await add.count()) > 0) await add.click();
  // Tapping the saved row is what records it, and it closes the sheet itself.
  await symbolEditor.getByRole('option', { name: new RegExp(`^${symbol}`, 'i') }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Direction is a single choice too: the tap records it and closes the sheet.
  const directionEditor = await afterTradeEditor(page, 'Direction');
  await directionEditor.getByRole('button', { name: direction, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(afterTradeConcept(page, 'direction')).toHaveAttribute(
    'data-value',
    direction.toLowerCase(),
  );
}

async function chooseRadio(scope: Page | Locator, name: string) {
  const radio = scope.getByRole('radio', { name, exact: true });
  const id = await radio.getAttribute('id');
  if (id === null) throw new Error(`radio "${name}" has no id to find its label by`);
  await scope.locator(`label[for="${id}"]`).click();
  await expect(radio).toBeChecked();
}

/**
 * THE CONTRACT AT ENTRY FORM IS ONE CAPTURE WORKSPACE: the trade → risk and
 * plan → why you are taking it → context → Save open trade. Strategy, Setup,
 * the Conditions, Confidence and emotions sit in the page's own reading order
 * (behind one disclosure on a phone), so there is no journal overlay to open.
 *
 * A recorded-answer choice is a native radio behind a styled label, exactly
 * like `chooseRadio` above, but its accessible name includes the option's own
 * description line — so these take a pattern rather than an exact string.
 */
async function chooseChoice(scope: Page | Locator, name: RegExp | string) {
  // A string is the whole accessible name ("Met" must not also match "Not
  // met"); a pattern is for options that carry their own description line.
  const radio = scope.getByRole('radio', { name, exact: typeof name === 'string' });
  const id = await radio.getAttribute('id');
  if (id === null) throw new Error(`choice "${String(name)}" has no id to find its label by`);
  await scope.locator(`label[for="${id}"]`).click();
  await expect(radio).toBeChecked();
}

/** Answers one Setup Condition inside its own labelled group. */
async function answerCondition(page: Page, label: string, answer: 'Met' | 'Not met') {
  await chooseChoice(page.getByRole('group', { name: new RegExp(label) }), answer);
}

/** Chooses a Strategy and Setup on Setup & Checklist, each in its own editor. */
async function classifyAtEntry(page: Page, strategy: string, setup?: string) {
  await recordOpenClassify(page, strategy, setup);
}

/** Entry emotions, chosen in their editor on Entry Context; Done keeps them. */
async function chooseEntryEmotions(page: Page, emotions: readonly string[]) {
  await recordOpenStep(page, 'context');
  await page.locator('#entry-entry-emotions').click();
  const editor = page.getByRole('dialog');
  for (const emotion of emotions) await editor.getByRole('button', { name: emotion }).click();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * MONEY IS THE DEFAULT PLAN; PRICE IS ONE QUIET SWITCH AWAY. Switch before
 * typing: the switch clears the plan fields it owns.
 */
async function planWithPriceLevels(page: Page) {
  await page.getByRole('button', { name: 'Use price levels instead' }).click();
}

async function chooseOpeningBasis(page: Page, basis: 'Price' | 'Money') {
  await chooseRadio(page.getByRole('group', { name: 'Actual opening by' }), basis);
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
async function createOpenTrade(page: Page, userId: string) {
  const tradeId = await seedLegacyPriceOpenTrade(userId);
  await page.goto(`/en/app/trades?trade=${tradeId}`);
  await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
}

/**
 * Founder-UAT Trade Plan UX correction slice — a Money-only Plan (no Price
 * fields at all). Phase 14E: the required Actual execution basis is Money
 * mode too, Initial risk matching the Plan's own Planned risk (100.00)
 * exactly, so downstream R-value assertions are unaffected.
 */
async function createMoneyOnlyOpenTrade(page: Page) {
  await page.goto('/en/app/trades/new?timing=at_entry');
  await recordOpenMinimum(page, { symbol: 'EURUSD', direction: 'Short', risk: '100.00' });
  await chooseChoice(page, /^Fixed target/);
  await page.getByLabel('Target profit').fill('300.00');
  await classifyAtEntry(page, 'Golden Breakout', 'Clean Retest');
  for (const condition of [
    'Breakout candle closed',
    'Retest held',
    'Volume expanded',
    'Invalidation is clear',
    'Session is aligned',
  ]) {
    await answerCondition(page, condition, 'Met');
  }
  await recordOpenSave(page);
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
  let dialog = actionDialog(page);
  await dialog.getByLabel('Exit', { exact: true }).fill('110');
  await dialog.getByRole('button', { name: 'Full Close' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  const detail = tradeDetailsFor(page, 'XAUUSD');
  await openTradeSection(page, 'actual');
  await expect(detail.getByText('+1.00R').first()).toBeVisible();

  // System resolves independently, from the Review tab that owns the
  // assessment editor (brief §14).
  await openTradeSection(page, 'review');
  await page.getByRole('button', { name: /System assessment/ }).click();
  dialog = await assessSystem(page, { closed: 'Trailing exit', exitPrice: '120', cost: '0' });
  await dialog.getByRole('button', { name: 'Confirm assessment' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.locator('[data-trade-review-state="needs_system_result"]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await openTradeSection(page, 'system');
  const plan = activePanel(page);
  await expect(plan.getByText('+4.00R')).toBeVisible();
  await expect(plan.getByText('+2.00R')).toBeVisible();
  /*
    A LEGACY ROW (contract §28): the seeded Trade's System result and Actual R
    come from the same pre-contract model, so its Gap is still meaningful —
    and the evidence names its model instead of passing as an Add Trade answer.
  */
  await expect(plan.getByText('Legacy').first()).toBeVisible();
  await expect(detail.getByText('-1.00R')).toBeVisible();

  await openTradeSection(page, 'actual');
  await expect(detail.getByText('+1.00R').first()).toBeVisible();
}

/**
 * The cap for the long Trade-journey flows below, and it is a measured number.
 * Checked out at `8e9f394` — the commit before the Trades rebuild, where all
 * six still pass — and timed against a REMOTE Neon database, slower than the
 * local Postgres container CI uses: 47.7s, 38.0s, 28.2s, 22.3s, 21.3s, 7.7s.
 * 90s is roughly 1.9x the slowest of those.
 *
 * It used to be 300s, a number no commit ever explained. That mattered once
 * the Trades rebuild turned these from assertion failures into hangs: their
 * locators stopped existing, so each one waited out the full five minutes and
 * was retried twice, and three of them alone consumed 45 of the 60 minutes
 * that CI's Playwright job was given before being cancelled. See
 * docs/roadmap.md.
 *
 * 90 rather than 60: while these tests are red the cap is only a cost knob,
 * but it has to survive their repair, and a runner's CPU is slower than the
 * machine those timings came from. 60s would leave 1.26x over a measurement
 * taken on a faster CPU; the extra 30s costs at most three minutes of a
 * thirty-five minute budget, and a cap that is too tight buys back a flaky
 * timeout — the exact failure this work exists to remove.
 */
const LONG_TRADE_FLOW_TIMEOUT_MS = 90_000;

test.describe('real Trade Journal creation', () => {
  /**
   * Nineteen of this block's twenty-one tests are the documented known-red
   * set (docs/roadmap.md), so retrying them is three attempts at a result
   * this repository already records — and with the caps above that is the
   * difference between three minutes and nine. The global `retries: 2`
   * (playwright.config.ts) is deliberately left alone everywhere else,
   * because it demonstrably works: the completed CI runs of 2026-08-15 to
   * 2026-08-23 recovered between one and four genuinely flaky tests each,
   * and the one identified by name was `app-shell.spec.ts`'s navigation
   * landmark test, not a known-red one.
   *
   * Playwright has no per-test retry setting, so this is block-scoped, and
   * the two tests here that are NOT known-red — `the recording-mode choice
   * walks from the cards to the form` and `Phase 15G.3 New Trade views stay
   * exclusive and usable at 1440/390/320 in EN/TH` — lose their retries too.
   * That is a deliberate, visible trade: if either becomes flaky it shows up
   * immediately as a red name that `pnpm e2e:known-red` reports as
   * undocumented, which is the loud failure mode rather than the quiet one.
   */
  test.describe.configure({ retries: 0 });

  test.beforeEach(() => test.skip(!hasE2eDatabase, E2E_SKIP_REASON));

  test('Phase 15G.5C discloses retrospective recording once, beside the entry context', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    const user = await provisionJournalUser('e2e-trades-retrospective-detail');
    const tradeId = await seedRetrospectiveDetailTrade(user.id);
    await loginAs(page, 'en', user);
    await page.goto(`/en/app/trades?trade=${tradeId}&section=entry`);

    // The retired `?section=entry` link opens the Plan tab, which holds the
    // entry context and states its provenance once.
    const detail = tradeDetailsFor(page, 'RETRODETAIL');
    await expect(detail.getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(detail.getByText('Recorded retrospectively', { exact: true })).toHaveCount(1);
    await expect(detail.getByText('Recorded retrospectively', { exact: true })).toHaveClass(
      /text-muted-foreground/,
    );
  });

  test('desktop creates, completes, corrects discipline, resolves, and deletes a Trade', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(LONG_TRADE_FLOW_TIMEOUT_MS);
    const user = await provisionJournalUser('e2e-trades-desktop');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await expect(page.getByRole('heading', { level: 1, name: 'Trades' })).toBeVisible();
    await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/fixture preview/i)).toHaveCount(0);
    await expect(page.getByText('London Open Sweep')).toHaveCount(0);
    await createOpenTrade(page, user.id);
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    const detail = tradeDetailsFor(page, 'XAUUSD');
    await expect(page.getByText('Long').first()).toBeVisible();
    await openTradeSection(page, 'strategy');
    await expect(page.getByText('Golden Breakout').last()).toBeVisible();
    await expect(page.getByText('Clean Retest').last()).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(detail.getByText('Take Profit')).toBeVisible();
    await expect(detail.getByText('130')).toBeVisible();
    await expect(detail.getByText('+3.00R').first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit System Plan' }).click();
    const planDialog = actionDialog(page);
    await planDialog.getByLabel('Take Profit').fill('140');
    await planDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(planDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'system');
    await expect(detail.getByText('140')).toBeVisible();
    await expect(detail.getByText('+4.00R').first()).toBeVisible();
    // Phase 14E — created already Open, never a customer-visible Planned step.
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(
      activePanel(page).getByText("The System result hasn't been recorded yet."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await openTradeSection(page, 'actual');
    await expect(detail.getByText('No exits yet.')).toBeVisible();
    await expect(detail.getByText('140')).toHaveCount(0);
    await completeTradeLifecycle(page);

    await page.getByText('Trade administration', { exact: true }).click();
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
    const detail = tradeDetailsFor(page, 'EURUSD');
    await expect(page.getByText('Short').first()).toBeVisible();
    // A Money-only Trade never fabricates Price fields — Entry is truthfully absent.
    await openTradeSection(page, 'system');
    await expect(detail.getByText('Plan by Money')).toBeVisible();
    await expect(detail.getByText('+3.00R').first()).toBeVisible();
    await expect(detail.getByText('Risk', { exact: true })).toBeVisible();
    await expect(detail.getByText('Target Reward', { exact: true })).toBeVisible();
    await expect(detail.getByText('Entry', { exact: true })).toHaveCount(0);
    await openTradeSection(page, 'actual');
    await expect(detail.getByText('Money', { exact: true })).toBeVisible();
    await expect(detail.getByText('No exits yet.')).toBeVisible();
  });

  test('Price Partial Close weights every leg, closes the exact remainder, and corrects an earlier Exit', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(LONG_TRADE_FLOW_TIMEOUT_MS);
    const user = await provisionJournalUser('e2e-trades-price-exits');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createOpenTrade(page, user.id);
    const detail = tradeDetailsFor(page, 'XAUUSD');
    // Phase 14E — created already Open; no separate Open step.
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();

    await openTradeSection(page, 'actual');

    await page.getByRole('button', { name: 'Partial Close' }).click();
    let dialog = actionDialog(page);
    await dialog.getByLabel('Closed').fill('50');
    await dialog.getByLabel('Exit', { exact: true }).fill('120');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'actual');
    const actual = tradeDetails(page);
    await expect(
      actual.getByText('Realized R so far').locator('..').getByText('+1.00R'),
    ).toBeVisible();
    // The "Close Remaining" button (rendered above the dl) and the dl's own
    // "Remaining" label both contain the substring "Remaining" — `.last()`
    // reaches the dl row, which is the one with a sibling percent value.
    await expect(
      actual.getByText('Remaining', { exact: true }).locator('..').getByText('50%'),
    ).toBeVisible();

    await openTradeSection(page, 'actual');

    await page.getByRole('button', { name: 'Partial Close' }).click();
    dialog = actionDialog(page);
    await dialog.getByLabel('Closed').fill('25');
    await dialog.getByLabel('Exit', { exact: true }).fill('140');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();

    await openTradeSection(page, 'actual');

    await page.getByRole('button', { name: 'Close Remaining' }).click();
    dialog = actionDialog(page);
    await expect(dialog.getByText('Closing the exact remaining 25%.')).toBeVisible();
    await dialog.getByLabel('Exit', { exact: true }).fill('160');
    await dialog.getByRole('button', { name: 'Close Remaining' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(detail.getByText('+3.50R').first()).toBeVisible();

    await openTradeSection(page, 'actual');

    await page.getByRole('button', { name: 'Correct Exit' }).first().click();
    dialog = actionDialog(page);
    await dialog.getByLabel('Exit', { exact: true }).fill('130');
    await dialog.getByRole('button', { name: 'Correct Exit' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(detail.getByText('+4.00R').first()).toBeVisible();
    await openTradeSection(page, 'actual');
    await expect(activePanel(page).getByText('100%').first()).toBeVisible();
  });

  test('Money Partial Close sums already-net leg P&L without weighting it twice', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(LONG_TRADE_FLOW_TIMEOUT_MS);
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
      await openTradeSection(page, 'actual');
      await page.getByRole('button', { name: 'Partial Close' }).click();
      const dialog = actionDialog(page);
      await dialog.getByLabel('Closed').fill(leg.percent);
      await dialog.getByLabel('Realized net P&L').fill(leg.pnl);
      await dialog.getByRole('button', { name: 'Partial Close' }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await page.reload();
    }

    await expect(
      page.getByText('Realized R so far').locator('..').getByText('+2.00R'),
    ).toBeVisible();
    await openTradeSection(page, 'actual');
    await page.getByRole('button', { name: 'Close Remaining' }).click();
    const closeDialog = actionDialog(page);
    await closeDialog.getByLabel('Realized net P&L').fill('150.00');
    await closeDialog.getByRole('button', { name: 'Close Remaining' }).click();
    await expect(closeDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(tradeDetailsFor(page, 'EURUSD').getByText('+3.50R').first()).toBeVisible();
  });

  test('Money-only System Target resolves independently while Actual remains partially open', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(LONG_TRADE_FLOW_TIMEOUT_MS);
    const user = await provisionJournalUser('e2e-system-money-target');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createMoneyOnlyOpenTrade(page);
    // Phase 14E — created already Open; no separate Open step.

    await openTradeSection(page, 'actual');

    await page.getByRole('button', { name: 'Partial Close' }).click();
    let dialog = actionDialog(page);
    await dialog.getByLabel('Closed').fill('50');
    await dialog.getByLabel('Realized net P&L').fill('100.00');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();

    await openTradeSection(page, 'review');
    await page.getByRole('button', { name: /System assessment/ }).click();
    dialog = await assessSystem(page, { closed: 'Plan target', cost: '0.10' });
    // A Money-only plan has no price to enter.
    await expect(dialog.getByLabel('System exit price')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Confirm assessment' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await expect(page.locator('[data-trade-review-state="needs_system_result"]')).toHaveCount(0);
    // Appears once in Trade Overview's own System hero and once in the
    // System section's compact result-first hero — both by design.
    await openTradeSection(page, 'system');
    await expect(activePanel(page).getByText('+2.90R').first()).toBeVisible();
  });

  test('Money-only System Stop can be corrected to Custom gross R', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(240_000);
    const user = await provisionJournalUser('e2e-system-money-custom');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createMoneyOnlyOpenTrade(page);

    await openTradeSection(page, 'review');
    await page.getByRole('button', { name: /System assessment/ }).click();
    let dialog = await assessSystem(page, { closed: 'Initial stop hit' });
    await dialog.getByRole('button', { name: 'Confirm assessment' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'system');
    await expect(activePanel(page).getByText('-1.00R', { exact: true }).first()).toBeVisible();

    await openTradeSection(page, 'review');
    await page.getByRole('button', { name: /System assessment/ }).click();
    dialog = await assessSystem(page, { closed: 'Custom R', grossR: '2.75', cost: '0.25' });
    await dialog.getByRole('button', { name: 'Confirm assessment' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'system');
    await expect(activePanel(page).getByText('+2.50R').first()).toBeVisible();
  });

  test('records only the Conditions the trader answered, with no unmet confirmation', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-conditions');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new?timing=at_entry');
    await recordOpenMinimum(page, { symbol: 'GBPUSD', direction: 'Long', risk: '100.00' });
    await classifyAtEntry(page, 'Golden Breakout', 'Clean Retest');
    // Three answered, one answered Not Met, one deliberately left unanswered.
    await answerCondition(page, 'Breakout candle closed', 'Met');
    await answerCondition(page, 'Retest held', 'Met');
    await answerCondition(page, 'Volume expanded', 'Met');
    await answerCondition(page, 'Invalidation is clear', 'Not met');
    await recordOpenStep(page, 'context');
    await chooseChoice(page, 'High');
    await chooseEntryEmotions(page, ['Fearful', 'Hesitant']);
    await page.getByLabel('Why this trade').fill('Breakout confirmed on the retest.');
    await recordOpenSave(page);
    // Nothing asks the trader to confirm "unmet" Conditions: the one they
    // skipped is unanswered, which was never a Not Met to confirm.
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    const tradeId = new URL(page.url()).searchParams.get('trade');
    if (tradeId === null) throw new Error('created Trade ID missing from URL');

    // Phase 15E — recorded Emotions live in Entry Snapshot's full detail.
    await openRecordedEmotions(page);
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

    await openRecordedEmotions(page);
    await page.getByRole('button', { name: 'Fearful' }).click();
    await page.getByRole('button', { name: 'Hesitant' }).click();
    await page.getByRole('button', { name: 'Focused' }).click();
    await page.getByRole('button', { name: 'Save emotions' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await openRecordedEmotions(page);
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
    // The unanswered Condition has no row at all — a skipped question is
    // never stored as a negative observation (contract §8).
    expect(await readConditionChecks(tradeId)).toEqual([
      { label: 'Breakout candle closed', checkStatus: 'met' },
      { label: 'Retest held', checkStatus: 'met' },
      { label: 'Volume expanded', checkStatus: 'met' },
      { label: 'Invalidation is clear', checkStatus: 'not_met' },
    ]);
  });

  test('a Setup with no Conditions saves with no checklist and no warning', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-zero-conditions');
    await seedFramework(user.id, false);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new?timing=at_entry');
    await recordOpenMinimum(page, { symbol: 'USDJPY', direction: 'Long', risk: '100.00' });
    await classifyAtEntry(page, 'Golden Breakout', 'Clean Retest');
    // No Conditions exist: the checklist says so plainly, and no count is invented.
    await expect(page.getByText('This setup has no conditions to answer.')).toBeVisible();
    await expect(page.getByText(/0 of 0/)).toHaveCount(0);
    await recordOpenSave(page);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    await openTradeSection(page, 'entry');
    // Nothing invents a checklist for a Setup that has no Conditions, and
    // what was never recorded says so rather than reading as a zero.
    await expect(activePanel(page).getByText('Not recorded').first()).toBeVisible();
  });

  test.skip('legacy dual-plan mismatch is superseded by exclusive System Plan basis', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-mismatch');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new?timing=at_entry');
    await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
    await chooseRadio(page, 'Long');
    await planWithPriceLevels(page);
    await page.getByLabel('Entry', { exact: true }).fill('100');
    await page.getByLabel('Stop Loss', { exact: true }).fill('90');
    await page.getByLabel(/Take Profit/).fill('130'); // Price implies +3R
    await page.getByRole('button', { name: 'Add a Money plan' }).click();
    await page.getByLabel('Planned risk').fill('50.00');
    await page.getByLabel(/Planned reward/).fill('500.00'); // Money implies +10R

    await expect(page.getByText('Price and Money plans disagree')).toBeVisible();
    await page.getByRole('button', { name: 'Save open trade' }).click();
    await expect(
      page.getByText('Price and Money plans disagree — adjust one before continuing.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);

    // Resolve the disagreement — Money now agrees with Price (+3R) — and proceed.
    await page.getByLabel(/Planned reward/).fill('150.00');
    await expect(page.getByText('Price and Money plans disagree')).toHaveCount(0);
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout' });
    await page.getByLabel('Breakout candle closed').check();
    await page.getByLabel('Retest held').check();
    await page.getByLabel('Volume expanded').check();
    await page.getByLabel('Invalidation is clear').check();
    await page.getByLabel('Session is aligned').check();
    await page.getByRole('button', { name: 'Save open trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
  });

  /**
   * THE ONE TEST IN THIS SUITE THAT DRIVES THE RECORDING-MODE CHOICE ITSELF.
   *
   * Every other test in this file states its mode in the URL (`?timing=`) and
   * starts at the form, deliberately: they are about journaling a Trade, not
   * about how the mode is picked, and routing a dozen unrelated tests through
   * two clicks on this screen would mean any change to it breaks all of them.
   * This test is where that UI is allowed to break the build — so if the choice
   * step is redesigned again, this is the one place that has to be updated.
   */
  test('the recording-mode choice walks from the cards to the form', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(120_000);
    const user = await provisionJournalUser('e2e-trades-mode-choice');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new');

    // Nothing is chosen, so there is no destination yet — and therefore no
    // link, not merely a link that looks unavailable.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Continue' })).toHaveCount(0);

    const atEntry = page.getByRole('radio', { name: 'At Entry' });
    await atEntry.click();
    await expect(atEntry).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'After Trade' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    // Choosing turns the commit into a real anchor addressed at that mode's own
    // URL — which is what keeps prefetch and open-in-new-tab working.
    const commit = page.getByRole('link', { name: 'Continue' });
    await expect(commit).toHaveAttribute('href', '/en/app/trades/new?timing=at_entry');
    await commit.click();

    await expect(page).toHaveURL(/\/en\/app\/trades\/new\?timing=at_entry/);
    await expect(page.locator('[data-record-open-form]')).toBeVisible();
    await expect(page.locator('#entry-row-symbol')).toBeVisible();
  });

  test('production New Trade modes stay exclusive and overflow-free at 1440/1120/390/320 in EN/TH', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium viewport sweep');
    test.setTimeout(240_000);
    const user = await provisionJournalUser('e2e-trades-g3-responsive');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);

    for (const locale of ['en', 'th'] as const) {
      for (const width of [1440, 1120, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await page.goto(`/${locale}/app/trades/new?timing=at_entry`);

        /*
          Record Open is the four canonical stages on the real route: Trade
          Details with its entry time already defaulted to now, Plan & Risk
          with Risk at Entry, Target and the Exit Plan, Setup & Checklist,
          then Entry Context — and Save Open Trade on the last one.
        */
        const entryForm = page.locator('[data-record-open-form]');
        await expect(entryForm).toBeVisible();
        await expect(page.getByTestId('new-trade-view-nav')).toHaveCount(0);
        await expect(page.locator('#entry-row-enteredAt')).not.toHaveAttribute('data-value', '');
        await recordOpenStep(page, 'plan');
        await expect(entryForm.locator('#entry-risk')).toBeVisible();
        await expect(entryForm.locator('#entry-target-fixed')).toHaveCount(1);
        await expect(entryForm.locator('#entry-target-no_fixed')).toHaveCount(1);
        await expect(entryForm.locator('[data-exit-plan-state]')).toHaveCount(1);
        await expect(entryForm.locator('[data-journal-area]')).toHaveCount(0);
        await recordOpenStep(page, 'setup');
        await expect(page.locator('#entry-strategy')).toBeVisible();
        await recordOpenStep(page, 'context');
        await expect(page.locator('[id^="entry-confidence-"]')).toHaveCount(5);
        // One Save per width, on the last step.
        await expect(page.locator('[data-global-save]:visible button[type="submit"]')).toHaveCount(
          1,
        );
        await expect(
          page.locator('[data-global-save]:visible button[type="submit"]'),
        ).toBeVisible();
        const entryDimensions = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(entryDimensions.scroll).toBeLessThanOrEqual(entryDimensions.client + 1);

        // After Trade is the contract capture workspace on this same real
        // route: history is never defaulted to now, Final Net P&L leads, Actual
        // R waits for the figures it needs, and the Exit Plan starts Not
        // recorded rather than inherited.
        // After Trade is a five-step flow: one topic at a time, Save on the last.
        await page.goto(`/${locale}/app/trades/new?timing=after_trade`);
        const afterForm = page.locator('[data-after-trade-form]');
        await expect(afterForm).toBeVisible();
        await expect(page.getByTestId('new-trade-view-nav')).toHaveCount(0);
        await expect(afterForm.locator('[data-account-context]')).toBeVisible();
        // Step 1 shows answers; no symbol box, radios or datetime input sit in it.
        await expect(afterTradeConcept(page, 'enteredAt')).toHaveAttribute('data-value', '');
        await expect(afterForm.locator('#after-enteredAt')).toHaveCount(0);
        await expect(afterForm.getByRole('textbox', { name: 'Symbol' })).toHaveCount(0);
        await expect(afterForm.getByRole('radio', { name: 'Long', exact: true })).toHaveCount(0);
        await expect(page.locator('button[type="submit"]:visible')).toHaveCount(0);
        await afterTradeStep(page, 'result');
        // The final exit time is read here: it says how the trade ended.
        await expect(afterForm.locator('#after-exitedAt')).toBeVisible();
        await expect(afterForm.locator('[data-exit-time="after-exitedAt"]')).toHaveAttribute(
          'data-value',
          '',
        );
        await expect(afterForm.locator('#after-finalPnl')).toBeVisible();
        await expect(afterForm.locator('[data-actual-r="unavailable"]')).toBeVisible();
        await afterTradeStep(page, 'plan');
        await expect(afterForm.locator('#after-risk')).toBeVisible();
        await expect(afterForm.locator('[data-exit-plan-state]')).toHaveCount(1);
        await expect(afterForm.locator('[data-journal-area]')).toHaveCount(0);
        await afterTradeStep(page, 'context');
        await expect(page.locator('#after-strategy')).toBeVisible();
        await afterTradeStep(page, 'after');
        await expect(page.locator('[data-global-save]:visible button[type="submit"]')).toHaveCount(
          1,
        );

        const dimensions = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      }
    }
  });

  test('After Trade records a closed trade under the contract and offers Review without forcing it', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(240_000);
    const user = await provisionJournalUser('e2e-trades-after-trade-contract');
    await loginAs(page, 'en', user);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/en/app/trades/new?timing=after_trade');
    const afterForm = page.locator('[data-after-trade-form]');
    const actualR = afterForm.locator('[data-actual-r]');

    await afterTradeIdentity(page, 'RETRO', 'Long');
    await expect(afterTradeConcept(page, 'symbol')).toContainText('RETRO');
    await expect(afterTradeConcept(page, 'direction')).toContainText('Long');

    // Final Net P&L and Risk at Entry give Actual R; nothing derives the outcome.
    await afterForm.getByRole('button', { name: 'Next: Result' }).click();
    await afterForm.locator('#after-finalPnl').fill('400');
    await expect(actualR).toHaveAttribute('data-actual-r', 'unavailable');
    await afterTradeStep(page, 'plan');
    await afterForm.locator('#after-risk').fill('100');
    await afterTradeStep(page, 'result');
    await expect(actualR).toHaveAttribute('data-actual-r', 'known');
    await expect(actualR).toContainText('+4.00R');
    for (const outcome of ['Win', 'BE', 'Loss']) {
      await expect(afterForm.getByRole('radio', { name: outcome, exact: true })).not.toBeChecked();
    }

    // A sign-contradicting outcome is the trader's to choose: a quiet notice only.
    await chooseRadio(afterForm, 'Loss');
    await expect(
      afterForm.getByText(/You chose Loss, but your final net P&L is positive/),
    ).toBeVisible();
    await chooseRadio(afterForm, 'Win');
    await expect(afterForm.getByText(/You chose Loss/)).toHaveCount(0);

    // Actual Risk is Risk Discipline evidence; restating Risk at Entry as
    // "different" is the one blocking answer.
    await afterTradeStep(page, 'plan');
    await chooseRadio(afterForm, 'It was different');
    await afterForm.locator('#after-actual-risk-amount').fill('100');
    await expect(afterForm.getByText(/This is the same as your risk at entry/)).toBeVisible();
    await afterForm.locator('#after-actual-risk-amount').fill('120');
    await expect(afterForm.getByText(/This is the same as your risk at entry/)).toHaveCount(0);
    await afterTradeStep(page, 'result');
    await expect(actualR).toContainText('+4.00R');

    // Exit history is supporting evidence; a Complete, fully priced history
    // that differs is a non-blocking discrepancy with an explicit adoption.
    await afterForm.locator('#after-exits-toggle').click();
    await afterForm.getByRole('button', { name: 'Record an exit' }).click();
    const firstExit = afterForm.locator('[data-after-exit]').nth(0);
    await firstExit.locator('input[id$="-pnl"]').fill('150');
    await firstExit.locator('input[id$="-closedPercent"]').fill('25');
    await firstExit.locator('input[id$="-reason"]').fill('Partial at 1R');
    await afterForm.getByRole('button', { name: 'Record an exit' }).click();
    const secondExit = afterForm.locator('[data-after-exit]').nth(1);
    await secondExit.locator('input[id$="-pnl"]').fill('200');
    await chooseRadio(afterForm, 'Some exits are missing');
    await expect(afterForm.getByText(/Your recorded exits add up to/)).toHaveCount(0);
    await chooseRadio(afterForm, 'These are all the exits');
    await expect(afterForm.getByText(/Your recorded exits add up to/)).toBeVisible();
    await afterForm.getByRole('button', { name: 'Use recorded exits' }).click();
    await expect(afterForm.locator('#after-finalPnl')).toHaveValue('350.00');
    await expect(afterForm.getByText(/Your recorded exits add up to/)).toHaveCount(0);
    await expect(actualR).toContainText('+3.50R');

    await afterTradeStep(page, 'context');
    await chooseRadio(afterForm, 'High');
    // An explicit No Fixed Target: an answer the record must read back as such.
    await afterTradeStep(page, 'plan');
    await chooseRadio(afterForm, 'No fixed target You will close on a rule or judgement');

    await afterTradeStep(page, 'after');
    await page.locator('[data-global-save]:visible button[type="submit"]').click();
    const saved = page.locator('[data-after-trade-saved]');
    await expect(saved.getByRole('heading', { name: 'Trade saved' })).toBeFocused({
      timeout: 60_000,
    });
    await expect(saved.getByRole('button', { name: 'Done' })).toBeVisible();
    await saved.getByRole('button', { name: 'Review trade' }).click();

    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+&tab=review/, {
      timeout: 60_000,
    });
    await openTradeSection(page, 'actual');
    const execution = activePanel(page);
    await expect(execution.getByLabel('Actual Result').getByText('+3.50R')).toBeVisible();
    await expect(execution.getByText('Risk at entry', { exact: true })).toBeVisible();
    await expect(execution.getByText(/It was different/)).toBeVisible();
    await expect(execution.locator('[data-exit-scope]')).toHaveCount(0);
    // The stated result is never rebuilt from exit legs.
    await expect(execution.getByRole('button', { name: /as final result/ })).toHaveCount(0);
    await openTradeSection(page, 'entry');
    await expect(activePanel(page).getByText('Recalled after close').first()).toBeVisible();
    // Risk and Target read back as the trader's intent, never as a System Plan.
    await expect(activePanel(page).locator('[data-target-state="no_fixed"]')).toHaveText(
      'No fixed target',
    );
    await expect(activePanel(page).getByText('Risk and target')).toBeVisible();
    await expect(activePanel(page).getByRole('heading', { name: 'System Plan' })).toHaveCount(0);

    // Nothing written has leaked into a second Trade, and nothing about the
    // entry time was invented.
    await page.goto('/en/app/trades/new?timing=after_trade');
    await expect(afterTradeConcept(page, 'symbol')).toHaveAttribute('data-value', '');
    await expect(afterTradeConcept(page, 'enteredAt')).toHaveAttribute('data-value', '');

    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    const narrowForm = page.locator('[data-after-trade-form]');
    await afterTradeStep(page, 'result');
    await narrowForm.locator('#after-finalPnl').fill('123456789.12');
    await narrowForm.locator('#after-exits-toggle').click();
    await narrowForm.getByRole('button', { name: 'Record an exit' }).click();
    const narrowDimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(narrowDimensions.scroll).toBeLessThanOrEqual(narrowDimensions.client + 1);
  });

  // SUPERSEDED by the Add Trade contract (migration 0021): At Entry records
  // price as context only, so it can no longer state a Price-mode actual
  // opening that differs from a Price plan. The legacy rows that already carry
  // that shape keep it, and Trade Detail still renders them.
  test.skip('Phase 15G.3 advanced Price execution preserves a distinct plan and actual basis', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-g3-advanced');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new?timing=at_entry');

    await page.getByRole('textbox', { name: 'Symbol' }).fill('ADVANCED');
    await chooseRadio(page, 'Long');
    await planWithPriceLevels(page);
    await page.getByLabel('Entry', { exact: true }).fill('100');
    await page.getByLabel('Stop Loss', { exact: true }).fill('90');
    await page.getByRole('button', { name: 'Your actual opening differed from this plan' }).click();
    await chooseOpeningBasis(page, 'Price');
    await page.getByLabel('Actual Entry').fill('101');
    await page.getByLabel('Actual Stop').fill('90');
    await page.getByRole('button', { name: 'Save open trade' }).click();

    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    await openTradeSection(page, 'actual');
    await expect(page.getByLabel('Actual').getByText('101')).toBeVisible();
    await expect(page.getByLabel('Actual').getByText('100')).toHaveCount(0);
    await openTradeSection(page, 'system');
    await expect(page.getByLabel('System').getByText('100')).toBeVisible();
    await expect(page.getByLabel('System').getByText('101')).toHaveCount(0);
  });

  test.skip('legacy Trade Plan responsive composition superseded by Phase 15G.3 views', async ({
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
      await page.goto('/en/app/trades/new?timing=at_entry');

      const form = page.locator('[data-at-entry-linear-form]:visible');
      await expect(form).toBeVisible();
      const formBox = await form.boundingBox();
      expect(formBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Direction is a segmented radio, and choosing one visibly selects it.
      await chooseChoice(page, 'Long');

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
      // Playwright's default accessible-name matching is substring-based.
      await expect(quickValues.getByRole('button', { name: symbol, exact: true })).toBeVisible();
      const quickValuesBox = await quickValues.boundingBox();
      expect(quickValuesBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Risk at Entry is the lead figure and stays within the viewport.
      const riskField = page.getByLabel('Risk at entry', { exact: true });
      await expect(riskField).toBeVisible();
      await riskField.fill('100.00');
      const riskBox = await riskField.boundingBox();
      expect(riskBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Target is an explicit answer, and the Exit Plan is a first-class one
      // beside it — neither is an overlay at any width.
      await chooseChoice(page, /Fixed target/);
      await expect(page.getByLabel('Target profit')).toBeVisible();
      await expect(form.locator('[data-exit-plan-state]')).toHaveCount(1);

      /*
        Every analytical question is reachable at this width without an
        overlay: below `lg` the disclosure holds them behind one control, and
        from `lg` up they are already open (the toggle is `lg:hidden`).
      */
      const strategyField = page.getByLabel('Strategy', { exact: true });
      const analysisToggle = page.getByRole('button', { name: /Answer these now/ });
      await expect(strategyField.or(analysisToggle).first()).toBeVisible();
      if (await analysisToggle.isVisible()) await analysisToggle.click();
      await expect(strategyField).toBeVisible();
      await classifyAtEntry(page, 'Golden Breakout', 'Clean Retest');
      await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);

      // Confidence's five-step selector remains usable at this width: all
      // five segments stay immediately available (no horizontal scroll to
      // reach any of them — Founder-UAT Confidence redesign §9), and
      // clicking one genuinely selects it.
      const confidenceGroup = page.getByRole('group', { name: 'Confidence' });
      await expect(confidenceGroup).toBeVisible();
      const confidenceGroupBox = await confidenceGroup.boundingBox();
      expect(confidenceGroupBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);
      // All five options stay available at this width, and choosing one selects it.
      await expect(page.locator('[id^="entry-confidence-"]')).toHaveCount(5);
      await chooseChoice(confidenceGroup, 'High');
      await expect(page.locator('#entry-confidence-75')).toBeChecked();

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

      // The one Save is present at this width, wherever it is drawn.
      await expect(page.locator('[data-global-save]:visible button[type="submit"]')).toHaveCount(1);

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

    await openTradeSection(page, 'actual');

    await page.getByRole('button', { name: 'Full Close' }).click();
    let dialog = actionDialog(page);
    await dialog.getByLabel('Exit', { exact: true }).fill('110');
    await dialog.getByLabel('Realized net P&L').fill('100.00');
    await dialog.getByRole('button', { name: 'Full Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'review');
    await page.getByRole('button', { name: /System assessment/ }).click();
    dialog = await assessSystem(page, { closed: 'Plan target', cost: '0.10' });
    const systemDialogBox = await dialog.boundingBox();
    expect(systemDialogBox?.width ?? 999).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'Confirm assessment' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.locator('[data-trade-review-state="needs_system_result"]')).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const close = await tradeDetails(page)
      .getByRole('button', { name: 'Close' })
      .first()
      .boundingBox();
    expect(close?.height ?? 0).toBeGreaterThanOrEqual(44);
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

    await page.goto('/en/app/trades/new?timing=at_entry');
    // The contract minimum: Account, Symbol, Direction and Risk at Entry.
    // No Target, no Exit Plan, no Strategy, no Setup.
    await recordOpenMinimum(page, { symbol: 'NZDCAD', direction: 'Long', risk: '100.00' });
    // Save now, straight from Plan & Risk: Steps 3 and 4 are never required.
    await page.locator('#entry-quick-save').click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);

    await openTradeSection(page, 'strategy');
    const classification = activePanel(page);
    await expect(classification.getByText('No strategy assigned')).toBeVisible();
    const addStrategyButton = classification.getByRole('button', { name: 'Add Strategy' });
    await expect(addStrategyButton).toBeVisible();
    await addStrategyButton.click();
    const classifyDialog = actionDialog(page);
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
    await page.goto('/en/app/trades/new?timing=at_entry');
    await expect(page.locator('[data-account-context]:visible')).toBeVisible();
    await recordOpenMinimum(page, { symbol: 'NZDUSD', direction: 'Long', risk: '100.00' });
    await chooseChoice(page, /^Fixed target/);
    await page.getByLabel('Target profit').fill('300.00');
    await classifyAtEntry(page, 'Golden Breakout', 'Clean Retest');
    await expect(page.locator('#entry-setup')).toContainText('Clean Retest');
    await answerCondition(page, 'Breakout candle closed', 'Met');
    await answerCondition(page, 'Retest held', 'Met');
    await answerCondition(page, 'Volume expanded', 'Met');
    await recordOpenStep(page, 'context');
    await chooseChoice(page, 'High');
    await chooseEntryEmotions(page, ['Focused']);
    await page
      .getByLabel('Why this trade')
      .fill('Clean breakout confirmed on the retest with expanding volume.');
    await recordOpenSave(page);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });

    // Arrives directly on Detail already Open — Partial Close/Close Trade are
    // immediately visible (brief §7), no premature final Actual R/outcome.
    const detail = tradeDetailsFor(page, 'NZDUSD');
    await expect(page.getByText('Long').first()).toBeVisible();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(
      activePanel(page).getByText("The System result hasn't been recorded yet."),
    ).toBeVisible();
    // Planned R belongs to System; contextual entry evidence remains in Entry
    // Snapshot.
    await openTradeSection(page, 'system');
    await expect(detail.getByText('+3.00R').first()).toBeVisible(); // Planned R = 300.00 / 100.00
    await openRecordedEmotions(page);
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
    const actualSection = activePanel(page);
    await expect(
      actualSection.getByText('Actual Result will be available after the Trade is closed.'),
    ).toBeVisible();
    await expect(actualSection.getByText('Win', { exact: true })).toHaveCount(0);

    // 2. Partial Close roughly half the position with a realized P&L — Realized R
    // to date and remaining % appear; the Trade still reads Open, with no final
    // Actual R/outcome yet.
    await openTradeSection(page, 'actual');
    await page.getByRole('button', { name: 'Partial Close' }).click();
    let dialog = actionDialog(page);
    await dialog.getByLabel('Closed').fill('50');
    await dialog.getByLabel('Realized net P&L').fill('150.00');
    await dialog.getByRole('button', { name: 'Partial Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'actual');
    await expect(
      detail.getByText('Realized R so far').locator('..').getByText('+1.50R'),
    ).toBeVisible();
    // The "Close Remaining" button (rendered above the dl) and the dl's own
    // "Remaining" label both contain the substring "Remaining" — `.last()`
    // reaches the dl row, which is the one with a sibling percent value.
    await expect(
      actualSection.getByText('Remaining', { exact: true }).locator('..').getByText('50%'),
    ).toBeVisible();
    await expect(actualSection.getByText('Partial', { exact: true })).toBeVisible();
    await expect(actualSection.getByText('Win', { exact: true })).toHaveCount(0);

    // 3. System resolve — resolved completely independently of the Actual side's
    // partial-open state; the System Result is visible while Actual is untouched.
    await openTradeSection(page, 'review');
    await page.getByRole('button', { name: /System assessment/ }).click();
    dialog = await assessSystem(page, { closed: 'Plan target', cost: '0.10' });
    await expect(dialog.getByLabel('System exit price')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Confirm assessment' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'system');
    await expect(activePanel(page).getByText('Win', { exact: true })).toBeVisible();
    await openTradeSection(page, 'actual');
    await expect(actualSection.getByText('Win', { exact: true })).toHaveCount(0);

    // 4. Final Close — close the remaining half; the Trade now reads Closed with
    // the correct final Actual R: SUM(realized_pnl) / initial_risk =
    // (150.00 + 250.00) / 100.00 = +4.00R — no double-weighting of already-
    // realized legs.
    await openTradeSection(page, 'actual');
    await page.getByRole('button', { name: 'Close Remaining' }).click();
    dialog = actionDialog(page);
    await expect(dialog.getByText('Closing the exact remaining 50%.')).toBeVisible();
    await dialog.getByLabel('Realized net P&L').fill('250.00');
    await advanceDatetimeLocal(dialog.getByLabel('Exited', { exact: true }), 3);
    await dialog.getByRole('button', { name: 'Close Remaining' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'actual');
    await expect(actualSection.getByText('+4.00R').first()).toBeVisible();
    // Appears once in the compact result-first hero and once in the full
    // detail's Trader Outcome row — both by design (brief §11).
    await expect(actualSection.getByText('Outcome not answered').first()).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(activePanel(page).getByText('Win', { exact: true })).toBeVisible();

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
    await expect(detail.getByText('3 of 3 conditions met')).toBeVisible();
    await expect(detail.locator('[data-trade-confidence="75"]')).toHaveText('High');
    await expect(
      detail.getByText('Clean breakout confirmed on the retest with expanding volume.'),
    ).toBeVisible();
    await openRecordedEmotions(page);
    await expect(page.getByRole('button', { name: 'Focused' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await openTradeSection(page, 'actual');
    await expect(actualSection.getByText('Money', { exact: true })).toBeVisible();
    await expect(actualSection.getByText('+4.00R').first()).toBeVisible();
    await expect(actualSection.getByText('Outcome not answered').first()).toBeVisible();
    await expect(actualSection.getByText('Exit 1', { exact: true })).toBeVisible();
    await expect(actualSection.getByText('Exit 2', { exact: true })).toBeVisible();

    await openTradeSection(page, 'system');
    const systemSection = activePanel(page);
    await expect(systemSection.getByText('+2.90R')).toBeVisible();
    await expect(systemSection.getByText('Win', { exact: true })).toBeVisible();

    await openTradeSection(page, 'review');
    await expect(ruleStatus).toHaveValue('followed');
    await expect(page.getByText('Trimmed the first leg early, ahead of plan.')).toBeVisible();
    await expect(reviewNotes).toHaveValue('Followed the Setup but exited the first leg too early.');

    // 7. List — the compact Log reflects the authoritative CLOSED Actual R,
    // never a stale partial figure; outcome wording remains Detail-only.
    await page.goto('/en/app/trades');
    const listRow = tradeRow(page, 'NZDUSD');
    await expect(listRow.getByText('+4.00R')).toBeVisible();
    // A contract row's Trader Outcome is the trader's own answer, and the Log
    // never shows a derived one (contract §12).
    await expect(listRow.getByText('Win', { exact: true })).toHaveCount(0);
    await expect(listRow.getByText('NOT ANSWERED')).toBeVisible();
    await expect(listRow.getByText('Realized R so far')).toHaveCount(0);

    // 8. Analytics — this Trade contributes to both Trader and System
    // performance, and its Setup Adherence / Confidence / Emotion appear in the
    // behavioral sections.
    await page.goto('/en/app/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'All' }).click();
    await expect(page).toHaveURL(/range=all/, { timeout: 30_000 });

    await page.getByRole('link', { name: 'Results', exact: true }).click();
    const systemPanel = page.locator('[data-analytics-panel="system"]');
    const traderPanel = page.locator('[data-analytics-panel="trader"]');
    /*
      CANONICAL POPULATIONS (contract §25, §28; commit 8d8eb99). This Trade is
      a contract row, so its Actual R counts; its System result was recorded
      under the earlier model, so no System, adherence or emotion System axis
      admits it until a canonical System Assessment exists.
    */
    await expect(systemPanel.getByText('0 Trades')).toBeVisible();
    await expect(traderPanel.getByText('1 Trade')).toBeVisible();

    await page.goto('/en/app/analytics?view=edge&range=all');
    await page.waitForLoadState('networkidle');
    const setupAdherencePanel = page.locator('[data-analytics-panel="setup-adherence"]');
    // Three answered Conditions, all Met: the two left unanswered are not
    // recorded, so adherence is 100%, not 60% (contract §24).
    const adherenceBucket = setupAdherencePanel.locator('li', { hasText: /100%/ }).first();
    await expect(adherenceBucket.locator('[data-analytics-axis="trader"]')).toContainText(
      '1 Trade',
    );
    await expect(adherenceBucket.locator('[data-analytics-axis="system"]')).toContainText(
      '0 Trades',
    );

    const conditionsPanel = page.locator('[data-analytics-panel="conditions"]');
    const metCondition = conditionsPanel.locator('li', { hasText: 'Breakout candle closed' });
    await expect(
      metCondition.locator(
        '[data-analytics-condition-status="met"] [data-analytics-axis="trader"]',
      ),
    ).toContainText('1 Trade');
    const notMetCondition = conditionsPanel.locator('li', { hasText: 'Invalidation is clear' });
    // Left unanswered at entry, so it is not recorded — never a Not Met (§24).
    await expect(
      notMetCondition.locator(
        '[data-analytics-condition-status="notMet"] [data-analytics-axis="trader"]',
        { hasText: '1 Trade' },
      ),
    ).toHaveCount(0);

    await page.goto('/en/app/analytics?view=behavior&range=all');
    const confidencePanel = page.locator('[data-analytics-panel="confidence"]');
    const confidenceLevel75 = confidencePanel.locator('li', { hasText: '75%' });
    await expect(confidenceLevel75.locator('[data-analytics-axis="trader"]')).toContainText(
      '1 Trade',
    );

    const emotionsPanel = page.locator('[data-analytics-panel="emotions"]');
    const focusedGroup = emotionsPanel.locator('li', { hasText: 'Focused' });
    await expect(focusedGroup.locator('[data-analytics-axis="trader"]')).toContainText('1 Trade');
    await expect(focusedGroup.locator('[data-analytics-axis="system"]')).toContainText('0 Trades');

    await page.goto('/en/app/analytics?view=results&range=all');
    await expect(
      page.locator('[data-analytics-panel="mistakes"]').getByText('1 Trade'),
    ).toBeVisible();
    await expect(page.locator('[data-analytics-panel="rules"]').getByText('100.00%')).toBeVisible();
  });

  test('Phase 14C/14E — minimal New Trade with no Plan/Strategy/Setup opens atomically, Actual closes while System stays Pending, then classifies the Trade later', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(LONG_TRADE_FLOW_TIMEOUT_MS);
    const user = await provisionJournalUser('e2e-trades-independent-ux');
    await seedFramework(user.id);
    await loginAs(page, 'en', user);

    // Journey A — the minimal New Trade contract (Phase 14E): Account
    // (auto-selected), Symbol, Direction, and the one required Actual
    // execution basis — genuinely NO Plan, Strategy, or Setup at all (the
    // Phase 14C.1 no-Plan contract, migration 0016, still holds — Plan
    // remains optional data). Creates the Trade already Open in one atomic
    // action; Open never silently reintroduces a Plan requirement.
    await page.goto('/en/app/trades/new?timing=at_entry');
    await expect(page.locator('[data-account-context]:visible')).toBeVisible();
    // A fresh form holds no leaked answer: Strategy unanswered, Risk blank.
    await recordOpenStep(page, 'setup');
    await expect(page.locator('#entry-strategy')).toHaveAttribute('data-answer', 'unanswered');
    await recordOpenStep(page, 'plan');
    await expect(page.locator('#entry-risk')).toHaveValue('');
    await recordOpenMinimum(page, { symbol: 'GBPUSD', direction: 'Long', risk: '125.00' });
    await recordOpenSave(page);
    // Nothing is confirmed on the way out: an unanswered question is not a
    // negative answer, so the Trade opens directly.
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const tradeUrl = page.url();

    const detail = tradeDetailsFor(page, 'GBPUSD');
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();
    await openTradeSection(page, 'system');
    const planSection = detail
      .getByRole('heading', { name: 'System Plan' })
      .locator('..')
      .locator('..');
    // Price was never recorded here: the plan is the Risk at Entry the trader
    // stated, and the Price fields stay truthfully absent.
    await expect(planSection.getByText('Not available')).toBeVisible();
    await expect(planSection.getByText('1.2500')).toHaveCount(0);
    await openTradeSection(page, 'strategy');
    const classification = activePanel(page);
    await expect(classification.getByText('No strategy assigned')).toBeVisible();
    await expect(classification.getByText(/Assigning one later is normal/)).toBeVisible();
    const addStrategyButton = classification.getByRole('button', { name: 'Add Strategy' });
    await expect(addStrategyButton).toBeVisible();

    // The Trade List already reflects this unclassified, no-Plan, already-
    // Open Trade truthfully — it appears normally, nothing hidden or blocked.
    await page.goto('/en/app/trades');
    await expect(tradeRow(page, 'GBPUSD')).toBeVisible();
    await page.goto(tradeUrl);

    // Journey B — Full Close the Actual side; System remains explicitly
    // Pending throughout — never inferred, never blocked.
    await openTradeSection(page, 'actual');
    await openTradeSection(page, 'actual');
    await page.getByRole('button', { name: 'Full Close' }).click();
    const dialog = actionDialog(page);
    await dialog.getByLabel('Exit', { exact: true }).fill('1.2700');
    // An At Entry Trade is a Money result: the close records its realized P&L.
    await dialog.getByLabel('Realized net P&L').fill('125.00');
    await dialog.getByRole('button', { name: 'Full Close' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
    await openTradeSection(page, 'actual');
    /*
      An Add Trade contract row (contract §12, §25): the Trade is closed and
      its Actual R is recorded, but the Trader Outcome is the trader's own
      answer and nothing has asked for it, so no WIN label is presented.
    */
    await expect(detail.getByText('Outcome not answered').first()).toBeVisible();
    await expect(detail.getByText('Win', { exact: true })).toHaveCount(0);
    // System is still Pending — Actual closing never advances it.
    await openTradeSection(page, 'system');
    await expect(
      activePanel(page).getByText("The System result hasn't been recorded yet."),
    ).toBeVisible();
    await openTradeSection(page, 'system');
    await expect(
      activePanel(page).getByText("The System result hasn't been recorded yet."),
    ).toBeVisible();
    // No fake Execution Gap while one side has no final result yet.
    await expect(detail.getByText('Execution Gap')).toHaveCount(0);

    // The closed-but-System-pending Trade is immediately eligible for Trader
    // Analytics, and the Analytics page truthfully discloses the pending
    // System outcome rather than silently omitting or miscounting it.
    await page.goto('/en/app/analytics');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'All' }).click();
    await expect(page).toHaveURL(/range=all/, { timeout: 30_000 });
    await page.getByRole('link', { name: 'Results', exact: true }).click();
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
    const classifyDialog = actionDialog(page);
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
    const conditionsHeading = detail.getByRole('heading', { name: 'Setup Checklist' });
    await expect(conditionsHeading.locator('..').getByText('Not recorded')).toBeVisible();
  });

  test('Phase 15G.1 — the Trade Log lists every seeded Trade, a day filter narrows it, and each Needs Attention state opens the tab that clears it', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(180_000);
    const user = await provisionJournalUser('e2e-trades-calendar');
    await seedCalendarTrades(user.id);
    await loginAs(page, 'en', user);

    /*
      THE CALENDAR IS NO LONGER A MODE OF THIS ROUTE (commit 201195d): the
      Trades page is a Trade Log at all times, and the Trading Calendar lives
      on the Dashboard, where `dashboard-calendar.spec.ts` covers it — axis
      switching, month paging, and the rule that a Trader date and a System
      date never collapse onto one cell included. What is still this page's
      own contract is asserted here: the Log lists what was seeded, a day
      filter narrows it, and the retired `?view=`/`?month=` keys stay
      tolerated rather than failing closed.
    */
    await page.goto('/en/app/trades');
    await expect(tradeRows(page)).toHaveCount(3);
    await expect(page.getByTestId('trading-calendar')).toHaveCount(0);

    await page.goto('/en/app/trades?view=calendar&month=2026-08');
    await expect(page.getByTestId('trading-calendar')).toHaveCount(0);
    await expect(tradeRows(page)).not.toHaveCount(0);

    // Trade C's Actual finalized on Aug 20 and its System resolved on Aug 21;
    // the Log is journal chronology, so the day filter reads the Actual day.
    await page.goto('/en/app/trades?view=log&month=2026-08&date=2026-08-20');
    await expect(page.getByRole('link', { name: 'ACTUALFIRST', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'CROSSDATE', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'UNCLASSIFIEDOPEN', exact: true })).toBeVisible();

    // An explicit Log URL without a date restores the unfiltered page.
    await page.goto('/en/app/trades?view=log&month=2026-08');
    await expect(page).not.toHaveURL(/date=/);

    // The unclassified, still-Open Trade keeps its late-classification action.
    await page.goto('/en/app/trades?view=log&month=2026-08&date=2026-08-20');
    await tradeRow(page, 'UNCLASSIFIEDOPEN')
      .getByRole('link', { name: 'Unclassified', exact: true })
      .click();
    await expect(page).toHaveURL(/trade=/);
    const unclassifiedDetail = tradeDetailsFor(page, 'UNCLASSIFIEDOPEN');
    await expect(unclassifiedDetail.getByText('No strategy assigned')).toBeVisible();
    await expect(unclassifiedDetail.getByRole('button', { name: 'Add Strategy' })).toBeVisible();

    // Trade B's System-Pending action remains reachable from the same day —
    // an Actual close never advances or blocks the System side.
    await page.goto('/en/app/trades?view=log&month=2026-08&date=2026-08-20');
    await tradeRow(page, 'ACTUALFIRST')
      .getByRole('link', { name: 'Needs system result', exact: true })
      .click();
    await expect(page).toHaveURL(/trade=/);
    await openTradeSection(page, 'review');
    await tradeDetailsFor(page, 'ACTUALFIRST')
      .getByRole('button', { name: /System assessment/ })
      .click();
    const systemDialog = await assessSystem(page, { closed: 'Plan target' });
    await systemDialog.getByRole('button', { name: 'Confirm assessment' }).click();
    await expect(systemDialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await openTradeSection(page, 'system');
    await expect(activePanel(page).getByText('+2.00R', { exact: true }).first()).toBeVisible();
    await expect(activePanel(page).getByText('Target reached', { exact: true })).toBeVisible();
  });

  test('Phase 15G.1 — Trade Log uses 10-row URL pagination with reload-safe Previous', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(120_000);
    const user = await provisionJournalUser('e2e-trades-pagination');
    await seedPaginatedTrades(user.id);
    await loginAs(page, 'en', user);

    await page.goto('/en/app/trades?view=log&month=2026-08&date=2026-08-22');
    await expect(tradeRows(page)).toHaveCount(25);
    await expect(page.getByText('Page 1')).toBeVisible();
    await page.getByRole('link', { name: /Next/ }).click();
    await expect(page.getByText('Page 2')).toBeVisible();
    await expect(tradeRows(page)).toHaveCount(2);
    await expect(page).toHaveURL(/view=log.*date=2026-08-22.*cursor=/);

    await page.reload();
    await expect(page.getByText('Page 2')).toBeVisible();
    await page.getByRole('link', { name: /Previous/ }).click();
    await expect(page.getByText('Page 1')).toBeVisible();
    await expect(tradeRows(page)).toHaveCount(25);
    await expect(page).toHaveURL(/view=log.*date=2026-08-22/);
    await expect(page).not.toHaveURL(/cursor=/);
  });

  test('Phase 15G.3 pending Analytics action stays filtered through pagination and deep action', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(LONG_TRADE_FLOW_TIMEOUT_MS);
    const user = await provisionJournalUser('e2e-system-pending-filter');
    await seedPendingWorkflowTrades(user.id);
    await loginAs(page, 'en', user);

    await page.goto('/en/app/analytics?view=overview&range=all');
    const review = page.getByRole('link', { name: 'Review pending' });
    await expect(review).toBeVisible();
    await review.click();
    await expect(page).toHaveURL(/view=log.*attention=system-pending/);

    await expect(tradeRows(page)).toHaveCount(25);
    await expect(
      page.locator('[data-trade-review-state="needs_system_result"]:visible'),
    ).toHaveCount(25);
    await expect(page.getByRole('link', { name: 'RESOLVEDROW', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'NOTRADEROW', exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: /Next/ }).click();
    await expect(page).toHaveURL(/attention=system-pending/);
    await expect(page).toHaveURL(/cursor=/);
    await expect(tradeRows(page)).toHaveCount(2);
    await expect(
      page.locator('[data-trade-review-state="needs_system_result"]:visible'),
    ).toHaveCount(2);

    await page.setViewportSize({ width: 320, height: 720 });
    // The Review column links each actionable state to the tab that clears it.
    const updateOutcome = page
      .getByRole('link', { name: 'Needs system result', exact: true })
      .first();
    await expect(async () => {
      await updateOutcome.focus();
      await updateOutcome.press('Enter');
      await page.waitForURL(/trade=/, { timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [250] });
    await expect(page).toHaveURL(/attention=system-pending/);
    await expect(tradeDetails(page)).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  });

  test('Phase 15G.1 mobile — the Trade Log stays usable and paginates at 390px and 320px', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(120_000);
    const user = await provisionJournalUser('e2e-trades-calendar-mobile');
    await seedCalendarTrades(user.id);
    await seedPaginatedTrades(user.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'en', user);

    /*
      The Calendar is a Dashboard surface now (commit 201195d), and its own
      mobile composition is covered in `dashboard-calendar.spec.ts`. What this
      page owes a phone is the Log itself: every row reachable, the Needs
      Attention action reachable, and no horizontal page scroll.
    */
    await page.goto('/en/app/trades?view=log&month=2026-08&date=2026-08-20');
    await expect(page.getByTestId('trading-calendar')).toHaveCount(0);
    const actualFirstRow = tradeRow(page, 'ACTUALFIRST');
    await expect(actualFirstRow).toBeVisible();
    await actualFirstRow.getByRole('link', { name: 'Needs system result', exact: true }).click();
    await expect(page).toHaveURL(/trade=/);
    await expect(tradeDetails(page)).toBeVisible();
    const sheetBox = await tradeDetails(page).boundingBox();
    expect(sheetBox?.width ?? 999).toBeLessThanOrEqual(390 + 1);

    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);

    await page.goto('/en/app/trades?view=log&month=2026-08&date=2026-08-22');
    await expect(tradeRows(page)).toHaveCount(25);
    await page.getByRole('link', { name: /Next/ }).click();
    await expect(page.getByText('Page 2')).toBeVisible();
    await expect(tradeRows(page)).toHaveCount(2);

    // Explicit 320px + Thai smoke: the same compact record reflows without
    // horizontal scroll and translated status/action copy remains reachable.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/th/app/trades?view=log&month=2026-08&date=2026-08-20');
    await expect(
      tradeRow(page, 'ACTUALFIRST').getByRole('link', { name: 'ต้องสรุปผลตามระบบ' }),
    ).toBeVisible();
    const narrowDimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(narrowDimensions.scroll).toBeLessThanOrEqual(narrowDimensions.client + 1);
  });
});
