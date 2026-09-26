import { expect, test, type Page } from '@playwright/test';
import { asc, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { tradeExits, trades, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';
import { recordOpenMinimum, recordOpenSave } from './support/record-open';

/**
 * CANONICAL STAGE 5 — Close Existing Open Trade, in a real browser.
 *
 * Record Open saves a contract Trade; its Execution panel offers "Record
 * partial exit" and "Close trade", each opening the Stage 5 page with the
 * scope already chosen. Behaviour and persistence, at 390px and 1440px.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 1000 };

function withDb<T>(run: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client);
  return run(db).finally(() => client.end());
}

async function newUser(page: Page, prefix: string): Promise<{ workspaceId: string }> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'E2E Stage 5',
  });
  const workspaceId = await withDb(async (db) => {
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, user.id));
    return row!.id;
  });
  await loginAs(page, 'en', user);
  return { workspaceId };
}

async function latestTrade(workspaceId: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(trades)
      .where(eq(trades.workspaceId, workspaceId))
      .orderBy(desc(trades.createdAt))
      .limit(1);
    return row!;
  });
}

async function exitsOf(tradeId: string) {
  return withDb((db) =>
    db
      .select()
      .from(tradeExits)
      .where(eq(tradeExits.tradeId, tradeId))
      .orderBy(asc(tradeExits.sequence)),
  );
}

async function expectNoOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${where}: horizontal overflow ${overflow}px`).toBeLessThanOrEqual(0);
}

async function chooseChoice(page: Page, name: string) {
  const radio = page.getByRole('radio', { name, exact: true });
  const id = await radio.getAttribute('id');
  await page.locator(`label[for="${id}"]`).click();
  await expect(radio).toBeChecked();
}

test.describe('Stage 5 — Record partial exit and Close trade', () => {
  test.describe.configure({ retries: 0 });
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Viewports are set per test');
  });

  for (const [name, size] of [
    ['390px', PHONE],
    ['1440px', DESKTOP],
  ] as const) {
    test(`a Part keeps the trade open; Close trade closes it on the stated result, at ${name}`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      await page.setViewportSize(size);
      const { workspaceId } = await newUser(page, `stage5-${size.width}`);

      await page.goto('/en/app/trades/new?timing=at_entry');
      await recordOpenMinimum(page, { symbol: 'XAUUSD', direction: 'Long', risk: '100' });
      await recordOpenSave(page);
      await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
      const saved = await latestTrade(workspaceId);
      expect(saved).toMatchObject({ status: 'open', recordingContract: 'add_trade_v1' });

      // PART — from the trade's Execution panel; the scope is already chosen.
      await page.goto(`/en/app/trades?trade=${saved.id}&tab=execution`);
      await page.getByRole('link', { name: 'Record partial exit' }).click();
      await expect(page).toHaveURL(/\/en\/app\/trades\/close\?trade=.+&scope=part/);
      await expect(page.locator('[data-close-form="part"]')).toBeVisible();
      await expect(page.getByLabel('Final net P&L')).toHaveCount(0);
      await expect(page.getByRole('radio', { name: 'Win', exact: true })).toHaveCount(0);
      await expectNoOverflow(page, `${name} part`);
      await page.getByLabel('P&L for this exit').fill('50');
      await page.getByLabel('% of original position').fill('25');
      await page.getByRole('button', { name: 'Record partial exit', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/en/app/trades\\?trade=${saved.id}`), {
        timeout: 60_000,
      });
      await expect.poll(async () => (await exitsOf(saved.id)).length, { timeout: 20_000 }).toBe(1);
      expect(await latestTrade(workspaceId)).toMatchObject({
        status: 'open',
        netPnlMinor: null,
        actualR: null,
        traderOutcome: null,
      });
      expect((await exitsOf(saved.id))[0]).toMatchObject({
        exitScope: 'part',
        realizedPnlMinor: 5000n,
        closedBps: 2_500,
        exitedAt: null,
      });

      // ALL REMAINING — the explicit Final Close.
      await page.goto(`/en/app/trades?trade=${saved.id}&tab=execution`);
      await page.getByRole('link', { name: 'Close trade' }).click();
      await expect(page.locator('[data-close-form="all_remaining"]')).toBeVisible();
      // The final exit time starts unanswered; "Use now" is offered, not applied.
      const finalTime = page.locator('[data-exit-time="close-finalExitedAt"]');
      await expect(finalTime).toHaveAttribute('data-value', '');
      await expect(page.locator('[data-actual-r]')).toHaveAttribute('data-actual-r', 'unavailable');
      await page.getByRole('button', { name: 'Use now for Final exit date & time' }).click();
      await expect(finalTime).not.toHaveAttribute('data-value', '');
      await page.getByLabel('Final net P&L').fill('-30');
      await expect(page.locator('[data-actual-r]')).toHaveText(/-0\.30R/);
      await chooseChoice(page, 'Loss');
      // Record Open left the Target unanswered: the close asks it (decision 59).
      await chooseChoice(page, 'Fixed target');
      await page.getByLabel('Target profit').fill('60');
      await expectNoOverflow(page, `${name} close`);
      await page.getByRole('button', { name: 'Close trade', exact: true }).click();
      // The Final Close continues into Stage 6 (optional After-Trade Context).
      await expect(page).toHaveURL(
        new RegExp(`/en/app/trades/after-trade\\?trade=${saved.id}&from=close`),
        { timeout: 60_000 },
      );
      await expect
        .poll(async () => (await latestTrade(workspaceId)).status, { timeout: 20_000 })
        .toBe('closed');
      const closed = await latestTrade(workspaceId);
      expect(closed).toMatchObject({
        netPnlMinor: -3000n,
        finalPnlSource: 'manual_total',
        actualR: '-0.3000',
        traderOutcome: 'loss',
        targetState: 'fixed',
        plannedRewardMinor: 6000n,
      });
      expect(closed.traderOutcomeSelectedAt).not.toBeNull();
      expect(closed.exitedAt).not.toBeNull();
      expect(closed.postTradeEmotionsRecordedAt).toBeNull();
      const legs = await exitsOf(saved.id);
      expect(legs.map((leg) => leg.exitScope)).toEqual(['part', 'all_remaining']);
    });
  }

  test('a blocked Close focuses the final exit time and says precisely why', async ({ page }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const { workspaceId } = await newUser(page, 'stage5-blocked');
    await page.goto('/en/app/trades/new?timing=at_entry');
    await recordOpenMinimum(page, { symbol: 'EURUSD', direction: 'Short', risk: '50' });
    await recordOpenSave(page);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    const saved = await latestTrade(workspaceId);

    await page.goto(`/en/app/trades/close?trade=${saved.id}&scope=all`);
    const row = page.locator('#close-finalExitedAt');
    await row.click();
    const sheet = page.getByRole('dialog');
    // Today at 00:00: before the entry, which Record Open took as "now".
    await sheet.locator('#close-finalExitedAt-date').click();
    await sheet.locator('[data-range-date]:not([disabled])').last().click();
    await sheet.locator('#close-finalExitedAt-time').click();
    await sheet.locator('#close-finalExitedAt-wheel-hour [data-wheel-value="00"]').click();
    await sheet.locator('#close-finalExitedAt-wheel-minute [data-wheel-value="00"]').click();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Close trade', exact: true }).click();
    await expect(row).toBeFocused();
    await expect(page.getByText('The exit time cannot be before the entry time.')).toBeVisible();
    expect(await latestTrade(workspaceId)).toMatchObject({ status: 'open' });
  });

  test('the close draft survives a reload; entry details are read-only; no legacy close remains', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const { workspaceId } = await newUser(page, 'stage5-draft');
    await page.goto('/en/app/trades/new?timing=at_entry');
    await recordOpenMinimum(page, { symbol: 'GBPUSD', direction: 'Long', risk: '80' });
    await recordOpenSave(page);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    const saved = await latestTrade(workspaceId);
    const closeDrafts = () =>
      page.evaluate(
        () =>
          Object.keys(window.localStorage).filter((key) =>
            key.startsWith('tradechemist:close-draft:'),
          ).length,
      );

    // The legacy close is retired for a contract Trade: only the Stage 5 entries remain.
    await page.goto(`/en/app/trades?trade=${saved.id}&tab=execution`);
    await expect(page.getByRole('link', { name: 'Close trade' })).toBeVisible();
    for (const name of ['Partial Close', 'Close Remaining', 'Full Close']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }

    // Answers survive a real reload.
    await page.goto(`/en/app/trades/close?trade=${saved.id}&scope=all`);
    await page.getByLabel('Final net P&L').fill('40');
    await chooseChoice(page, 'Win');
    // Only a record whose Required items are answered closes (decision 59):
    // the unanswered Target is asked here, and nothing is written meanwhile.
    await page.getByRole('button', { name: 'Close trade', exact: true }).click();
    await expect(page.locator('#close-plan-targetState-fixed')).toBeFocused();
    await expect(
      page.getByText('1 required item left before you can close this trade.'),
    ).toBeVisible();
    expect(await latestTrade(workspaceId)).toMatchObject({ status: 'open', targetState: null });
    await chooseChoice(page, 'No fixed target');
    await expect.poll(closeDrafts).toBe(1);
    await page.reload();
    await expect(page.getByLabel('Final net P&L')).toHaveValue('40');
    await expect(page.getByRole('radio', { name: 'Win', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'No fixed target', exact: true })).toBeChecked();
    // No Fixed Target makes the Exit Plan Required; No exit rule answers it.
    await page.locator('#close-plan-exitPlan').click();
    const exitSheet = page.getByRole('dialog');
    await exitSheet.getByRole('button', { name: 'No defined exit rule' }).click();
    await exitSheet.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-close-completion]')).toHaveAttribute(
      'data-close-completion',
      'ready',
    );
    await expect(
      page.getByText('Your unsaved answers for this close were restored.'),
    ).toBeVisible();

    // Entry details: read-only, in a focused sheet.
    await page.getByRole('button', { name: 'View entry details' }).click();
    const sheet = page.getByRole('dialog', { name: 'Entry details' });
    await expect(sheet.locator('[data-entry-detail="riskAtEntry"]')).toContainText('80');
    await expect(sheet.getByRole('textbox')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expectNoOverflow(page, 'draft close');

    // A successful close clears the Exit & Result draft, and continues into Stage 6.
    await page.getByRole('button', { name: 'Close trade', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/en/app/trades/after-trade\\?trade=${saved.id}&from=close`),
      { timeout: 60_000 },
    );
    expect(await closeDrafts()).toBe(0);
    await expect
      .poll(async () => (await latestTrade(workspaceId)).status, { timeout: 20_000 })
      .toBe('closed');
    expect(await latestTrade(workspaceId)).toMatchObject({
      netPnlMinor: 4000n,
      traderOutcome: 'win',
    });
  });
});
