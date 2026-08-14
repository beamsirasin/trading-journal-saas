import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
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

async function seedFramework(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      workspaces,
      strategies,
      strategyVersions,
      strategyRules,
      setups,
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
    await db.insert(strategySetupVersions).values({
      workspaceId: workspace.id,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      name: 'Clean Retest',
      sortOrder: 0,
    });
  } finally {
    await client.end();
  }
}

async function createPlannedTrade(page: Page) {
  await page.getByRole('link', { name: 'Log a trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
  await expect(page.getByLabel('Setup')).toHaveValue(/.+/);
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
  await page.getByRole('button', { name: 'Long' }).click();
  await page.getByLabel('Entry').fill('100');
  await page.getByLabel('Stop').fill('90');
  await page.getByLabel(/Target/).fill('130');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Review the planned Trade' })).toBeVisible();
  await page.getByRole('button', { name: 'Create Trade' }).click();
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
}

/** Founder-UAT Trade Plan UX correction slice — a Money-only Plan (no Price fields at all). */
async function createMoneyOnlyPlannedTrade(page: Page) {
  await page.getByRole('link', { name: 'Log a trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
  await expect(page.getByLabel('Setup')).toHaveValue(/.+/);
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('textbox', { name: 'Symbol' }).fill('EURUSD');
  await page.getByRole('button', { name: 'Short' }).click();
  await page.getByRole('button', { name: 'Add a Money plan' }).click();
  await page.getByLabel('Planned risk').fill('100.00');
  await page.getByLabel(/Planned reward/).fill('300.00');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Review the planned Trade' })).toBeVisible();
  await page.getByRole('button', { name: 'Create Trade' }).click();
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
}

async function completeTradeLifecycle(page: Page) {
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
  await expect(page.getByText('E2E lifecycle note')).toBeVisible();

  await page.getByRole('button', { name: 'Open Trade' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Initial risk').fill('100.00');
  await dialog.getByRole('button', { name: 'Open Trade' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText('Open', { exact: true }).last()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Close Trade' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Exit', { exact: true }).fill('110');
  await dialog.getByLabel('Net P&L').fill('-100.00');
  await dialog.getByLabel('Commission').fill('5.00');
  await dialog.getByRole('button', { name: 'Close Trade' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  const detail = page.getByRole('article', { name: 'XAUUSD' });
  await expect(detail.getByText('-1.00R')).toBeVisible();

  await page.getByRole('button', { name: 'Resolve System result' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('System exit price').fill('120');
  await dialog.getByRole('button', { name: 'Confirm resolved result' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText('Resolved', { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  await expect(detail.getByText('-1.00R')).toBeVisible();
  await expect(detail.getByText('+2.00R')).toBeVisible();
  await expect(detail.getByText('Loss', { exact: true })).toBeVisible();
  await expect(detail.getByText('Win', { exact: true })).toBeVisible();
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
    await createPlannedTrade(page);
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await expect(page.getByText('Long').first()).toBeVisible();
    await expect(page.getByText('Golden Breakout').last()).toBeVisible();
    await expect(page.getByText('Clean Retest').last()).toBeVisible();
    await expect(page.getByText('+3.00R')).toBeVisible();
    await expect(page.getByText('Planned').last()).toBeVisible();
    await expect(page.getByText('Pending').last()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await expect(page.getByText('+3.00R')).toBeVisible();
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
    await createMoneyOnlyPlannedTrade(page);
    await expect(page.getByRole('heading', { name: 'EURUSD' })).toBeVisible();
    await expect(page.getByText('Short').first()).toBeVisible();
    // A Money-only Trade never fabricates Price fields — Entry is truthfully absent.
    await expect(page.getByText('Entry', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Planned risk')).toBeVisible();
    await expect(page.getByText('Planned reward')).toBeVisible();
    await expect(page.getByText('+3.00R')).toBeVisible();
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
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
    await page.getByRole('button', { name: 'Long' }).click();
    await page.getByLabel('Entry').fill('100');
    await page.getByLabel('Stop').fill('90');
    await page.getByLabel(/Target/).fill('130'); // Price implies +3R
    await page.getByRole('button', { name: 'Add a Money plan' }).click();
    await page.getByLabel('Planned risk').fill('50.00');
    await page.getByLabel(/Planned reward/).fill('500.00'); // Money implies +10R

    await expect(page.getByText('Price and Money plans disagree')).toBeVisible();
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(
      page.getByText('Price and Money plans disagree — adjust one before continuing.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review the planned Trade' })).toHaveCount(0);

    // Resolve the disagreement — Money now agrees with Price (+3R) — and proceed.
    await page.getByLabel(/Planned reward/).fill('150.00');
    await expect(page.getByText('Price and Money plans disagree')).toHaveCount(0);
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Review the planned Trade' })).toBeVisible();
    await page.getByRole('button', { name: 'Create Trade' }).click();
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

      // Stepper usable: every step control renders within the viewport.
      const stepper = page.getByRole('list', { name: 'Trade creation progress' });
      await expect(stepper).toBeVisible();
      const stepperBox = await stepper.boundingBox();
      expect(stepperBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
      await expect(page.getByLabel('Setup')).toHaveValue(/.+/);
      await page.getByRole('button', { name: /Continue/ }).click();

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

      // Price/Money disclosure does not overflow — opening the Money
      // section (Price is open by default) stays within the viewport.
      await page.getByRole('button', { name: 'Add a Money plan' }).click();
      const moneyHeading = page.getByRole('heading', { name: 'Money / Risk & Reward' });
      await expect(moneyHeading).toBeVisible();
      const moneySectionBox = await moneyHeading.locator('..').locator('..').boundingBox();
      expect(moneySectionBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);

      // Confidence slider remains usable: focusable, keyboard-operable, and
      // its value genuinely changes.
      const slider = page.getByRole('slider', { name: 'Confidence' });
      await expect(slider).toBeVisible();
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await expect(slider).not.toHaveAttribute('aria-valuenow', '50');

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
    await page.setViewportSize({ width: 320, height: 800 });
    await loginAs(page, 'en', user);
    await page.goto('/en/app/trades');
    await createPlannedTrade(page);
    await expect(page.getByRole('heading', { name: 'XAUUSD' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Trade' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width ?? 999).toBeLessThanOrEqual(320);
    await dialog.getByLabel('Initial risk').fill('100.00');
    await dialog.getByRole('button', { name: 'Open Trade' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Open', { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: 'Close Trade' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Exit', { exact: true }).fill('110');
    await dialog.getByLabel('Net P&L').fill('100.00');
    await dialog.getByRole('button', { name: 'Close Trade' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Closed', { exact: true }).last()).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const back = await page.getByRole('link', { name: 'Back to trades' }).first().boundingBox();
    expect(back?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
