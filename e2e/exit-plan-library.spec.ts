import { expect, test, type Page } from '@playwright/test';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { strategies, strategyVersions, trades, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';
import { recordOpenClassify, recordOpenMinimum, recordOpenStep } from './support/record-open';

/**
 * SAVED EXIT PLANS, REACHED THE WAY A TRADER REACHES THEM.
 *
 * Only a Strategy is seeded — the Strategy editor is not what this proves.
 * Every Exit Plan here is created, edited, made a default and archived through
 * the At Entry editor's "Manage saved plans" view, and every Trade is saved
 * from the real At Entry form.
 */

async function withDb<T>(work: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    return await work(drizzle(client));
  } finally {
    await client.end();
  }
}

async function seedStrategy(userId: string, name: string): Promise<void> {
  await withDb(async (db) => {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('workspace missing');
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: workspace.id })
      .returning();
    if (strategy === undefined) throw new Error('strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({ workspaceId: workspace.id, strategyId: strategy.id, versionNumber: 1, name })
      .returning();
    if (version === undefined) throw new Error('version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
  });
}

async function latestTrade(userId: string) {
  return withDb(async (db) => {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('workspace missing');
    const [row] = await db
      .select()
      .from(trades)
      .where(eq(trades.workspaceId, workspace.id))
      .orderBy(desc(trades.createdAt))
      .limit(1);
    if (row === undefined) throw new Error('no trade saved');
    return row;
  });
}

/** Record Open to its Save minimum, ending on Plan & Risk — where the Exit Plan is asked. */
async function startTrade(page: Page) {
  await page.goto('/en/app/trades/new?timing=at_entry');
  await recordOpenMinimum(page, { symbol: 'XAUUSD', direction: 'Long', risk: '100' });
}

function editor(page: Page) {
  return page.getByRole('dialog', { name: 'Exit plan' });
}

/**
 * The Exit Plan reads as a launcher row on Plan & Risk (UX Rules §20.13), and
 * its states, actions and chooser open from there.
 */
async function openExitPlan(page: Page) {
  await recordOpenStep(page, 'plan');
  await page.locator('[data-exit-plan-row]').click();
  await expect(editor(page)).toBeVisible();
}

/** The chooser replaces the state sheet; closing it brings that sheet back. */
async function chooseExitPlan(page: Page) {
  await openExitPlan(page);
  await page.getByRole('button', { name: 'Choose exit plan' }).click();
}

async function leaveExitPlan(page: Page) {
  await editor(page).getByRole('button', { name: 'Done' }).click();
  await expect(editor(page)).toHaveCount(0);
}

function exitPlanState(page: Page) {
  return page.locator('[data-exit-plan-row]');
}

async function saveTrade(page: Page) {
  await page.getByRole('button', { name: 'Save open trade' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/trades\?trade=[0-9a-f-]+/);
}

test.describe('Saved Exit Plan library', () => {
  test.describe.configure({ retries: 0 });
  test.beforeEach(() => test.skip(!hasE2eDatabase, E2E_SKIP_REASON));

  test('create → choose → edit keeps the snapshot → default → inherit → decline → restore → archive', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(120_000);
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: `e2e-exit-plans-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      password: 'Correct-Horse9!',
      name: 'E2E Exit Plan Tester',
    });
    await seedStrategy(user.id, 'Golden Breakout');
    await loginAs(page, 'en', user);

    // 1. Create a saved plan from an empty library.
    await startTrade(page);
    await chooseExitPlan(page);
    await expect(editor(page).getByText('You have no saved exit plans yet.')).toBeVisible();
    await editor(page).getByRole('button', { name: 'Create a saved plan' }).click();
    await editor(page).getByLabel('Name').fill('Scale out');
    await editor(page).getByLabel('Instructions').fill('Half at 1R.\nTrail the rest.');
    await editor(page).getByRole('button', { name: 'Save plan' }).click();
    await expect(
      editor(page).getByText('Scale out saved. Go back to choose it for this trade.'),
    ).toBeVisible();

    // 2–3. It appears among the choices and is chosen explicitly.
    await editor(page).getByRole('button', { name: 'Back to exit plan choices' }).click();
    await editor(page).locator('label', { hasText: 'Scale out' }).click();
    await editor(page).getByRole('button', { name: 'Done' }).click();
    await expect(exitPlanState(page)).toHaveAttribute('data-exit-plan-row', 'saved');
    await leaveExitPlan(page);
    await saveTrade(page);
    const first = await latestTrade(user.id);
    expect(first).toMatchObject({
      exitPlanState: 'saved',
      exitPlanProvenance: 'selected',
      exitPlanName: 'Scale out',
      exitPlanInstructions: 'Half at 1R.\nTrail the rest.',
    });

    // 4–5. Edit the library definition; the saved Trade keeps its copy.
    await startTrade(page);
    await chooseExitPlan(page);
    await editor(page).getByRole('button', { name: 'Manage saved plans' }).click();
    await editor(page).getByRole('button', { name: 'Edit Scale out' }).click();
    await editor(page).getByLabel('Instructions').fill('Close everything at 2R.');
    await editor(page).getByRole('button', { name: 'Save plan' }).click();
    await expect(editor(page).getByText('Scale out updated.')).toBeVisible();
    const afterEdit = await withDb(async (db) => {
      const [row] = await db.select().from(trades).where(eq(trades.id, first.id));
      return row;
    });
    expect(afterEdit).toMatchObject({
      exitPlanName: 'Scale out',
      exitPlanInstructions: 'Half at 1R.\nTrail the rest.',
    });

    // 9. Make it the default for the Strategy this trade uses.
    await editor(page).getByRole('button', { name: 'Close' }).click();
    await leaveExitPlan(page);
    // The Strategy is Setup & Checklist’s answer; the Exit Plan is back on Plan & Risk.
    await recordOpenClassify(page, 'Golden Breakout');
    await chooseExitPlan(page);
    await editor(page).getByRole('button', { name: 'Manage saved plans' }).click();
    await editor(page).getByRole('button', { name: 'Make default for Golden Breakout' }).click();
    await expect(
      editor(page).getByText('Scale out is now the default for Golden Breakout.'),
    ).toBeVisible();
    await editor(page).getByRole('button', { name: 'Close' }).click();

    // 10. At Entry inherits it, visibly — readable on the row itself.
    await expect(exitPlanState(page)).toHaveAttribute('data-exit-plan-row', 'inherited');
    await expect(exitPlanState(page)).toContainText('From Strategy: Golden Breakout');

    // 11. Declined, it stays declined.
    await page.getByRole('button', { name: 'Remove exit plan answer' }).click();
    await expect(exitPlanState(page)).toHaveAttribute('data-exit-plan-row', 'not_recorded');

    // 12. Restored only by the explicit action.
    await page.getByRole('button', { name: 'Use strategy default' }).click();
    await expect(exitPlanState(page)).toHaveAttribute('data-exit-plan-row', 'inherited');
    await leaveExitPlan(page);
    await saveTrade(page);
    expect(await latestTrade(user.id)).toMatchObject({
      exitPlanProvenance: 'strategy_default',
      exitPlanInstructions: 'Close everything at 2R.',
      exitPlanInheritanceDeclined: false,
    });

    // 6–8. Archive it: gone from active choices, both snapshots kept.
    await startTrade(page);
    await chooseExitPlan(page);
    await editor(page).getByRole('button', { name: 'Manage saved plans' }).click();
    await editor(page).getByRole('button', { name: 'Archive Scale out' }).click();
    await editor(page).getByRole('button', { name: 'Archive plan' }).click();
    await expect(editor(page).getByText('Scale out archived.')).toBeVisible();
    await expect(editor(page).getByText('No saved plans yet.', { exact: false })).toBeVisible();
    await editor(page).getByRole('button', { name: 'Back to exit plan choices' }).click();
    await expect(editor(page).locator('label', { hasText: 'Scale out' })).toHaveCount(0);
    const afterArchive = await withDb(async (db) => {
      const [row] = await db.select().from(trades).where(eq(trades.id, first.id));
      return row;
    });
    expect(afterArchive).toMatchObject({
      exitPlanName: 'Scale out',
      exitPlanInstructions: 'Half at 1R.\nTrail the rest.',
    });
  });
});
