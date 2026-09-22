import { expect, test, type Page } from '@playwright/test';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { trades, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';
import { recordOpenMinimum, recordOpenSave } from './support/record-open';

/**
 * CANONICAL STAGE 6 — AFTER-TRADE CONTEXT, in a real browser.
 *
 * Close Existing Open Trade: the Final Close lands on Stage 6, which says the
 * Trade is already closed and asks only optional context; saved or skipped,
 * the trader chooses Review Trade or Done, and can come back later. Record
 * Closed: Stage 6 is the last step, saved with the Trade.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 1000 };
const CHART = 'https://www.tradingview.com/x/After0001/';

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
    name: 'E2E Stage 6',
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

async function expectNoOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${where}: horizontal overflow ${overflow}px`).toBeLessThanOrEqual(0);
}

/** Record Open, then the canonical Final Close; lands on Stage 6. Returns the Trade id. */
async function closeATrade(page: Page, workspaceId: string, symbol: string): Promise<string> {
  await page.goto('/en/app/trades/new?timing=at_entry');
  await recordOpenMinimum(page, { symbol, direction: 'Long', risk: '100' });
  await recordOpenSave(page);
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
  const saved = await latestTrade(workspaceId);
  await page.goto(`/en/app/trades/close?trade=${saved.id}&scope=all`);
  await page.getByLabel('Final net P&L').fill('-25');
  await page.getByRole('button', { name: 'Close trade', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/en/app/trades/after-trade\\?trade=${saved.id}&from=close`),
    { timeout: 60_000 },
  );
  return saved.id;
}

async function chooseEmotion(page: Page, name: string) {
  await page.getByRole('button', { name: 'Edit post-trade emotion' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name, exact: true }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const closeDrafts = (page: Page) =>
  page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('tradechemist:close-draft:'))
      .map((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}')),
  );

test.describe('Stage 6 — After-Trade Context', () => {
  test.describe.configure({ retries: 0 });
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Viewports are set per test');
  });

  for (const [name, size] of [
    ['390px', PHONE],
    ['1440px', DESKTOP],
  ] as const) {
    test(`Final Close → Stage 6, surviving a reload → Save → Done, at ${name}`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      await page.setViewportSize(size);
      const { workspaceId } = await newUser(page, `stage6-${size.width}`);
      const tradeId = await closeATrade(page, workspaceId, 'XAUUSD');

      // The Trade is closed first; Stage 6 is optional enrichment.
      await expect(page.locator('[data-trade-closed]')).toContainText('Trade closed');
      expect(await latestTrade(workspaceId)).toMatchObject({
        status: 'closed',
        netPnlMinor: -2500n,
        afterTradeNote: null,
      });
      await expect(page.locator('#stage6-post-emotions')).toHaveAttribute(
        'data-post-trade-emotions',
        'unanswered',
      );
      await expectNoOverflow(page, `${name} stage 6`);

      await chooseEmotion(page, 'None of these');
      await page.getByLabel('After-trade note').fill('Exited on fear, again.');
      await page.getByLabel('TradingView link').fill(CHART);
      await expect
        .poll(async () => (await closeDrafts(page))[0]?.afterTradeContext?.answers?.note)
        .toBe('Exited on fear, again.');

      // A reload after the Final Close keeps the unsaved Stage 6 answers.
      await page.reload();
      await expect(page.getByLabel('After-trade note')).toHaveValue('Exited on fear, again.');
      await expect(page.getByLabel('TradingView link')).toHaveValue(CHART);
      await expect(page.locator('#stage6-post-emotions')).toHaveAttribute(
        'data-post-trade-emotions',
        'none',
      );

      await page.getByRole('button', { name: 'Save context' }).click();
      await expect(page.getByRole('heading', { name: 'Trade saved' })).toBeFocused({
        timeout: 60_000,
      });
      const row = await latestTrade(workspaceId);
      expect(row).toMatchObject({
        status: 'closed',
        netPnlMinor: -2500n,
        afterTradeNote: 'Exited on fear, again.',
        afterTradeTradingviewUrl: CHART,
        notes: null,
        tradingviewUrl: null,
      });
      expect(row.postTradeEmotionsRecordedAt).not.toBeNull();
      // Only Stage 6's draft data is cleared.
      expect((await closeDrafts(page)).length).toBe(0);

      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/en/app/trades\\?trade=${tradeId}$`), {
        timeout: 60_000,
      });
    });
  }

  test('Final Close → Stage 6 → Review Trade', async ({ page }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const { workspaceId } = await newUser(page, 'stage6-review');
    const tradeId = await closeATrade(page, workspaceId, 'EURUSD');
    await page.getByLabel('After-trade note').fill('Worth a look.');
    await page.getByRole('button', { name: 'Save context' }).click();
    await page.getByRole('button', { name: 'Review Trade' }).click();
    await expect(page).toHaveURL(new RegExp(`/en/app/trades\\?trade=${tradeId}&tab=review`), {
      timeout: 60_000,
    });
  });

  test('skip Stage 6, then add it later from the Trade, and edit it', async ({ page }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(DESKTOP);
    const { workspaceId } = await newUser(page, 'stage6-skip');
    const tradeId = await closeATrade(page, workspaceId, 'GBPUSD');

    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('heading', { name: 'Trade saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // The Trade stays validly Closed, with nothing sent for Stage 6.
    expect(await latestTrade(workspaceId)).toMatchObject({
      status: 'closed',
      afterTradeNote: null,
      postTradeEmotionsRecordedAt: null,
    });

    // Resume from the Trade.
    await page.goto(`/en/app/trades?trade=${tradeId}&tab=execution`);
    await page.getByRole('link', { name: 'Add after-trade context' }).click();
    await expect(page.locator('[data-trade-closed]')).toHaveCount(0);
    await page.getByLabel('After-trade note').fill('Added later.');
    await page.getByRole('button', { name: 'Save context' }).click();
    await expect(page.getByRole('heading', { name: 'Trade saved' })).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(async () => (await latestTrade(workspaceId)).afterTradeNote)
      .toBe('Added later.');

    // Edit what is recorded.
    await page.goto(`/en/app/trades?trade=${tradeId}&tab=execution`);
    await page.getByRole('link', { name: 'Edit after-trade context' }).click();
    await expect(page.getByLabel('After-trade note')).toHaveValue('Added later.');
    // A malformed link is blocked at the field, with its own message.
    await page.getByLabel('TradingView link').fill('https://example.com/chart');
    await page.getByRole('button', { name: 'Save context' }).click();
    await expect(page.getByLabel('TradingView link')).toBeFocused();
    await expect(page.getByText('Enter an HTTPS TradingView URL.')).toBeVisible();
    await page.getByLabel('TradingView link').fill('');
    await page.getByLabel('After-trade note').fill('');
    await page.getByRole('button', { name: 'Save context' }).click();
    await expect(page.getByRole('heading', { name: 'Trade saved' })).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await latestTrade(workspaceId)).afterTradeNote).toBeNull();
  });

  test('a Part exit never enters Stage 6', async ({ page }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const { workspaceId } = await newUser(page, 'stage6-part');
    await page.goto('/en/app/trades/new?timing=at_entry');
    await recordOpenMinimum(page, { symbol: 'USDJPY', direction: 'Short', risk: '50' });
    await recordOpenSave(page);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    const saved = await latestTrade(workspaceId);
    await page.goto(`/en/app/trades/close?trade=${saved.id}&scope=part`);
    await page.getByLabel('P&L for this exit').fill('10');
    await page.getByRole('button', { name: 'Record partial exit', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/en/app/trades\\?trade=${saved.id}&tab=execution`), {
      timeout: 60_000,
    });
    expect(page.url()).not.toContain('after-trade');
    // And the Stage 6 page itself refuses an Open Trade.
    await page.goto(`/en/app/trades/after-trade?trade=${saved.id}`);
    await expect(page.locator('[data-after-trade-blocked]')).toContainText(
      'After-trade context is added once the trade is closed.',
    );
  });

  for (const [name, size] of [
    ['390px', PHONE],
    ['1440px', DESKTOP],
  ] as const) {
    test(`Record Closed through every canonical stage, Stage 6 surviving a reload, at ${name}`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      await page.setViewportSize(size);
      const { workspaceId } = await newUser(page, `stage6-rc-${size.width}`);
      await page.goto('/en/app/trades/new?timing=after_trade');
      const form = page.locator('[data-after-trade-form]');
      const step = async (key: string) => {
        await page.locator(`[data-step-link="${key}"]:visible`).first().click();
        await expect(form).toHaveAttribute('data-after-trade-step', key);
      };

      // Stage 1 — Trade.
      await page.getByRole('button', { name: 'Edit Symbol' }).click();
      const symbolSheet = page.getByRole('dialog');
      await symbolSheet.getByRole('combobox', { name: 'Symbol' }).fill('NAS100');
      const add = symbolSheet.getByRole('button', { name: /^Add/ });
      if ((await add.count()) > 0) await add.click();
      await symbolSheet.getByRole('option', { name: /^NAS100/i }).click();
      await page.getByRole('button', { name: 'Edit Direction' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Long', exact: true }).click();
      // Stage 5 — Result.
      await step('result');
      await page.locator('#after-finalPnl').fill('120');
      // Stage 2 — Plan.
      await step('plan');
      await page.locator('[data-plan-row="risk"]').click();
      await page.getByRole('dialog').locator('#after-risk').fill('60');
      await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      // Stages 3–4 — Setup and Entry Context; Post-Trade Emotion is not here.
      await step('context');
      await expect(page.locator('[data-emotions-phase="postTradeEmotions"]')).toHaveCount(0);
      await page.getByLabel('Why this trade').fill('Breakout retest.');
      // Stage 6 — After-Trade Context, then Save.
      await step('after');
      await expect(page.getByRole('heading', { level: 2 })).toContainText('After-trade context');
      await chooseEmotion(page, 'Calm');
      await page.getByLabel('After-trade note').fill('Let it run to target.');
      await page.getByLabel('TradingView link').fill('https://example.com/not-tv');

      // A reload keeps the answers; the step shown is view state.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Object.keys(window.localStorage).filter((key) =>
                key.startsWith('tradechemist:recording-draft:'),
              ).length,
          ),
        )
        .toBe(1);
      await page.reload();
      await expect(form).toHaveAttribute('data-after-trade-step', 'trade');
      await step('after');
      await expect(page.getByLabel('After-trade note')).toHaveValue('Let it run to target.');
      await expect(page.getByLabel('TradingView link')).toHaveValue('https://example.com/not-tv');

      // A blocked Save lands on the after-trade link itself.
      await step('trade');
      await page.locator('#after-quick-save').click();
      await expect(form).toHaveAttribute('data-after-trade-step', 'after');
      await expect(page.getByLabel('TradingView link')).toBeFocused();
      await page.getByLabel('TradingView link').fill(CHART);
      await expectNoOverflow(page, `${name} record closed stage 6`);
      await page.locator('[data-global-save]:visible button[type="submit"]').first().click();
      await expect(
        page.locator('[data-after-trade-saved]').getByRole('heading', { name: 'Trade saved' }),
      ).toBeFocused({ timeout: 60_000 });

      const row = await latestTrade(workspaceId);
      expect(row).toMatchObject({
        status: 'closed',
        symbol: 'NAS100',
        netPnlMinor: 12000n,
        afterTradeNote: 'Let it run to target.',
        afterTradeTradingviewUrl: CHART,
        confirmationNotes: 'Breakout retest.',
        tradingviewUrl: null,
      });
      expect(row.postTradeEmotionsRecordedAt).not.toBeNull();
    });
  }
});
