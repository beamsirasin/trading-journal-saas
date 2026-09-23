import { expect, test, type Page } from '@playwright/test';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  exitPlans,
  setupConditions,
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  trades,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { chooseInEditor } from './support/plan-rows';
import { provisionVerifiedUser } from './support/provision-user';
import {
  closePlanEditor,
  openExitPlanRow,
  openPlanRow,
  planRow,
  recordOpenClassify,
  recordOpenConcept,
  recordOpenDirection,
  recordOpenMinimum,
  recordOpenNoDefinedRisk,
  recordOpenPriceLevels,
  recordOpenRisk,
  recordOpenSave,
  recordOpenStep,
  recordOpenSymbol,
} from './support/record-open';

/**
 * RECORD OPEN — targeted real-browser verification of the canonical stages
 * 1 → 2 → 3 → 4 (UX Rules §20.4) on the real `/app/trades/new?timing=at_entry`
 * route, at 390px and 1440px on Chromium. Behaviour, not a screenshot corpus.
 */
const ROUTE = '/en/app/trades/new?timing=at_entry';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 1000 };

const GOLDEN = 'Golden Breakout';
const RETEST = 'Clean Retest';
const RANGE = 'Range Fade';
const REVERT = 'Mean Revert';

interface Seeded {
  readonly workspaceId: string;
  readonly goldenId: string;
  readonly retestId: string;
}

function withDb<T>(run: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client);
  return run(db).finally(() => client.end());
}

/** Two Strategies, each with a Setup and a default Exit Plan; Golden's Setup has two Conditions. */
async function seed(userId: string): Promise<Seeded> {
  return withDb(async (db) => {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Record Open workspace missing');
    const make = async (name: string, setupName: string, plan: [string, string]) => {
      const [strategy] = await db
        .insert(strategies)
        .values({ workspaceId: workspace.id })
        .returning({ id: strategies.id });
      const [version] = await db
        .insert(strategyVersions)
        .values({ workspaceId: workspace.id, strategyId: strategy!.id, versionNumber: 1, name })
        .returning({ id: strategyVersions.id });
      await db
        .update(strategies)
        .set({ currentVersionId: version!.id })
        .where(eq(strategies.id, strategy!.id));
      const [setup] = await db
        .insert(setups)
        .values({ workspaceId: workspace.id, strategyId: strategy!.id })
        .returning({ id: setups.id });
      const [setupVersion] = await db
        .insert(strategySetupVersions)
        .values({
          workspaceId: workspace.id,
          strategyVersionId: version!.id,
          strategyId: strategy!.id,
          setupId: setup!.id,
          name: setupName,
          sortOrder: 0,
        })
        .returning({ id: strategySetupVersions.id });
      await db.insert(exitPlans).values({
        workspaceId: workspace.id,
        strategyId: strategy!.id,
        name: plan[0],
        instructions: plan[1],
      });
      return { strategyId: strategy!.id, setupId: setup!.id, setupVersionId: setupVersion!.id };
    };
    const golden = await make(GOLDEN, RETEST, ['Scale out', 'Half at 1R, trail the rest.']);
    await make(RANGE, REVERT, ['Fade to mean', 'Close at the range midpoint.']);
    await db.insert(setupConditions).values(
      ['Breakout candle closed', 'Retest held'].map((label, sortOrder) => ({
        workspaceId: workspace.id,
        setupId: golden.setupId,
        setupVersionId: golden.setupVersionId,
        label,
        sortOrder,
      })),
    );
    return { workspaceId: workspace.id, goldenId: golden.strategyId, retestId: golden.setupId };
  });
}

async function newUser(page: Page, prefix: string): Promise<{ id: string } & Seeded> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'E2E Record Open',
  });
  const seeded = await seed(user.id);
  await loginAs(page, 'en', user);
  return { id: user.id, ...seeded };
}

async function latestTrade(workspaceId: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(trades)
      .where(eq(trades.workspaceId, workspaceId))
      .orderBy(desc(trades.createdAt))
      .limit(1);
    return row;
  });
}

async function tradeCount(workspaceId: string) {
  return withDb(async (db) => {
    const rows = await db
      .select({ id: trades.id })
      .from(trades)
      .where(eq(trades.workspaceId, workspaceId));
    return rows.length;
  });
}

function currentStep(page: Page) {
  return page.locator('[data-record-open-form]');
}

async function expectStep(page: Page, step: string) {
  await expect(currentStep(page)).toHaveAttribute('data-record-open-step', step);
}

async function expectNoOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${where}: horizontal overflow ${overflow}px`).toBeLessThanOrEqual(0);
}

/** A recorded-answer choice is a native radio behind its label; click the label. */
async function chooseChoice(page: Page, name: RegExp | string) {
  const radio = page.getByRole('radio', { name, exact: typeof name === 'string' });
  const id = await radio.getAttribute('id');
  if (id === null) throw new Error(`choice ${String(name)} has no id`);
  await page.locator(`label[for="${id}"]`).click();
  await expect(radio).toBeChecked();
}

async function answerCondition(page: Page, label: string, answer: 'Met' | 'Not met') {
  const group = page.getByRole('group', { name: new RegExp(label) });
  const radio = group.getByRole('radio', { name: answer, exact: true });
  const id = await radio.getAttribute('id');
  await group.locator(`label[for="${id}"]`).click();
  await expect(radio).toBeChecked();
}

/** The draft is written as the trader types; wait for it before a reload. */
async function waitForDraft(page: Page) {
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
}

function entryRow(page: Page) {
  return recordOpenConcept(page, 'enteredAt');
}

/** The source At Entry's entry time holds, as the row exposes it. */
function entrySource(page: Page) {
  return entryRow(page).locator('xpath=..');
}

test.describe('Record Open — canonical stages 1–4 in a real browser', () => {
  test.describe.configure({ retries: 0 });
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Viewports are set per test');
  });

  for (const [name, size] of [
    ['390px', PHONE],
    ['1440px', DESKTOP],
  ] as const) {
    test(`1 · complete path, frame and overlays at ${name}`, async ({ page }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      await page.setViewportSize(size);
      const user = await newUser(page, `ro-complete-${size.width}`);
      await page.goto(ROUTE);

      // The frame: progress, the step heading, and one forward action.
      await expectStep(page, 'trade');
      await expect(page.locator('[data-step-progress]:visible').first()).toHaveText('Step 1 of 4');
      await expect(page.getByRole('heading', { level: 2, name: 'Trade details' })).toBeVisible();
      if (size.width < 1024) {
        await expect(page.locator('[data-action-bar="docked"]')).toBeVisible();
        await expect(page.locator('[data-step-link]:visible')).toHaveCount(4);
      } else {
        await expect(page.locator('aside [data-step-link]')).toHaveCount(4);
        await expect(page.locator('[data-required-status]')).toHaveAttribute(
          'data-required-status',
          'missing',
        );
      }
      await expectNoOverflow(page, `${name} step 1`);

      // Overlays: the Symbol editor opens inside the viewport, Escape closes it
      // without an answer, and focus returns to the row that opened it.
      await recordOpenConcept(page, 'symbol').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(recordOpenConcept(page, 'symbol')).toBeFocused();
      await expect(recordOpenConcept(page, 'symbol')).toHaveAttribute('data-value', '');

      await recordOpenSymbol(page, 'XAUUSD');
      await recordOpenDirection(page, 'Long');

      // 2 — Plan & Risk.
      await page.getByRole('button', { name: 'Next: Plan & risk' }).click();
      await expectStep(page, 'plan');
      await expect(page.locator('[data-step-progress]:visible').first()).toHaveText('Step 2 of 4');
      const riskEditor = await openPlanRow(page, 'risk');
      await chooseInEditor(riskEditor, /^Defined risk/);
      await riskEditor.locator('#entry-risk').fill('100');
      await closePlanEditor(page);
      // Plan & Risk reads the plan: the 1R amount, and nothing about execution.
      await expect(planRow(page, 'risk')).toContainText('100 USD');
      await expect(planRow(page, 'risk')).not.toContainText(/actual risk/i);
      const targetEditor = await openPlanRow(page, 'target');
      await chooseChoice(page, /^Fixed target/);
      await targetEditor.locator('#entry-target-profit').fill('300');
      await expect(targetEditor.getByText('Reaching your target would be +3.00R.')).toBeVisible();
      await closePlanEditor(page);
      const priceEditor = await recordOpenPriceLevels(page);
      await priceEditor.locator('#entry-context-entry-price').fill('2400');
      await closePlanEditor(page);
      await expect(page.locator('#entry-quick-save')).toBeInViewport();
      await expectNoOverflow(page, `${name} step 2`);

      // 3 — Setup & Checklist.
      await recordOpenClassify(page, GOLDEN, RETEST);
      await answerCondition(page, 'Breakout candle closed', 'Met');
      await expect(
        page.locator('section[data-step="setup"]').getByText('1 of 2 conditions answered'),
      ).toBeVisible();
      await expectNoOverflow(page, `${name} step 3`);

      // 4 — Entry Context & Evidence.
      await recordOpenStep(page, 'context');
      await chooseChoice(page, 'High');
      await page.locator('#entry-entry-emotions').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Focused' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('#entry-entry-emotions')).toContainText('Focused');
      await page.getByLabel('Why this trade').fill('Clean retest of the breakout level.');
      await page.getByLabel('Timeframe').fill('15m');
      await page.getByLabel('Chart link').fill('https://www.tradingview.com/x/abc12345/');
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Save open trade', exact: true }),
      ).toBeVisible();
      await expectNoOverflow(page, `${name} step 4`);

      await recordOpenSave(page);
      await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
      const row = await latestTrade(user.workspaceId);
      expect(row).toMatchObject({
        symbol: 'XAUUSD',
        direction: 'long',
        plannedRiskMinor: 10000n,
        strategyId: user.goldenId,
        setupId: user.retestId,
        timeframe: '15m',
        tradingviewUrl: 'https://www.tradingview.com/x/abc12345/',
        exitPlanProvenance: 'strategy_default',
        enteredAtSource: 'default_now',
      });
    });
  }

  test('2 · minimum save from Step 2 with Save now, at 390px', async ({ page }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const user = await newUser(page, 'ro-minimum');
    await page.goto(ROUTE);
    // Step 1 cannot hold the whole minimum, so it offers no Save.
    await expect(page.getByRole('button', { name: 'Save open trade' })).toHaveCount(0);
    await recordOpenMinimum(page, { symbol: 'EURUSD', direction: 'Short', risk: '50' });
    const quick = page.locator('#entry-quick-save');
    await expect(quick).toBeInViewport();
    await quick.click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    const row = await latestTrade(user.workspaceId);
    expect(row).toMatchObject({
      symbol: 'EURUSD',
      direction: 'short',
      plannedRiskMinor: 5000n,
      strategyId: null,
      noStrategy: false,
      timeframe: null,
    });
  });

  // Decision 54: an explicit No Defined Risk is a complete risk decision. The
  // Save must reach the database and be accepted there, with and without a
  // remembered Fixed Target — every layer in between once refused one of them.
  for (const target of [null, '300'] as const) {
    test(`2b · No Defined Risk saves${target === null ? '' : ' with a Fixed Target'}, at 390px`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      page.setDefaultTimeout(15_000);
      await page.setViewportSize(PHONE);
      const user = await newUser(page, target === null ? 'ro-no-risk' : 'ro-no-risk-tp');
      await page.goto(ROUTE);
      await recordOpenSymbol(page, 'EURUSD');
      await recordOpenDirection(page, 'Long');
      await recordOpenNoDefinedRisk(page);
      if (target !== null) {
        const editor = await openPlanRow(page, 'target');
        await chooseInEditor(editor, /^Fixed target/);
        await editor.locator('#entry-target-profit').fill(target);
        await closePlanEditor(page);
      }
      await recordOpenStep(page, 'context');
      await expect(page.locator('#entry-actual-risk-row')).toHaveAttribute(
        'data-actual-risk-summary',
        'not_applicable',
      );
      await recordOpenSave(page);
      await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
      expect(await latestTrade(user.workspaceId)).toMatchObject({
        status: 'open',
        actualResultMode: 'money',
        plannedRiskState: 'no_defined',
        plannedRiskMinor: null,
        actualRiskAnswer: null,
        plannedRewardMinor: target === null ? null : 30000n,
        targetState: target === null ? null : 'fixed',
      });
    });
  }

  test('3 · Back/Next keep every answer; a reload restores the draft from Step 1', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    await newUser(page, 'ro-navigation');
    await page.goto(ROUTE);
    await recordOpenMinimum(page, { symbol: 'GBPJPY', direction: 'Long', risk: '75' });
    await recordOpenClassify(page, GOLDEN, RETEST);
    await answerCondition(page, 'Retest held', 'Not met');
    await recordOpenStep(page, 'context');
    await page.getByLabel('Why this trade').fill('Pullback into value.');

    for (let index = 0; index < 3; index += 1) {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await expectStep(page, 'trade');
    await expect(recordOpenConcept(page, 'symbol')).toHaveAttribute('data-value', 'GBPJPY');
    for (const next of ['Next: Plan & risk', 'Next: Setup', 'Next: Context']) {
      await page.getByRole('button', { name: next }).click();
    }
    await expectStep(page, 'context');
    await expect(page.getByLabel('Why this trade')).toHaveValue('Pullback into value.');
    await expect(planRow(page, 'risk')).toContainText('75');
    await recordOpenStep(page, 'setup');
    await expect(page.locator('#entry-strategy')).toContainText(GOLDEN);

    await waitForDraft(page);
    await page.reload();
    await expect(page.locator('[data-recording-draft-status="recovered"]')).toContainText(
      'Draft restored',
    );
    await expectStep(page, 'trade');
    await expect(recordOpenConcept(page, 'symbol')).toHaveAttribute('data-value', 'GBPJPY');
    await expect(recordOpenConcept(page, 'direction')).toHaveAttribute('data-value', 'long');
    await recordOpenStep(page, 'plan');
    await expect(planRow(page, 'risk')).toContainText('75');
    await recordOpenStep(page, 'setup');
    await expect(page.locator('#entry-setup')).toContainText(RETEST);
    const retest = page.getByRole('group', { name: /Retest held/ });
    await expect(retest.getByRole('radio', { name: 'Not met', exact: true })).toBeChecked();
    await recordOpenStep(page, 'context');
    await expect(page.getByLabel('Why this trade')).toHaveValue('Pullback into value.');
  });

  test('4 · entry date and time keep At Entry’s "now", its states and its Save rules', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const user = await newUser(page, 'ro-entry-time');
    await page.goto(ROUTE);

    // Initial: a visible "now" default, one complete stamp.
    await expect(entrySource(page)).toHaveAttribute('data-entry-source', 'default_now');
    await expect(entryRow(page)).toContainText('Set automatically to now');
    await expect(entryRow(page)).toHaveAttribute('data-value', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    // Opening and closing — by Done or Escape — confirms nothing.
    await entryRow(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(entrySource(page)).toHaveAttribute('data-entry-source', 'default_now');
    await entryRow(page).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(entrySource(page)).toHaveAttribute('data-entry-source', 'default_now');

    // This time is right: the default becomes the trader's answer.
    await entryRow(page).click();
    let sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Clear date' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'This time is right' }).click();
    await expect(entrySource(page)).toHaveAttribute('data-entry-source', 'trader');
    await expect(entryRow(page)).not.toContainText('Set automatically to now');

    // Clear, then only a date: incomplete, and Save asks for the time.
    await sheet.getByRole('button', { name: 'Clear entry date & time' }).click();
    await expect(entrySource(page)).toHaveAttribute('data-entry-source', 'cleared');
    await expect(entryRow(page)).toContainText('Not set');
    await sheet.locator('#entry-entry-date').click();
    await sheet
      .locator('[data-entry-date-picker] [data-range-date]:not([disabled])')
      .first()
      .click();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(entryRow(page)).toHaveAttribute('data-value', /^\d{4}-\d{2}-\d{2}$/);
    await expect(entryRow(page)).toContainText('Time not recorded');

    await recordOpenMinimum(page, { symbol: 'AUDUSD', direction: 'Long', risk: '40' });
    await page.locator('#entry-quick-save').click();
    await expectStep(page, 'trade');
    await expect(entryRow(page)).toBeFocused();
    await expect(
      page.getByText('Add the time to finish this entry, or clear the date.'),
    ).toBeVisible();
    expect(await tradeCount(user.workspaceId)).toBe(0);

    // Clear, then only a time: incomplete the other way, and Save asks for the date.
    await entryRow(page).click();
    sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Clear entry date & time' }).click();
    await sheet.locator('#entry-entry-time').click();
    await sheet.locator('#entry-enteredTime-hour [data-wheel-value="09"]').click();
    await sheet.locator('#entry-enteredTime-minute [data-wheel-value="30"]').click();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(entryRow(page)).toHaveAttribute('data-value', 'T09:30');
    await expect(entryRow(page)).toContainText('Date not recorded');
    await recordOpenStep(page, 'plan');
    await page.locator('#entry-quick-save').click();
    await expectStep(page, 'trade');
    await expect(
      page.getByText('Add the date to finish this entry, or clear the time.'),
    ).toBeVisible();
    expect(await tradeCount(user.workspaceId)).toBe(0);

    // Use now: back on the clock, as a default again — and it saves.
    await entryRow(page).click();
    sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Clear entry date & time' }).click();
    await sheet.getByRole('button', { name: 'Use now' }).click();
    await expect(entrySource(page)).toHaveAttribute('data-entry-source', 'default_now');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await recordOpenStep(page, 'plan');
    await page.locator('#entry-quick-save').click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    expect(await latestTrade(user.workspaceId)).toMatchObject({ enteredAtSource: 'default_now' });
  });

  test('5 · Exit Plan inheritance follows the Strategy until explicitly overridden', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(DESKTOP);
    const user = await newUser(page, 'ro-inherit');
    await page.goto(ROUTE);
    await recordOpenMinimum(page, { symbol: 'XAUUSD', direction: 'Long', risk: '100' });
    const state = page.locator('[data-exit-plan-row]');
    await expect(state).toHaveAttribute('data-exit-plan-row', 'not_recorded');

    // Inherited, and announced where the Strategy is chosen.
    await recordOpenClassify(page, GOLDEN);
    await expect(
      page.getByText(
        'Golden Breakout currently supplies the exit plan “Scale out” unless you change it.',
      ),
    ).toBeVisible();
    await recordOpenStep(page, 'plan');
    await expect(state).toHaveAttribute('data-exit-plan-row', 'inherited');
    // The provenance is readable on the row, without opening anything.
    await expect(state).toContainText('From Strategy: Golden Breakout');

    // A Strategy change follows while still inherited.
    await recordOpenClassify(page, RANGE);
    await expect(
      page.getByText(
        'Range Fade currently supplies the exit plan “Fade to mean” unless you change it.',
      ),
    ).toBeVisible();
    await recordOpenStep(page, 'plan');
    await expect(state).toContainText('From Strategy: Range Fade');

    // An explicit override stops the following.
    await openExitPlanRow(page);
    await page.getByRole('button', { name: 'Choose another' }).click();
    const editor = page.getByRole('dialog', { name: 'Exit plan' });
    await editor.locator('label', { hasText: 'No defined exit rule' }).click();
    await editor.getByRole('button', { name: 'Done' }).click();
    await expect(state).toHaveAttribute('data-exit-plan-row', 'no_rule');
    await closePlanEditor(page);
    await recordOpenClassify(page, GOLDEN);
    await expect(page.getByText(/currently supplies the exit plan/)).toHaveCount(0);
    await recordOpenStep(page, 'plan');
    await expect(state).toHaveAttribute('data-exit-plan-row', 'no_rule');

    // Only the named action restores inheritance.
    await openExitPlanRow(page);
    await page.getByRole('button', { name: 'Use strategy default' }).click();
    await expect(state).toHaveAttribute('data-exit-plan-row', 'inherited');
    await closePlanEditor(page);
    await expect(state).toContainText('From Strategy: Golden Breakout');
    await page.locator('#entry-quick-save').click();
    await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/, { timeout: 60_000 });
    expect(await latestTrade(user.workspaceId)).toMatchObject({
      strategyId: user.goldenId,
      exitPlanProvenance: 'strategy_default',
    });
  });

  test('6 · a blocked Save opens the step that holds the problem', async ({ page }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(PHONE);
    const user = await newUser(page, 'ro-blocked');

    // Identity missing → Step 1, on the row that needs it.
    await page.goto(ROUTE);
    await recordOpenRisk(page, '100');
    await page.locator('#entry-quick-save').click();
    await expectStep(page, 'trade');
    await expect(recordOpenConcept(page, 'symbol')).toBeFocused();
    await expect(page.getByText('Enter a symbol.')).toBeVisible();

    // Risk missing → Step 2, on Risk at Entry.
    await recordOpenSymbol(page, 'NZDUSD');
    await recordOpenDirection(page, 'Long');
    const riskEditor = await openPlanRow(page, 'risk');
    await chooseInEditor(riskEditor, /^Defined risk/);
    await riskEditor.locator('#entry-risk').fill('');
    await closePlanEditor(page);
    await recordOpenSave(page);
    await expectStep(page, 'plan');
    // The row is the control on screen: it takes the focus and the error.
    await expect(planRow(page, 'risk')).toBeFocused();
    await expect(page.getByText('Enter your risk at entry.')).toBeVisible();

    // An incomplete Fixed Target → Step 2, on the Target row.
    await recordOpenRisk(page, '100');
    await openPlanRow(page, 'target');
    await chooseChoice(page, /^Fixed target/);
    await closePlanEditor(page);
    await recordOpenSave(page);
    await expectStep(page, 'plan');
    await expect(planRow(page, 'target')).toBeFocused();
    await expect(
      page.getByText('Add a target profit or a TP price, or choose No fixed target.'),
    ).toBeVisible();
    await openPlanRow(page, 'target');
    await chooseChoice(page, /^No fixed target/);
    await closePlanEditor(page);

    // A malformed price level → Step 2, on the Price levels row.
    const priceEditor = await recordOpenPriceLevels(page);
    await priceEditor.locator('#entry-context-stop-price').fill('12..5');
    await closePlanEditor(page);
    await recordOpenSave(page);
    await expectStep(page, 'plan');
    await expect(planRow(page, 'price')).toBeFocused();
    await expect(planRow(page, 'price')).toHaveAttribute('data-invalid', 'true');
    const repaired = await recordOpenPriceLevels(page);
    await repaired.locator('#entry-context-stop-price').fill('');
    await closePlanEditor(page);

    // A malformed TradingView link → Step 4, on the link.
    await recordOpenStep(page, 'context');
    await page.getByLabel('Chart link').fill('https://example.com/not-tradingview');
    await recordOpenSave(page);
    await expectStep(page, 'context');
    await expect(page.getByLabel('Chart link')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Chart link').fill('');
    expect(await tradeCount(user.workspaceId)).toBe(0);

    // An archived Strategy → Step 3, on its row; nothing saved until resolved.
    await recordOpenClassify(page, GOLDEN, RETEST);
    await waitForDraft(page);
    await withDb((db) =>
      db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, user.goldenId)),
    );
    await page.reload();
    await recordOpenSave(page);
    await expectStep(page, 'setup');
    await expect(page.locator('#entry-strategy')).toBeFocused();
    await expect(page.getByText(/The Strategy you chose was archived or removed/)).toBeVisible();
    await expect(
      page.getByText(
        'Choose another option or remove the answer marked no longer available, then save.',
      ),
    ).toBeVisible();
    expect(await tradeCount(user.workspaceId)).toBe(0);

    // An archived Setup → Step 3, on the Setup row.
    await withDb((db) =>
      db.update(strategies).set({ isArchived: false }).where(eq(strategies.id, user.goldenId)),
    );
    await withDb((db) =>
      db.update(setups).set({ isArchived: true }).where(eq(setups.id, user.retestId)),
    );
    await page.reload();
    await recordOpenSave(page);
    await expectStep(page, 'setup');
    await expect(page.locator('#entry-setup')).toBeFocused();
    await expect(page.getByText(/The Setup you chose was archived or removed/)).toBeVisible();
    expect(await tradeCount(user.workspaceId)).toBe(0);
  });
});
