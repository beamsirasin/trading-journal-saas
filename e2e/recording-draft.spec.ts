import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { trades, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * THE ADD TRADE RECORDING DRAFT, ON THE REAL ROUTE (contract §23, UX Rules §5).
 *
 * Every step is a trader action in a real browser against the real server:
 * typing, reloading, changing mode, going back, discarding, a Save whose
 * response never reaches the browser, and signing out. The database is read
 * only to judge how many Trades exist.
 */

const RECOVERED = 'We restored your unsaved trade draft from this browser.';
const DRAFT_KEY_PREFIX = 'tradechemist:recording-draft:';

async function withDb<T>(work: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    return await work(drizzle(client));
  } finally {
    await client.end();
  }
}

async function tradeRows(userId: string) {
  return withDb(async (db) => {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('workspace missing');
    return db
      .select({ id: trades.id, symbol: trades.symbol, mutationKey: trades.mutationKey })
      .from(trades)
      .where(eq(trades.workspaceId, workspace.id));
  });
}

async function newUser(page: Page, label: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `e2e-draft-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'E2E Draft Tester',
  });
  await loginAs(page, 'en', user);
  return user;
}

async function storedDrafts(page: Page): Promise<number> {
  return page.evaluate(
    (prefix) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)).length,
    DRAFT_KEY_PREFIX,
  );
}

async function chooseLong(page: Page) {
  // The radio is visually hidden; its label is what a trader clicks.
  const long = page.getByRole('radio', { name: 'Long', exact: true });
  const id = await long.getAttribute('id');
  await page.locator(`label[for="${id}"]`).click();
  await expect(long).toBeChecked();
}

async function fillAtEntry(page: Page, symbol = 'XAUUSD') {
  await page.goto('/en/app/trades/new?timing=at_entry');
  await page.getByRole('textbox', { name: 'Symbol' }).fill(symbol);
  await chooseLong(page);
  await page.getByLabel('Risk at entry').fill('100');
  await expect.poll(() => storedDrafts(page)).toBe(1);
}

async function discardFromForm(page: Page) {
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Add Trade Recording Draft', () => {
  test.describe.configure({ retries: 0 });
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Viewports are set per test');
  });

  for (const viewport of [
    { name: 'desktop', size: { width: 1440, height: 900 } },
    { name: 'mobile 390px', size: { width: 390, height: 844 } },
  ]) {
    test(`reload, mode change, Back and discard keep or destroy exactly what they say (${viewport.name})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport.size);
      const user = await newUser(page, viewport.size.width.toString());

      // Type → Draft, then a reload recovers it and says so.
      await fillAtEntry(page);
      await page.reload();
      await expect(page.getByText(RECOVERED)).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Symbol' })).toHaveValue('XAUUSD');
      await expect(page.getByLabel('Risk at entry')).toHaveValue('100');
      await expectNoHorizontalOverflow(page);

      // Changing mode is navigation: the choice names the kept draft.
      await page.getByRole('link', { name: 'Change' }).click();
      await expect(page).toHaveURL(/\/en\/app\/trades\/new$/);
      const resume = page.locator('[data-recording-draft-resume]');
      await expect(resume).toContainText('XAUUSD · last in At Entry');
      await expectNoHorizontalOverflow(page);

      /*
        After Trade opens the same draft: explicit shared values cross. Its
        Step 1 shows answers rather than inputs, so the rows are what a reader
        sees and what this reads — each carries the value it holds.
      */
      await page.goto('/en/app/trades/new?timing=after_trade');
      await expect(page.locator('[data-concept="symbol"]')).toHaveAttribute('data-value', 'XAUUSD');
      await expect(page.locator('[data-concept="direction"]')).toHaveAttribute(
        'data-value',
        'long',
      );
      await expect(page.locator('#after-risk')).toHaveValue('100');
      // At Entry's untouched "now" is not a remembered entry date or time.
      await expect(page.locator('[data-concept="enteredAt"]')).toHaveAttribute('data-value', '');
      await expect(page.locator('[data-concept="enteredAt"]')).toContainText('Not recorded');
      // After Trade says it as one compact row.
      await expect(page.locator('[data-recording-draft-status="recovered"]')).toContainText(
        'Draft restored',
      );

      // Browser Back returns to At Entry with its own section intact.
      await page.goto('/en/app/trades/new?timing=at_entry');
      await page.goto('/en/app/trades');
      await page.goBack();
      await expect(page.getByRole('textbox', { name: 'Symbol' })).toHaveValue('XAUUSD');
      await expect(page.getByLabel('Risk at entry')).toHaveValue('100');

      // The one destructive action, confirmed.
      await discardFromForm(page);
      await expect(page.getByRole('textbox', { name: 'Symbol' })).toHaveValue('');
      expect(await storedDrafts(page)).toBe(0);
      await page.reload();
      await expect(page.getByRole('textbox', { name: 'Symbol' })).toHaveValue('');
      await expect(page.getByText(RECOVERED)).toHaveCount(0);
      expect(await tradeRows(user.id)).toHaveLength(0);
    });
  }

  test('a Save whose answer is lost keeps the draft, and the retry creates exactly one Trade', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await newUser(page, 'save');
    await fillAtEntry(page, 'EURUSD');

    // The server receives and commits the first Save; its answer never
    // reaches the browser, which sees a network failure.
    let intercepted = 0;
    await page.route('**/en/app/trades/new**', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST' || request.headers()['next-action'] === undefined) {
        return route.fallback();
      }
      intercepted += 1;
      if (intercepted > 1) return route.fallback();
      await route.fetch();
      return route.abort('failed');
    });

    await page.getByRole('button', { name: 'Save open trade' }).first().click();
    await expect.poll(() => intercepted).toBe(1);
    await expect(page).toHaveURL(/\/en\/app\/trades\/new\?timing=at_entry/);
    await expect(page.getByText('Something went wrong', { exact: false }).first()).toBeVisible();
    expect(await storedDrafts(page)).toBe(1);
    const firstAttempt = await tradeRows(user.id);
    expect(firstAttempt).toHaveLength(1);

    // A reload still recovers the draft, and the retry is the same Save: an
    // honest replay, which says the Trade was already saved rather than
    // presenting a new Save (contract §23).
    await page.reload();
    await expect(page.getByText(RECOVERED)).toBeVisible();
    await page.getByRole('button', { name: 'Save open trade' }).first().click();
    await expect(page.getByRole('heading', { name: 'This trade was already saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Open trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);

    const rows = await tradeRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: 'EURUSD', mutationKey: firstAttempt[0]!.mutationKey });

    // Save → Persist: the draft is gone only now.
    expect(await storedDrafts(page)).toBe(0);
    await page.goto('/en/app/trades/new');
    await expect(page.locator('[data-recording-draft-resume]')).toHaveCount(0);
  });

  test('sign-out warns, naming the draft; staying keeps it; confirming removes it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await newUser(page, 'signout');
    await fillAtEntry(page, 'GBPJPY');

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    const warning = page.getByRole('alertdialog');
    await expect(warning).toContainText('GBPJPY');
    await warning.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
    expect(await storedDrafts(page)).toBe(1);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Sign out and remove' })
      .click();
    await expect(page).toHaveURL(/\/en\/login/);
    expect(await storedDrafts(page)).toBe(0);

    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades/new?timing=at_entry');
    await expect(page.getByRole('textbox', { name: 'Symbol' })).toHaveValue('');
    await expect(page.getByText(RECOVERED)).toHaveCount(0);
    expect(await tradeRows(user.id)).toHaveLength(0);
  });
});
