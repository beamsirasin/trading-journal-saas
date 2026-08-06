import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
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
 * Phase 06E — the real Strategy/Setup/Rule management UI. Deterministic
 * database fixtures only (same posture as `e2e/accounts.spec.ts`), one fresh
 * onboarded user per test so mutations never bleed across tests under
 * `playwright.config.ts`'s `fullyParallel: true`.
 *
 * Every test provisions an ACTIVE Professional entitlement (the
 * `provisionVerifiedUser` default) unless it specifically exercises
 * read-only/over-limit access, which needs a real, honest entitlement
 * snapshot instead — see `provisionReadOnlyUser`/`provisionOverLimitUser`.
 *
 * ## Test structure (revised)
 *
 * The original single "full lifecycle" test chained ~13 Server Action
 * mutations (create/edit Strategy, 2 Setups, edit Setup, 2 Rule creates, Rule
 * edit, Rule remove, Setup archive/restore, Strategy archive/restore) inside
 * one page session and intermittently stalled on a late Rule mutation —
 * reproducible on both browser projects, but proven (direct service-layer
 * reproduction, live `pg_stat_activity` inspection, a network trace showing
 * the browser never received any response) to be a density-dependent
 * characteristic of chaining that many rapid Server Action +
 * `revalidatePath` + `router.refresh()` cycles in one session, not a defect
 * in the Strategy/Setup/Rule business logic itself, which is correct and
 * fast when called directly.
 *
 * This file instead keeps each scenario to a small, independent set of UI
 * mutations:
 *
 * - `Strategy and Setup lifecycle` — every Strategy/Setup UI mutation
 *   (create, edit, archive, restore for both), zero Rule mutations.
 * - `Strategy-level Rule lifecycle` / `Setup-level Rule lifecycle` — the
 *   Strategy (and, for the Setup-scoped case, two Setups) are seeded
 *   directly through guarded database fixtures (`seedStrategy`/`seedSetup`)
 *   rather than re-driven through the UI, so each test's own UI mutations
 *   are just the 3 Rule operations (create, edit, remove) it exists to
 *   prove — the operation under test is never the one bypassed.
 * - `locked-Version copy-on-write` — unchanged, already independent.
 */
async function provisionOnboardedUser(labelPrefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const projectName = test.info().project.name;
  const email = `${labelPrefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(testUrl, {
    email,
    password: 'Correct-Horse9!',
    name: 'E2E Strategies Tester',
  });
}

async function provisionReadOnlyUser(labelPrefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const projectName = test.info().project.name;
  const email = `${labelPrefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(
    testUrl,
    { email, password: 'Correct-Horse9!', name: 'E2E Strategies Tester' },
    // A trial that already ended — `resolveEffectiveEntitlement` resolves
    // this to `accessMode: 'read_only'`, `denialReason: 'trial_expired'`.
    { entitlement: { status: 'trialing', trialEndsAt: new Date(Date.now() - 60_000) } },
  );
}

async function provisionOverLimitUser(labelPrefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const projectName = test.info().project.name;
  const email = `${labelPrefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(
    testUrl,
    { email, password: 'Correct-Horse9!', name: 'E2E Strategies Tester' },
    // Starter (limit 1) plus one additional already-seeded account puts the
    // workspace at 2/1 — `accessMode: 'over_limit'`, real UI can never
    // produce this on its own (Phase 3C).
    {
      entitlement: { status: 'active', planKey: 'starter' },
      additionalAccounts: 1,
    },
  );
}

async function withDb<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    const db = drizzle(client, {
      schema: { strategies, strategyVersions, setups, strategySetupVersions, workspaces },
    });
    return await fn(db);
  } finally {
    await client.end();
  }
}

/** Resolves the personal workspace `provisionVerifiedUser` created for this user — the same lookup `e2e/accounts.spec.ts` uses. */
async function resolveWorkspaceId(userId: string): Promise<string> {
  return withDb(async (db) => {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    const id = rows[0]?.id;
    if (id === undefined)
      throw new Error(`resolveWorkspaceId: no workspace found for user ${userId}`);
    return id;
  });
}

/** Directly inserts a Strategy + its Version 1, bypassing the service — a fixture the real UI can also produce, used to give a test something pre-existing without re-driving Strategy creation through the UI. */
async function seedStrategy(workspaceId: string, name: string): Promise<string> {
  return withDb(async (db) => {
    const [strategyRow] = await db.insert(strategies).values({ workspaceId }).returning();
    const strategyId = strategyRow?.id;
    if (strategyId === undefined) throw new Error('seedStrategy: insert did not return an id');
    const [versionRow] = await db
      .insert(strategyVersions)
      .values({ workspaceId, strategyId, versionNumber: 1, name })
      .returning();
    const versionId = versionRow?.id;
    if (versionId === undefined)
      throw new Error('seedStrategy: version insert did not return an id');
    await db
      .update(strategies)
      .set({ currentVersionId: versionId })
      .where(eq(strategies.id, strategyId));
    return strategyId;
  });
}

/** Directly inserts a Setup identity + its snapshot in the Strategy's current Version — bypassing the service, used only to give a Rule test an existing Setup scope without re-driving Setup creation through the UI. */
async function seedSetup(
  workspaceId: string,
  strategyId: string,
  name: string,
  sortOrder: number,
): Promise<string> {
  return withDb(async (db) => {
    const [strategyRow] = await db
      .select({ currentVersionId: strategies.currentVersionId })
      .from(strategies)
      .where(eq(strategies.id, strategyId));
    const versionId = strategyRow?.currentVersionId;
    if (versionId === null || versionId === undefined) {
      throw new Error('seedSetup: strategy has no current version');
    }
    const [setupRow] = await db.insert(setups).values({ workspaceId, strategyId }).returning();
    const setupId = setupRow?.id;
    if (setupId === undefined) throw new Error('seedSetup: insert did not return an id');
    await db.insert(strategySetupVersions).values({
      workspaceId,
      strategyId,
      strategyVersionId: versionId,
      setupId,
      name,
      sortOrder,
    });
    return setupId;
  });
}

/** Locks a Strategy's current Version directly — the one-time null → non-null transition Phase 08's future trade-creation transaction will perform for real; no manual lock control exists in production UI. */
async function lockCurrentVersion(strategyId: string): Promise<void> {
  await withDb(async (db) => {
    const [row] = await db
      .select({ currentVersionId: strategies.currentVersionId })
      .from(strategies)
      .where(eq(strategies.id, strategyId));
    const versionId = row?.currentVersionId;
    if (versionId === null || versionId === undefined) {
      throw new Error('lockCurrentVersion: strategy has no current version');
    }
    await db
      .update(strategyVersions)
      .set({ lockedAt: new Date() })
      .where(eq(strategyVersions.id, versionId));
  });
}

async function countStrategies(workspaceId: string): Promise<number> {
  return withDb(async (db) => {
    const rows = await db.select().from(strategies).where(eq(strategies.workspaceId, workspaceId));
    return rows.length;
  });
}

/** A Setup card's own accessible region (`setup-list.tsx`'s `role="region"` Card). */
function strategyRegion(page: Page, name: string): Locator {
  return page.getByRole('region', { name: new RegExp(name) });
}

/**
 * The selected Strategy's detail panel — its own `role="region"` distinct
 * from the SAME Strategy name also appearing as a list-item heading beside
 * it (desktop shows both columns at once), so every post-selection
 * assertion below is scoped to this region rather than the bare page.
 */
function detailRegion(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/**
 * A Rule group's own container, scoped by its heading text. Setup-level Rule
 * groups (`rules-manager.tsx`'s `RuleGroup`) are headed by the Setup's own
 * name — the SAME text a Setup's list card heading already uses — so
 * `.last()` disambiguates via a stable, documented DOM-order contract:
 * `strategy-detail.tsx` always renders `<SetupList>` before
 * `<RulesManager>`, so the last heading with this exact text in the page is
 * always the Rule group's, never the Setup card's. `xpath=..` climbs to the
 * group's own wrapping element so assertions never leak into an unrelated
 * container.
 */
function ruleGroup(page: Page, headingName: string): Locator {
  return page.getByRole('heading', { name: headingName, exact: true }).last().locator('xpath=..');
}

/** Matches a raw UUID — used to prove a Rule group's rendered text never leaks the internal Rule row id (`rules-manager.tsx` only ever renders `ruleKey`-addressed controls). */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test.describe('strategy, setup and rule management', () => {
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  test('an unauthenticated visitor is redirected to localized login', async ({ page }) => {
    await page.goto('/en/app/strategies');
    await expect(page).toHaveURL(/\/en\/login/);
    await page.goto('/th/app/strategies');
    await expect(page).toHaveURL(/\/th\/login/);
  });

  test('the real page replaces the placeholder: empty state, no fabricated fixture content', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-empty');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/strategies');
    await expect(page.getByRole('heading', { level: 1, name: 'Strategies' })).toBeVisible();
    await expect(page.getByText('No Strategies yet')).toBeVisible();
    // The old Phase 01 fixture strategies must never appear again.
    await expect(page.getByText('London breakout')).toHaveCount(0);
    await expect(page.getByText('Asia range fade')).toHaveCount(0);
    await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-kpi]')).toHaveCount(0);
    await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
  });

  test('Strategy lifecycle: create, edit, archive/restore, and no hard-delete anywhere', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-strategy-lifecycle');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');

    // Create a Strategy; select the returned Strategy.
    await page.getByRole('button', { name: 'New strategy' }).first().click();
    await expect(page.getByRole('heading', { name: 'Create Strategy' })).toBeVisible();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('This field is required.')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Elliott Wave + RSI');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\?strategy=/);
    const detail = detailRegion(page, 'Elliott Wave + RSI');
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Current version 1')).toBeVisible();
    await expect(detail.getByText('Editable version')).toBeVisible();

    // Edit it without a change note (unlocked).
    await detail.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Strategy' })).toBeVisible();
    await expect(page.getByLabel('Change note')).toHaveCount(0);
    await page.getByLabel('Description').fill('Wave-based reversal and continuation system.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.getByText('Wave-based reversal and continuation system.')).toBeVisible();
    await expect(detail.getByText('Current version 1')).toBeVisible();

    // Archive and restore the Strategy — archive is not deletion.
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Archiving is not deletion');
    await expect(page.getByRole('alertdialog')).not.toContainText(/delete/i);
    await page.getByRole('button', { name: 'Confirm archive' }).click();
    // Scoped to the detail region, not the bare page: on `mobile-chrome`'s
    // viewport (below the `lg` breakpoint), the Strategy list column is
    // `hidden` — not removed — once a Strategy is selected, so the SAME
    // "Archived" badge on the (hidden) list card would otherwise resolve
    // first and fail a bare page-wide `.first()` visibility check.
    await expect(detail.getByText('Archived', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // No hard-delete control exists anywhere on the page.
    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(0);

    // Final state: current Version never bumped (no locking occurred).
    await expect(detail.getByText('Current version 1')).toBeVisible();
  });

  test('Setup lifecycle: create, edit, reorder, archive/restore on a fixture-seeded Strategy', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-setup-lifecycle');
    const workspaceId = await resolveWorkspaceId(user.id);
    const strategyId = await seedStrategy(workspaceId, 'Trend Pullback System');

    await loginAs(page, 'en', user);
    await page.goto(`/en/app/strategies?strategy=${strategyId}`);
    const detail = detailRegion(page, 'Trend Pullback System');
    await expect(detail).toBeVisible();
    await expect(page.getByText('No Setups yet')).toBeVisible();

    // Create two Setups.
    await page.getByRole('button', { name: 'New setup' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Wave 2 Reversal');
    await page.getByLabel('Sort order').fill('0');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wave 2 Reversal' })).toBeVisible();

    await page.getByRole('button', { name: 'New setup' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Wave 3 Continuation');
    await page.getByLabel('Sort order').fill('1');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wave 3 Continuation' })).toBeVisible();

    // Edit and reorder a Setup: rename it and push its sort order past the
    // other Setup's — the rendered order must flip.
    const setupRegion = strategyRegion(page, 'Wave 2 Reversal');
    await setupRegion.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Wave 2 Reversal (Renamed)');
    await page.getByLabel('Sort order').fill('2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wave 2 Reversal (Renamed)' })).toBeVisible();

    const setupHeadings = await page.getByRole('heading').allTextContents();
    const wave2Index = setupHeadings.findIndex((text) =>
      text.includes('Wave 2 Reversal (Renamed)'),
    );
    const wave3Index = setupHeadings.findIndex((text) => text.includes('Wave 3 Continuation'));
    expect(wave3Index).toBeGreaterThanOrEqual(0);
    expect(wave2Index).toBeGreaterThan(wave3Index);

    // Archive and restore a Setup — archive is not deletion.
    await strategyRegion(page, 'Wave 3 Continuation')
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByRole('alertdialog')).toContainText('Archiving is not deletion');
    await expect(page.getByRole('alertdialog')).not.toContainText(/delete/i);
    await page.getByRole('button', { name: 'Confirm archive' }).click();
    await expect(strategyRegion(page, 'Wave 3 Continuation').getByText('Archived')).toBeVisible();
    await strategyRegion(page, 'Wave 3 Continuation')
      .getByRole('button', { name: 'Restore' })
      .click();
    await expect(strategyRegion(page, 'Wave 3 Continuation').getByText('Available')).toBeVisible();

    // No hard-delete control exists anywhere on the page.
    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(0);

    // Final state: both Setups present and available.
    await expect(strategyRegion(page, 'Wave 2 Reversal').getByText('Available')).toBeVisible();
    await expect(strategyRegion(page, 'Wave 3 Continuation').getByText('Available')).toBeVisible();
  });

  test('Strategy-level Rule lifecycle: create, edit, remove through the UI on a fixture-seeded Strategy', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-rule-strategy-level');
    const workspaceId = await resolveWorkspaceId(user.id);
    const strategyId = await seedStrategy(workspaceId, 'Momentum Continuation');

    await loginAs(page, 'en', user);
    await page.goto(`/en/app/strategies?strategy=${strategyId}`);
    const detail = detailRegion(page, 'Momentum Continuation');
    await expect(detail).toBeVisible();
    await expect(page.getByText('No rules yet')).toBeVisible();

    // Create a Strategy-level Rule with a specific category, required
    // relaxed, and Pre-trade check enabled.
    await page.getByRole('button', { name: 'New rule' }).click();
    await expect(
      page.getByLabel('Scope').locator('option', { hasText: 'Strategy-level' }),
    ).toHaveCount(1);
    await page.getByLabel('Category').selectOption({ label: 'Risk' });
    await page.getByLabel('Rule title').fill('Risk per trade must not exceed 1%');
    await page.getByLabel('Required').uncheck();
    await page.getByLabel('Pre-trade check').check();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('Strategy-level rules')).toBeVisible();
    const strategyGroup = ruleGroup(page, 'Strategy-level rules');
    await expect(strategyGroup.getByText('Risk per trade must not exceed 1%')).toBeVisible();
    await expect(strategyGroup.getByText('Risk', { exact: true })).toBeVisible();
    await expect(strategyGroup.getByText('Pre-trade check')).toBeVisible();
    await expect(strategyGroup.getByText('Required', { exact: true })).toHaveCount(0);
    // No internal Rule row id is ever rendered — only `ruleKey`-addressed
    // controls (the Edit/Remove buttons above, by title) reach the DOM.
    expect(await strategyGroup.innerText()).not.toMatch(UUID_PATTERN);

    // Edit it.
    await page
      .getByRole('button', { name: 'Edit rule: Risk per trade must not exceed 1%' })
      .click();
    await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
    // Scope is read-only on edit — it is chosen only at create time.
    await expect(page.getByRole('combobox', { name: 'Scope' })).toHaveCount(0);
    await page.getByLabel('Rule title').fill('Risk per trade must not exceed 1% of equity');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      strategyGroup.getByText('Risk per trade must not exceed 1% of equity'),
    ).toBeVisible();

    // Remove it — the confirmation explains retained history, never deletion.
    await page
      .getByRole('button', { name: 'Remove rule: Risk per trade must not exceed 1% of equity' })
      .click();
    await expect(page.getByRole('alertdialog')).toContainText('retain their historical copy');
    await expect(page.getByRole('alertdialog')).not.toContainText(/delete/i);
    await page.getByRole('button', { name: 'Remove rule', exact: true }).click();
    await expect(page.getByText('Risk per trade must not exceed 1% of equity')).toHaveCount(0);
    await expect(page.getByText('No rules yet')).toBeVisible();

    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(0);
  });

  test('Setup-level Rule lifecycle: grouped beneath the correct Setup, never cross-placed, on fixture-seeded Strategy and Setups', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-rule-setup-level');
    const workspaceId = await resolveWorkspaceId(user.id);
    const strategyId = await seedStrategy(workspaceId, 'Liquidity Sweep');
    await seedSetup(workspaceId, strategyId, 'Sweep and Reclaim', 0);
    await seedSetup(workspaceId, strategyId, 'Range Break', 1);

    await loginAs(page, 'en', user);
    await page.goto(`/en/app/strategies?strategy=${strategyId}`);
    const detail = detailRegion(page, 'Liquidity Sweep');
    await expect(detail).toBeVisible();

    // With zero Rules anywhere in the Strategy yet, the per-Setup groups
    // are not rendered at all — only the Strategy-wide empty state is
    // (`rules-manager.tsx` shows one `EmptyState` when `totalRuleCount ===
    // 0`, not an empty group per Setup).
    await expect(page.getByText('No rules yet', { exact: true })).toBeVisible();

    // Create a Rule scoped to "Sweep and Reclaim" only.
    await page.getByRole('button', { name: 'New rule' }).click();
    await page.getByLabel('Scope').selectOption({ label: 'Sweep and Reclaim' });
    await page.getByLabel('Category').selectOption({ label: 'Invalidation' });
    await page.getByLabel('Rule title').fill('Wait for a swept-liquidity reclaim close');
    await page.getByLabel('Pre-trade check').check();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Grouped beneath the correct Setup — never under the other Setup or
    // the Strategy-level group.
    const sweepGroup = ruleGroup(page, 'Sweep and Reclaim');
    await expect(sweepGroup.getByText('Wait for a swept-liquidity reclaim close')).toBeVisible();
    await expect(sweepGroup.getByText('Invalidation', { exact: true })).toBeVisible();
    await expect(sweepGroup.getByText('Pre-trade check')).toBeVisible();
    // No internal Rule row id is ever rendered.
    expect(await sweepGroup.innerText()).not.toMatch(UUID_PATTERN);

    const rangeBreakGroup = ruleGroup(page, 'Range Break');
    await expect(rangeBreakGroup.getByText('Wait for a swept-liquidity reclaim close')).toHaveCount(
      0,
    );
    await expect(rangeBreakGroup.getByText('No rules yet.')).toBeVisible();
    await expect(page.getByText('No rules yet', { exact: true })).toHaveCount(0);

    // Edit it.
    await page
      .getByRole('button', { name: 'Edit rule: Wait for a swept-liquidity reclaim close' })
      .click();
    await page.getByLabel('Rule title').fill('Wait for a confirmed swept-liquidity reclaim close');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      sweepGroup.getByText('Wait for a confirmed swept-liquidity reclaim close'),
    ).toBeVisible();

    // Remove it — no hard-delete wording, history is retained.
    await page
      .getByRole('button', {
        name: 'Remove rule: Wait for a confirmed swept-liquidity reclaim close',
      })
      .click();
    await expect(page.getByRole('alertdialog')).toContainText('retain their historical copy');
    await expect(page.getByRole('alertdialog')).not.toContainText(/delete/i);
    await page.getByRole('button', { name: 'Remove rule', exact: true }).click();
    await expect(page.getByText('Wait for a confirmed swept-liquidity reclaim close')).toHaveCount(
      0,
    );
    // Back to zero Rules anywhere in the Strategy — the Strategy-wide empty
    // state again, not a per-Setup "No rules yet." group.
    await expect(page.getByText('No rules yet', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(0);
  });

  test('locked-Version copy-on-write: editing requires a change note and creates the next Version', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-locked');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');

    await page.getByRole('button', { name: 'New strategy' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Breakout and Retest');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\?strategy=/);
    const url = new URL(page.url());
    const strategyId = url.searchParams.get('strategy');
    if (strategyId === null) throw new Error('expected a ?strategy= id after create');
    const detail = detailRegion(page, 'Breakout and Retest');

    await lockCurrentVersion(strategyId);
    await page.reload();
    await expect(page.getByText('Locked version')).toBeVisible();

    // Editing a locked Version requires a Change note and explains the
    // consequence before submission.
    await detail.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText(/version is locked/i)).toBeVisible();
    await page.getByLabel('Description').fill('Range break, then a retest of the broken level.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('This field is required.')).toBeVisible();
    await page.getByLabel('Change note').fill('Clarified the retest condition.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Saving created Version 2 — current, editable, with the old Version's
    // history retained.
    await expect(detail.getByText('Current version 2')).toBeVisible();
    // The current-Version badge, not the (still-collapsed) history entry
    // for the same Version further down — the badge renders first in DOM
    // order.
    await expect(page.getByText('Editable version').first()).toBeVisible();
    await page.getByText(/2 versions/).click();
    await expect(page.getByText('Clarified the retest condition.')).toBeVisible();
    await expect(page.getByText('Version 1')).toBeVisible();

    // Creating a Setup on the now-unlocked Version 2 needs no change note.
    await page.getByRole('button', { name: 'New setup' }).click();
    await expect(page.getByLabel('Change note')).toHaveCount(0);
    await page.getByLabel('Name', { exact: true }).fill('Retest Entry');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Retest Entry' })).toBeVisible();
    await expect(detail.getByText('Current version 2')).toBeVisible();

    // Lock Version 2; editing the Setup now creates Version 3.
    await lockCurrentVersion(strategyId);
    await page.reload();
    await strategyRegion(page, 'Retest Entry').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText(/version is locked/i)).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Retest Entry (Refined)');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('This field is required.')).toBeVisible();
    await page.getByLabel('Change note').fill('Tightened the entry trigger.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.getByText('Current version 3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Retest Entry (Refined)' })).toBeVisible();

    // No stale Version id was sent from the client: the strategy id in the
    // URL never changed even though the current Version did.
    const finalUrl = new URL(page.url());
    expect(finalUrl.searchParams.get('strategy')).toBe(strategyId);
  });

  test('read-only workspace: existing Strategies remain readable, but mutations are disabled with a visible reason', async ({
    page,
  }) => {
    const user = await provisionReadOnlyUser('e2e-strategies-readonly');
    const workspaceId = await resolveWorkspaceId(user.id);
    await seedStrategy(workspaceId, 'Trend Following');

    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');
    await expect(page.getByRole('heading', { level: 1, name: 'Strategies' })).toBeVisible();
    // Reads work under read_only: the seeded Strategy is listed and selectable.
    await expect(page.getByRole('link', { name: /Trend Following/ })).toBeVisible();
    await page.getByRole('link', { name: /Trend Following/ }).click();
    const detail = detailRegion(page, 'Trend Following');
    await expect(detail).toBeVisible();
    await expect(
      page
        .getByText(
          'This workspace is read-only. Restore valid subscription access before making changes.',
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'New strategy' }).first()).toHaveCount(0);
  });

  test('over-limit workspace: Strategy mutations are disabled with a visible reason', async ({
    page,
  }) => {
    const user = await provisionOverLimitUser('e2e-strategies-overlimit');
    const workspaceId = await resolveWorkspaceId(user.id);
    await seedStrategy(workspaceId, 'Liquidity Sweep Over Limit');

    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');
    await expect(page.getByRole('link', { name: /Liquidity Sweep Over Limit/ })).toBeVisible();
    await page.getByRole('link', { name: /Liquidity Sweep Over Limit/ }).click();
    await expect(detailRegion(page, 'Liquidity Sweep Over Limit')).toBeVisible();
    await expect(
      page
        .getByText(
          'This workspace is over its active-account limit. Archive an active account before making other changes.',
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });

  test('rapid double-submit on create creates exactly one Strategy', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-strategies-doubleclick');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');

    await page.getByRole('button', { name: 'New strategy' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Double Click Strategy');

    const createButton = page.getByRole('button', { name: 'Create', exact: true });
    await createButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    await expect(page).toHaveURL(/\?strategy=/, { timeout: 10000 });
    await expect(detailRegion(page, 'Double Click Strategy')).toBeVisible();

    const workspaceId = await resolveWorkspaceId(user.id);
    expect(await countStrategies(workspaceId)).toBe(1);
  });

  test('is keyboard operable: create dialog and archive confirmation', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-strategies-keyboard');
    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');

    await page.getByRole('button', { name: 'New strategy' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Re-open via keyboard and submit for real this time.
    await page.getByRole('button', { name: 'New strategy' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Keyboard Strategy');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\?strategy=/);

    await page.getByRole('button', { name: 'Archive', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('the strategy-management page has no horizontal overflow and keeps 44px touch targets at a mobile viewport', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-strategies-mobile');
    await page.setViewportSize({ width: 320, height: 800 });
    await loginAs(page, 'en', user);
    await page.goto('/en/app/strategies');
    await expect(page.getByRole('heading', { level: 1, name: 'Strategies' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const createButton = await page
      .getByRole('button', { name: 'New strategy' })
      .first()
      .boundingBox();
    expect(createButton?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Create a Strategy, then confirm the mobile master-detail swap: the
    // list is replaced by the detail panel plus a back control, in one
    // column, with no overflow.
    await page.getByRole('button', { name: 'New strategy' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Mobile Strategy');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\?strategy=/);
    await expect(page.getByRole('button', { name: /Back to strategies/ })).toBeVisible();
    const scrollWidthAfter = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidthAfter).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('completes the create/edit flow in Thai with correct terminology', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-strategies-th');
    await loginAs(page, 'th', user);
    await page.goto('/th/app/strategies');
    await expect(page.getByRole('heading', { level: 1, name: 'กลยุทธ์' })).toBeVisible();

    await page.getByRole('button', { name: 'กลยุทธ์ใหม่' }).first().click();
    await expect(page.getByRole('heading', { name: 'สร้างกลยุทธ์' })).toBeVisible();
    await page.getByLabel('ชื่อ', { exact: true }).fill('กลยุทธ์ทดสอบ');
    await page.getByRole('button', { name: 'สร้าง', exact: true }).click();

    await expect(page).toHaveURL(/\?strategy=/);
    const detail = detailRegion(page, 'กลยุทธ์ทดสอบ');
    await expect(detail).toBeVisible();
    await expect(detail.getByText('เวอร์ชันปัจจุบัน 1')).toBeVisible();
    await expect(page.getByText('เวอร์ชันที่แก้ไขได้')).toBeVisible();
  });
});
