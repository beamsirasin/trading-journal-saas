import { expect, test, type Browser, type Page } from '@playwright/test';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { savedSymbols, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * SAVED SYMBOLS SURVIVE A CHANGE OF BROWSER.
 *
 * The one property the move to the server exists for, and one a single
 * browser cannot prove: a library built in one browser context is there in
 * another that shares nothing with it — no `localStorage`, no cookies, no
 * cache — and an old list still held in a browser is moved to the server once
 * and then no longer read from there.
 */
const ROUTE = '/en/app/trades/new?timing=after_trade';

test.describe('Saved Symbols', () => {
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

  test('are the same library in a second browser', async ({ browser }) => {
    test.skip(test.info().project.name !== 'chromium', 'One engine is enough.');
    test.setTimeout(240_000);
    const user = await newUser('saved-symbols-devices');

    // Browser one: build the library.
    const first = await signedInPage(browser, user);
    await openPicker(first);
    for (const symbol of ['US30.cash', 'XAUUSD.m', 'GER40']) {
      await first.getByRole('combobox', { name: 'Symbol' }).fill(symbol);
      await first.getByRole('dialog').getByRole('button', { name: /^Add/ }).click();
      await expect(
        first.getByRole('dialog').locator(`[data-symbol-option="${symbol}"]`),
      ).toBeVisible();
    }
    /*
      THE SERVER IS WHAT THIS TEST IS ABOUT, so it waits on the server. Add and
      remove update the picker at once and write in the background; a check on
      the picker alone passes before the write lands, and a second browser
      opened in that window reads the library as it was — measured: straight
      after three quick adds the table was still empty, and a moment later it
      held all three. So each hop between browsers waits for the row itself.
    */
    await expect
      .poll(() => serverLibrary(user.workspaceId))
      .toEqual(['GER40', 'XAUUSD.m', 'US30.cash']);
    // Nothing of it is kept in this browser.
    expect(await savedInBrowser(first, user.workspaceId)).toEqual([]);

    // Browser two: nothing shared but the account.
    const second = await signedInPage(browser, user);
    await openPicker(second);
    await expect(second.getByRole('dialog').getByRole('option')).toHaveCount(3);
    expect(
      await second
        .getByRole('dialog')
        .getByRole('option')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-symbol-option'))),
    ).toEqual(['GER40', 'XAUUSD.m', 'US30.cash']);

    // Removing it here removes it there.
    await second
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove XAUUSD.m from saved symbols' })
      .click();
    await expect(second.getByRole('dialog').getByRole('option')).toHaveCount(2);
    await expect.poll(() => serverLibrary(user.workspaceId)).toEqual(['GER40', 'US30.cash']);
    await first.reload();
    await openPicker(first);
    await expect(first.getByRole('dialog').locator('[data-symbol-option="XAUUSD.m"]')).toHaveCount(
      0,
    );

    await first.context().close();
    await second.context().close();
  });

  test('moves a library a browser still holds to the server, once', async ({ browser }) => {
    test.skip(test.info().project.name !== 'chromium', 'One engine is enough.');
    test.setTimeout(240_000);
    const user = await newUser('saved-symbols-move');

    // A browser holding the old store, as it would have before this change.
    const legacy = await signedInPage(browser, user, (workspaceId) => ({
      [`tradingos.trade-plan.symbol.v1.${workspaceId}`]: JSON.stringify({
        favorites: ['BTCUSD', 'btcusd', 'GER40'],
        recents: ['EURUSD'],
      }),
    }));
    await openPicker(legacy);
    await expect(legacy.getByRole('dialog').getByRole('option')).toHaveCount(2);
    // One row per symbol whatever its case; the newest browser spelling kept.
    await expect.poll(() => serverLibrary(user.workspaceId)).toEqual(['BTCUSD', 'GER40']);
    // Moved, not copied: the browser keeps only what At Entry still reads.
    await expect.poll(() => savedInBrowser(legacy, user.workspaceId)).toEqual([]);

    // And a clean browser now sees the same library, from the server.
    const clean = await signedInPage(browser, user);
    await openPicker(clean);
    await expect(clean.getByRole('dialog').getByRole('option')).toHaveCount(2);

    await legacy.context().close();
    await clean.context().close();
  });
});

type TestUser = Awaited<ReturnType<typeof provisionVerifiedUser>> & { workspaceId: string };

/** What the server holds for this workspace, newest first — the thing under test. */
async function serverLibrary(workspaceId: string): Promise<string[]> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    const rows = await drizzle(client, { schema: { savedSymbols } })
      .select({ symbol: savedSymbols.symbol })
      .from(savedSymbols)
      .where(eq(savedSymbols.workspaceId, workspaceId))
      .orderBy(desc(savedSymbols.createdAt), desc(savedSymbols.id));
    return rows.map((row) => row.symbol);
  } finally {
    await client.end();
  }
}

/** A verified user, and the personal workspace their session will be scoped to. */
async function newUser(prefix: string): Promise<TestUser> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}@example.test`,
    password: 'Correct-Horse9!',
    name: 'Saved Symbols',
  });
  const client = postgres(testUrl, { max: 1 });
  try {
    const [workspace] = await drizzle(client, { schema: { workspaces } })
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, user.id));
    if (workspace === undefined) throw new Error('saved-symbols: workspace missing');
    return { ...user, workspaceId: workspace.id };
  } finally {
    await client.end();
  }
}

/** A fresh browser context: its own storage, its own cookies, nothing shared. */
async function signedInPage(
  browser: Browser,
  user: TestUser,
  seed?: (workspaceId: string) => Record<string, string>,
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await loginAs(page, 'en', user);
  await page.goto(ROUTE);
  await expect(page.locator('[data-after-trade-form]')).toBeVisible();
  if (seed !== undefined) {
    // Seed the old store, then reload so the page meets it on first load.
    await page.evaluate((entries) => {
      for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    }, seed(user.workspaceId));
    await page.reload();
    await expect(page.locator('[data-after-trade-form]')).toBeVisible();
  }
  return page;
}

async function savedInBrowser(page: Page, workspaceId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const raw = window.localStorage.getItem(`tradingos.trade-plan.symbol.v1.${id}`);
    return raw === null ? [] : ((JSON.parse(raw) as { favorites?: string[] }).favorites ?? []);
  }, workspaceId);
}

async function openPicker(page: Page) {
  await page.locator('[data-step-link="trade"]').click();
  await page.getByRole('button', { name: 'Edit Symbol' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
