import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  setupConditions,
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * AFTER TRADE STEP-FLOW REVIEW CAPTURES — development tooling for a visual
 * review of the five-step After Trade flow, not a behavioural spec.
 *
 * One provisioned user with a seeded Strategy and Setup, the real
 * `/app/trades/new?timing=after_trade` route, every step in a meaningful state
 * at 1440/1120/440/390/320 in Light and Dark. Each capture also asserts what a
 * screenshot cannot prove on its own: no horizontal overflow, and that the
 * docked step bar on a phone never sits over the step's last control.
 *
 * Skipped unless `AFTER_TRADE_SCREENSHOTS=1`.
 */
const ENABLED = process.env.AFTER_TRADE_SCREENSHOTS === '1';
const OUT = 'docs/reviews/after-trade-steps';
const ROUTE = '/en/app/trades/new?timing=after_trade';
const STRATEGY = 'Golden Breakout';
const SETUP = 'Clean Retest';

/** The step a reviewer names, and the key the form marks it with. */
const STEP_KEY = {
  trade: 'trade',
  result: 'result',
  plan: 'plan',
  context: 'context',
  save: 'details',
} as const;
type StepName = keyof typeof STEP_KEY;

test.describe('After Trade step-flow captures', () => {
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  test.skip(!ENABLED, 'Set AFTER_TRADE_SCREENSHOTS=1 to capture the After Trade review set.');

  test('captures every step at 1440/1120/440/390/320 in Light and Dark', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'One engine is enough for a review.');
    test.setTimeout(900_000);
    page.setDefaultTimeout(15_000);
    const user = await seedUser('after-trade-shots');
    await loginAs(page, 'en', user);

    for (const width of [1440, 1120, 440, 390, 320] as const) {
      for (const theme of ['dark', 'light'] as const) {
        await open(page, width, theme);
        // STEP 1, BEFORE ANYTHING IS RECORDED — the state a trader arrives at.
        await goTo(page, 'trade');
        await capture(page, `${width}-${theme}-trade-empty`);
        await fillEverything(page);
        // Each Step 1 editor, open over its completed step.
        for (const [field, name] of [
          ['Symbol', 'symbol'],
          ['Entry date', 'entered-date'],
          ['Entry time', 'entered-time'],
          ['Trading Account', 'account'],
        ] as const) {
          await openConcept(page, field);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}/${width}-${theme}-editor-${name}.png` });
          await closeConcept(page);
        }
        // Direction carries a tone, so both answers are reviewed.
        await openConcept(page, 'Direction');
        for (const direction of ['Long', 'Short'] as const) {
          await clickChoice(page, direction);
          await page.waitForTimeout(250);
          await page.screenshot({
            path: `${OUT}/${width}-${theme}-editor-direction-${direction.toLowerCase()}.png`,
          });
        }
        await clickChoice(page, 'Long');
        await closeConcept(page);
        await assertStepOneProportion(page, `${width}-${theme}`);
        for (const step of ['trade', 'result', 'plan', 'context', 'save'] as const) {
          await goTo(page, step);
          if (step === 'context') {
            await openEmotion(page, 'emotions');
          }
          await capture(page, `${width}-${theme}-${step}`);
        }
        // Quick Save: offered from an earlier step once identity is answered.
        await goTo(page, 'result');
        await expect(page.locator('#after-quick-save')).toBeVisible();
        await capture(page, `${width}-${theme}-quick-save`);

        // A blocked Save from the last step lands on the control that needs it.
        await goTo(page, 'plan');
        await page.locator('#after-risk').fill('12..5');
        await goTo(page, 'save');
        await page.getByRole('button', { name: 'Save closed trade' }).click();
        await expect(page.locator('[data-after-trade-form]')).toHaveAttribute(
          'data-after-trade-step',
          'plan',
        );
        await expect(page.locator('#after-risk')).toBeFocused();
        await capture(page, `${width}-${theme}-blocked-save`);
        await page.locator('#after-risk').fill('100');
        await discardDraft(page);
      }
    }
  });

  test('keeps the flow honest: keyboard, round trip, reload recovery', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'One engine is enough for a review.');
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const user = await seedUser('after-trade-flow');
    await loginAs(page, 'en', user);

    for (const width of [1440, 390] as const) {
      await open(page, width, 'dark');
      await fillEverything(page);

      // Round trip: every step, back to the start, and nothing is lost.
      await goTo(page, 'save');
      for (let index = 0; index < 4; index += 1) {
        await page.getByRole('button', { name: 'Back', exact: true }).click();
      }
      await expect(page.locator('[data-concept="symbol"]')).toContainText('XAUUSD');
      await goTo(page, 'result');
      await expect(page.locator('#after-finalPnl')).toHaveValue('400');
      await expect(page.locator('[data-actual-r]')).toContainText('+4.00R');

      // Keyboard: Next is reachable and moves focus to the new step's heading.
      await goTo(page, 'trade');
      const next = page.getByRole('button', { name: 'Next: Result' });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 2, name: 'Result' })).toBeFocused();
      // The Result step now opens on the final exit time: how the trade ended.
      await page.keyboard.press('Tab');
      await expect(page.locator('#after-exitedAt')).toBeFocused();
      await capture(page, `${width}-dark-keyboard-focus`);

      // Reload recovery: the Shared Recording Draft brings every answer back.
      await page.reload();
      await expect(
        page.getByText('We restored your unsaved trade draft from this browser.'),
      ).toBeVisible();
      await expect(page.locator('[data-concept="symbol"]')).toContainText('XAUUSD');
      // Reload recovery reaches inside the editor too, not only the row.
      const recovered = await openConcept(page, 'Symbol');
      await expect(recovered.getByRole('textbox', { name: 'Symbol' })).toHaveValue('XAUUSD');
      await closeConcept(page);
      await expect(page.locator('[data-concept="symbol"]')).toContainText('XAUUSD');
      await expect(page.locator('#after-finalPnl')).toHaveValue('400');
      await expect(page.locator('#after-risk')).toHaveValue('100');
      await discardDraft(page);
    }
  });
});

async function seedUser(prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}@example.test`,
    password: 'Correct-Horse9!',
    name: 'After Trade Review',
  });
  await seedStrategy(user.id);
  return user;
}

async function open(page: Page, width: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: width >= 1120 ? 1000 : 844 });
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('trading-os-theme', value);
    } catch {
      /* private mode — the page still renders its default */
    }
  }, theme);
  await page.goto(ROUTE);
  await expect(page.locator('[data-after-trade-form]')).toBeVisible();
}

/** Open a step from the step list: the rail on a wide screen, the segments on a phone. */
async function goTo(page: Page, step: StepName) {
  const key = STEP_KEY[step];
  await page.locator(`[data-step-link="${key}"]`).click();
  await expect(page.locator('[data-after-trade-form]')).toHaveAttribute(
    'data-after-trade-step',
    key,
  );
}

async function clickChoice(page: Page, name: RegExp | string) {
  const radio = page.getByRole('radio', { name, exact: typeof name === 'string' });
  const id = await radio.getAttribute('id');
  if (id === null) throw new Error(`choice "${String(name)}" has no id`);
  await page.locator(`label[for="${id}"]`).click();
}

/** One of Step 5's grouped detail sections. */
async function openGroup(page: Page, group: 'notes' | 'market' | 'price') {
  const toggle = page.locator(`#after-details-${group}`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Fold it back, so the capture shows the state a trader arrives at. */
async function foldGroup(page: Page, group: 'notes' | 'market' | 'price') {
  const toggle = page.locator(`#after-details-${group}`);
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
}

/**
 * STEP 1 IS READ-FIRST: every concept shows its answer and opens its own
 * editor — a bottom sheet on a phone, a dialog on a desktop.
 */
async function openConcept(page: Page, field: string) {
  await goTo(page, 'trade');
  await page.getByRole('button', { name: `Edit ${field}` }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}

async function closeConcept(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function openEmotion(page: Page, phase: 'emotions' | 'postTradeEmotions') {
  const toggle = page.locator(`#after-${phase}-toggle`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** A meaningful closed trade: every step holds real answers. */
async function fillEverything(page: Page) {
  const symbol = await openConcept(page, 'Symbol');
  await symbol.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
  await closeConcept(page);
  await openConcept(page, 'Direction');
  await clickChoice(page, 'Long');
  await closeConcept(page);
  // The entry timestamp is two answers: the day, then the minute.
  const date = await openConcept(page, 'Entry date');
  await date.locator('[data-range-date="2026-09-18"]').click();
  await closeConcept(page);
  const entered = await openConcept(page, 'Entry time');
  await entered.locator('#after-enteredTime').fill('09:30');
  await closeConcept(page);

  // The final exit time says how the trade ended, so it asks on Result.
  await goTo(page, 'result');
  await page.locator('#after-exitedAt').fill('2026-09-18T14:05');
  await page.locator('#after-finalPnl').fill('400');
  await clickChoice(page, 'Win');
  await page.locator('#after-exits-toggle').click();
  await page.getByRole('button', { name: 'Record an exit' }).click();
  const exit = page.locator('[data-after-exit]').first();
  await exit.locator('input[id$="-pnl"]').fill('150');
  await exit.locator('input[id$="-closedPercent"]').fill('50');
  await exit.locator('input[id$="-reason"]').fill('Partial at 1R');

  await goTo(page, 'plan');
  await page.locator('#after-risk').fill('100');
  await clickChoice(page, 'It was different');
  await page.locator('#after-actual-risk-amount').fill('120');
  await clickChoice(page, /^Fixed target/);
  await page.locator('#after-targetProfit').fill('300');

  await goTo(page, 'context');
  await page.getByLabel('Strategy', { exact: true }).selectOption({ label: STRATEGY });
  await page.getByLabel('Setup', { exact: true }).selectOption({ label: SETUP });
  const group = page.getByRole('group', { name: /Retest held/ });
  const met = group.getByRole('radio', { name: 'Met', exact: true });
  await group.locator(`label[for="${await met.getAttribute('id')}"]`).click();
  await clickChoice(page, 'High');
  await openEmotion(page, 'emotions');
  await page
    .locator('[data-emotions-phase="emotions"]')
    .getByRole('button', { name: 'Focused' })
    .click();
  await openEmotion(page, 'postTradeEmotions');
  await page
    .locator('[data-emotions-phase="postTradeEmotions"]')
    .getByRole('button', { name: 'Calm' })
    .click();
  // Collapse it again: the capture shows the summary a trader returns to.
  await openEmotion(page, 'postTradeEmotions');
  // The thesis reads with the rest of the trader's read on the trade.
  await page.getByLabel('Why this trade').fill('Clean retest of the London high.');

  await goTo(page, 'save');
  // Step 5's groups open on request and fold back to a summary of their values.
  await openGroup(page, 'market');
  await page.getByLabel('Timeframe').fill('15m');
  await page.getByLabel('Session').fill('London');
  await openGroup(page, 'price');
  await page.getByLabel('Entry price').fill('2398.5');
  await page.getByLabel('SL price').fill('2394.5');
  await foldGroup(page, 'market');
  await foldGroup(page, 'price');
}

/**
 * WHAT THE PROPORTION PASS HAS TO KEEP TRUE, measured rather than eyeballed.
 * A screenshot can show a row looking right; only the box can say whether it
 * is still a comfortable target, whether the rhythm between rows held, and
 * whether the one forward action on Step 1 actually uses the width.
 */
async function assertStepOneProportion(page: Page, name: string) {
  await goTo(page, 'trade');
  const box = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-concept]')).map((row) =>
      row.getBoundingClientRect(),
    );
    const bar = document
      .querySelector('[data-step-actions] [data-step-actions-layout]')
      ?.getBoundingClientRect();
    const next = Array.from(document.querySelectorAll('[data-step-actions] button'))
      .find((button) => (button.textContent ?? '').includes('Next'))
      ?.getBoundingClientRect();
    /*
      Only rows that actually stack. From 560px the four rows are a 2x2 grid,
      where the NEXT row in DOM order sits beside this one — measuring that as
      a vertical gap reports a large negative number and says nothing.
    */
    const gaps: number[] = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1]!;
      const current = rows[index]!;
      if (Math.abs(current.left - previous.left) > 1) continue;
      gaps.push(current.top - previous.bottom);
    }
    return {
      heights: rows.map((row) => row.height),
      gaps,
      barWidth: bar?.width ?? 0,
      nextWidth: next?.width ?? 0,
    };
  });

  for (const height of box.heights) {
    expect(height, `${name}: launcher row height ${height}px`).toBeGreaterThanOrEqual(74);
    expect(height, `${name}: launcher row height ${height}px`).toBeLessThanOrEqual(90);
  }
  for (const gap of box.gaps) {
    expect(gap, `${name}: launcher row gap ${gap}px`).toBeGreaterThanOrEqual(8);
    expect(gap, `${name}: launcher row gap ${gap}px`).toBeLessThanOrEqual(14);
  }
  // Step 1 has no Back, so on a phone the forward action takes the bar.
  const wide = Number(name.split('-')[0]) >= 1024;
  if (!wide) {
    expect(
      box.nextWidth / box.barWidth,
      `${name}: Next fills ${Math.round((box.nextWidth / box.barWidth) * 100)}% of the bar`,
    ).toBeGreaterThan(0.95);
  }
}

async function capture(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name}: horizontal overflow ${overflow}px`).toBeLessThanOrEqual(1);

  // A docked step bar must leave the step's last control reachable above it.
  const bar = page.locator('[data-step-actions][data-action-bar="docked"]');
  if ((await bar.count()) > 0) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const barBox = await bar.boundingBox();
    const lastControl = page
      .locator('section[data-step]:not([hidden])')
      .locator('input:visible, select:visible, textarea:visible, button:visible')
      .last();
    const controlBox = await lastControl.boundingBox();
    if (barBox !== null && controlBox !== null) {
      expect(
        controlBox.y + controlBox.height,
        `${name}: the docked step bar covers the last control`,
      ).toBeLessThanOrEqual(barBox.y + 1);
    }
    /*
      A DOCKED BAR HAS TO REACH THE BOTTOM OF THE SCREEN, EDGE TO EDGE.
      `position: sticky` only pins an element once there is something to
      scroll; on a step short enough to fit, it simply stops wherever the
      content stopped, leaving a card-coloured strip with a band of empty page
      under it. That is what this pass fixed, and it is invisible in a
      screenshot of the strip itself — only the box against the viewport shows
      it. Full-bleed is the other half: inset inside the page's gutters, the
      bar reads as a card someone left a button in rather than as the bottom
      of the screen.
    */
    const viewport = page.viewportSize();
    if (barBox !== null && viewport !== null) {
      expect(
        Math.round(barBox.y + barBox.height),
        `${name}: the docked bar stops ${Math.round(viewport.height - barBox.y - barBox.height)}px short of the screen`,
      ).toBeGreaterThanOrEqual(viewport.height - 1);
      expect(
        Math.round(barBox.x),
        `${name}: the docked bar is inset from the left`,
      ).toBeLessThanOrEqual(0);
      expect(
        Math.round(barBox.x + barBox.width),
        `${name}: the docked bar is inset from the right`,
      ).toBeGreaterThanOrEqual(viewport.width);
    }
    await page.screenshot({ path: `${OUT}/${name}-bottom.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

async function discardDraft(page: Page) {
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
}

/** One Strategy with one Setup and two Conditions. */
async function seedStrategy(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: { workspaces, strategies, strategyVersions, setups, strategySetupVersions },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('After Trade capture workspace missing');
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: workspace.id })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('After Trade capture Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 1,
        name: STRATEGY,
      })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('After Trade capture Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: workspace.id, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('After Trade capture Setup insert failed');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId: workspace.id,
        strategyVersionId: version.id,
        strategyId: strategy.id,
        setupId: setup.id,
        name: SETUP,
        sortOrder: 0,
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('After Trade capture Setup Version failed');
    await db.insert(setupConditions).values([
      {
        workspaceId: workspace.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        label: 'Breakout candle closed',
        sortOrder: 0,
      },
      {
        workspaceId: workspace.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        label: 'Retest held',
        sortOrder: 1,
      },
    ]);
  } finally {
    await client.end();
  }
}
