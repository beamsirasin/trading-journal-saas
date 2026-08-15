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
  tradeSetupConditionChecks,
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

async function createPlannedTrade(page: Page) {
  await page.getByRole('link', { name: 'Log a trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
  await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
  await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);
  await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
  await page.getByRole('button', { name: 'Long' }).click();
  await page.getByLabel('Entry', { exact: true }).fill('100');
  await page.getByLabel('Stop').fill('90');
  await page.getByLabel(/Target/).fill('130');
  await page.getByLabel('Breakout candle closed').check();
  await page.getByLabel('Retest held').check();
  await page.getByLabel('Volume expanded').check();
  await page.getByLabel('Invalidation is clear').check();
  await page.getByLabel('Session is aligned').check();
  await page.getByRole('button', { name: 'Save Trade' }).click();
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
}

/** Founder-UAT Trade Plan UX correction slice — a Money-only Plan (no Price fields at all). */
async function createMoneyOnlyPlannedTrade(page: Page) {
  await page.getByRole('link', { name: 'Log a trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\/new/);
  await page.getByLabel('Strategy').selectOption({ label: 'Golden Breakout · Version 1' });
  await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(/.+/);
  await page.getByRole('textbox', { name: 'Symbol' }).fill('EURUSD');
  await page.getByRole('button', { name: 'Short' }).click();
  await page.getByRole('button', { name: 'Add a Money plan' }).click();
  await page.getByLabel('Planned risk').fill('100.00');
  await page.getByLabel(/Planned reward/).fill('300.00');
  await page.getByLabel('Breakout candle closed').check();
  await page.getByLabel('Retest held').check();
  await page.getByLabel('Volume expanded').check();
  await page.getByLabel('Invalidation is clear').check();
  await page.getByLabel('Session is aligned').check();
  await page.getByRole('button', { name: 'Save Trade' }).click();
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
    await page.getByLabel('Stop').fill('1.24');
    await page.getByLabel('Breakout candle closed').check();
    await page.getByLabel('Retest held').check();
    await page.getByLabel('Volume expanded').check();
    await expect(page.getByText('3/5 met · 60%')).toBeVisible();
    await page.locator('[data-slot="confidence-option"][data-step="75"]').click();
    await page.getByLabel('Entry Reason').fill('Breakout confirmed on the retest.');
    await page.getByRole('button', { name: 'Save Trade' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(/3 of 5 Conditions are met \(60%\)/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save Trade' }).click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
    const tradeId = new URL(page.url()).searchParams.get('trade');
    if (tradeId === null) throw new Error('created Trade ID missing from URL');
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
    await page.getByLabel('Stop').fill('149');
    await page.getByRole('button', { name: 'Save Trade' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
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
    await page.getByLabel('Stop').fill('90');
    await page.getByLabel(/Target/).fill('130'); // Price implies +3R
    await page.getByRole('button', { name: 'Add a Money plan' }).click();
    await page.getByLabel('Planned risk').fill('50.00');
    await page.getByLabel(/Planned reward/).fill('500.00'); // Money implies +10R

    await expect(page.getByText('Price and Money plans disagree')).toBeVisible();
    await page.getByRole('button', { name: 'Save Trade' }).click();
    await expect(
      page.getByText('Price and Money plans disagree — adjust one before continuing.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/en\/app\/trades\/new/);

    // Resolve the disagreement — Money now agrees with Price (+3R) — and proceed.
    await page.getByLabel(/Planned reward/).fill('150.00');
    await expect(page.getByText('Price and Money plans disagree')).toHaveCount(0);
    await page.getByLabel('Breakout candle closed').check();
    await page.getByLabel('Retest held').check();
    await page.getByLabel('Volume expanded').check();
    await page.getByLabel('Invalidation is clear').check();
    await page.getByLabel('Session is aligned').check();
    await page.getByRole('button', { name: 'Save Trade' }).click();
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

  /** Moves a held pill to an absolute viewport X via enough intermediate events for Motion to recognize a pan. */
  async function beginPillDragTo(page: Page, toX: number) {
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
