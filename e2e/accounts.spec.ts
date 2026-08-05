import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { tradingAccounts, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * Phase 3B account management — deterministic database fixtures only, never
 * Mailpit (same bypass `e2e/onboarding.spec.ts` already established). Every
 * test provisions its OWN fresh, already-onboarded user (one seed account,
 * `provisionVerifiedUser`'s default) rather than the shared
 * `E2E_USER_A`/`E2E_USER_B` fixtures — those are reused across many other
 * spec files, and this suite's archive/restore/activate mutations must
 * never bleed into their state. `playwright.config.ts`'s `fullyParallel:
 * true` is the same reason a fresh identity is used per test rather than
 * one shared "onboarded" fixture racing itself.
 */
const VALID_TEST_PASSWORD = 'Correct-Horse9!';

/**
 * Every test in this suite creates a second (and sometimes third) trading
 * account through the UI — Phase 3C's trial is fixed at exactly 1 active
 * account (CLAUDE.md A4), so a Trial fixture would fail closed the moment
 * any of these scenarios tries to create beyond the seed account. None of
 * these tests exercise trial/limit behavior itself (that's
 * `e2e/entitlements.spec.ts`'s job) — they need headroom, so they provision
 * an explicit, real, active Trader entitlement (limit 5), which comfortably
 * covers the at-most-three accounts any single test here creates.
 */
async function provisionOnboardedUser(labelPrefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  // `test.info().project.name` (chromium/mobile-chrome) is folded in purely
  // for debuggability when inspecting the disposable test database — the
  // timestamp + random suffix alone already guarantees uniqueness.
  const projectName = test.info().project.name;
  const email = `${labelPrefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(
    testUrl,
    { email, password: VALID_TEST_PASSWORD, name: 'E2E Accounts Tester' },
    {
      onboarded: true,
      entitlement: { status: 'active', planKey: 'trader', trialEndsAt: null },
    },
  );
}

async function withDb<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema: { tradingAccounts, workspaces } });
    return await fn(db);
  } finally {
    await client.end();
  }
}

async function getWorkspaceId(userId: string): Promise<string> {
  return withDb(async (db) => {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no workspace found for user ${userId}`);
    return id;
  });
}

async function countAccounts(workspaceId: string): Promise<number> {
  return withDb(async (db) => {
    const rows = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    return rows.length;
  });
}

/**
 * Every account card (active or archived) is its own accessible region,
 * `aria-labelledby` the card's own heading — whose text is the account's
 * name (`src/components/trading-accounts/accounts-manager.tsx`). Scoping to
 * this region is what distinguishes an account's card from the SAME name
 * appearing again in the app-shell switcher trigger (`hidden sm:flex` on
 * mobile, otherwise visible) — an unscoped `getByText`/`.first()` can
 * silently resolve to either, which is exactly the class of bug this file
 * was previously written with.
 */
function accountRegion(page: Page, name: string): Locator {
  return page.getByRole('region', { name });
}

async function expectAccountActive(page: Page, name: string): Promise<void> {
  await expect(accountRegion(page, name).getByRole('heading', { name })).toBeVisible();
  await expect(
    accountRegion(page, name).getByText('Current account', { exact: true }),
  ).toBeVisible();
}

async function expectAccountNotActive(page: Page, name: string): Promise<void> {
  await expect(accountRegion(page, name).getByRole('heading', { name })).toBeVisible();
  await expect(accountRegion(page, name).getByText('Current account', { exact: true })).toHaveCount(
    0,
  );
}

async function expectArchived(page: Page, name: string): Promise<void> {
  const archivedSection = page.getByRole('list', { name: 'Archived accounts' });
  await expect(archivedSection.getByRole('heading', { name })).toBeVisible();
}

test.describe('trading account management', () => {
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  test('an unauthenticated visitor is redirected to localized login', async ({ page }) => {
    await page.goto('/en/app/accounts');
    await expect(page).toHaveURL(/\/en\/login/);

    await page.goto('/th/app/accounts');
    await expect(page).toHaveURL(/\/th\/login/);
  });

  test('shows the seed account as active, creates a second without activating it, edits it, sets it active, and the dashboard/switcher reflect the change after a refresh', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-accounts-en');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading accounts' })).toBeVisible();
    await expectAccountActive(page, 'Main Trading Account');

    // Create a second account without activating it.
    await page.getByRole('link', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Create trading account' })).toBeVisible();

    // Validation: blocks on an empty name.
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter a trading account name.')).toBeVisible();

    await page.getByLabel('Trading account name').fill('Second Account');
    await page.getByLabel('Broker', { exact: false }).fill('Interactive Brokers');
    await page.getByLabel('Starting balance').fill('2500');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/en\/app\/accounts\?status=created$/);
    await expectAccountNotActive(page, 'Second Account');
    // The original account remains active.
    await expectAccountActive(page, 'Main Trading Account');

    // Edit the second account.
    await accountRegion(page, 'Second Account').getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit trading account' })).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toHaveValue('Second Account');
    await page.getByLabel('Trading account name').fill('Second Account Renamed');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/en\/app\/accounts\?status=updated$/);
    await expect(
      accountRegion(page, 'Second Account Renamed').getByRole('heading', {
        name: 'Second Account Renamed',
      }),
    ).toBeVisible();

    // Set the renamed account active — asserted via the real, refreshed DOM
    // state (both cards' status), not the (client-state, not reset by
    // `router.refresh()`) success toast alone.
    await accountRegion(page, 'Second Account Renamed')
      .getByRole('button', { name: 'Set as active' })
      .click();
    await expectAccountActive(page, 'Second Account Renamed');
    await expectAccountNotActive(page, 'Main Trading Account');

    // The dashboard reflects the newly active account.
    await page.goto('/en/app');
    await expect(
      page.getByRole('region', { name: 'Active trading account summary' }).getByRole('heading', {
        name: 'Second Account Renamed',
      }),
    ).toBeVisible();

    // Refresh preserves the selection.
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Active trading account summary' }).getByRole('heading', {
        name: 'Second Account Renamed',
      }),
    ).toBeVisible();

    // The app-shell switcher reflects it too.
    await page.getByRole('button', { name: 'Switch trading account' }).click();
    await expect(page.getByRole('menuitem', { name: /Second Account Renamed/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await page.keyboard.press('Escape');

    // Switch back using the app-shell switcher.
    await page.getByRole('button', { name: 'Switch trading account' }).click();
    await page.getByRole('menuitem', { name: /Main Trading Account/ }).click();
    await expect(page.getByText('No trades recorded yet')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Active trading account summary' }).getByRole('heading', {
        name: 'Main Trading Account',
      }),
    ).toBeVisible();
  });

  test('archive confirmation, archiving the active account chooses a fallback, restore, and the final account cannot be archived', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-accounts-archive');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading accounts' })).toBeVisible();

    // Create "Second Account" (inactive). Two usable accounts now exist.
    await page.getByRole('link', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Create trading account' })).toBeVisible();
    await page.getByLabel('Trading account name').fill('Second Account');
    await page.getByLabel('Starting balance').fill('1000');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/status=created$/);
    await expectAccountNotActive(page, 'Second Account');

    // Archive confirmation is required: opening the dialog and cancelling
    // must not archive anything.
    const secondRegion = accountRegion(page, 'Second Account');
    await secondRegion.getByRole('button', { name: 'Archive' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Archive Second Account?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(secondRegion.getByRole('heading', { name: 'Second Account' })).toBeVisible();

    // Archive the non-active account for real.
    await secondRegion.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive account' }).click();
    await expect(page.getByRole('heading', { name: 'Archived accounts' })).toBeVisible();
    await expectArchived(page, 'Second Account');
    // Still active, still the only usable account left on screen right now.
    await expectAccountActive(page, 'Main Trading Account');

    // It disappears from the switcher.
    await page.getByRole('button', { name: 'Switch trading account' }).click();
    await expect(page.getByRole('menuitem', { name: /Second Account/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Create "Third Account" so archiving the active account below has a
    // real fallback candidate — Second Account is already archived, so
    // without a third account Main would be the LAST usable one, and
    // archiving it would correctly be rejected instead of falling back.
    await page.getByRole('link', { name: 'Create account' }).click();
    await page.getByLabel('Trading account name').fill('Third Account');
    await page.getByLabel('Starting balance').fill('750');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/status=created$/);
    await expectAccountNotActive(page, 'Third Account');

    // Archive the active (main) account: the deterministic (oldest
    // remaining) fallback — "Third Account" — becomes active atomically.
    await accountRegion(page, 'Main Trading Account')
      .getByRole('button', { name: 'Archive' })
      .click();
    await page.getByRole('button', { name: 'Archive account' }).click();
    await expectArchived(page, 'Main Trading Account');
    await expectAccountActive(page, 'Third Account');

    // The final usable account cannot be archived.
    await accountRegion(page, 'Third Account').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive account' }).click();
    await expect(
      page.getByText(
        'You cannot archive your last trading account. Create another trading account first.',
      ),
    ).toBeVisible();
    // No partial write: Third remains active and non-archived.
    await expectAccountActive(page, 'Third Account');

    // Restore "Main Trading Account" — it does not automatically become
    // active (Third remains active) per the restore contract.
    const archivedSection = page.getByRole('list', { name: 'Archived accounts' });
    await archivedSection
      .getByRole('region', { name: 'Main Trading Account' })
      .getByRole('button', { name: 'Restore' })
      .click();
    await expectAccountNotActive(page, 'Main Trading Account');
    await expectAccountActive(page, 'Third Account');

    // Explicitly setting it active works.
    await accountRegion(page, 'Main Trading Account')
      .getByRole('button', { name: 'Set as active' })
      .click();
    await expectAccountActive(page, 'Main Trading Account');
    await expectAccountNotActive(page, 'Third Account');

    const workspaceId = await getWorkspaceId(user.id);
    // Main, Second (archived), Third — three accounts total, none lost.
    expect(await countAccounts(workspaceId)).toBe(3);
  });

  test('rapid double-submit on create creates exactly one account', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-accounts-doubleclick');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts/new');
    await expect(page.getByRole('heading', { name: 'Create trading account' })).toBeVisible();
    await page.getByLabel('Trading account name').fill('Double Click Account');
    await page.getByLabel('Starting balance').fill('500');

    // Two sequential `locator.click()` calls never actually race — Playwright
    // waits for the first click's actionability and resulting navigation
    // before dispatching the second, by which point the button is already
    // gone. Firing two native `.click()` calls from a single `evaluate`
    // executes them back-to-back in one browser task, before React's
    // `status === 'pending'` guard has re-rendered the button as disabled —
    // the same race a genuine double-click or duplicate network request
    // would produce. The server-side `(workspace_id, mutation_key)` unique
    // index, not this client-side guard, is what must make the outcome safe.
    const createButton = page.getByRole('button', { name: 'Create account' });
    await createButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    await expect(page).toHaveURL(/\/en\/app\/accounts\?status=created$/, { timeout: 10000 });
    await expectAccountNotActive(page, 'Double Click Account');
    // No duplicate card for the same account.
    await expect(page.getByRole('region', { name: 'Double Click Account' })).toHaveCount(1);

    const workspaceId = await getWorkspaceId(user.id);
    // The seed account plus exactly one new one — never two.
    expect(await countAccounts(workspaceId)).toBe(2);
  });

  test('is keyboard operable: switcher and archive dialog', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-accounts-keyboard');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading accounts' })).toBeVisible();
    await page.getByRole('link', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Create trading account' })).toBeVisible();
    await page.getByLabel('Trading account name').fill('Second Account');
    await page.getByLabel('Starting balance').fill('1000');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/status=created$/);

    // Keyboard: open the switcher, reach an item, close with Escape.
    await page.getByRole('button', { name: 'Switch trading account' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: /Second Account/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Keyboard: open the archive confirmation and cancel with Escape.
    await accountRegion(page, 'Second Account').getByRole('button', { name: 'Archive' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('the account-management page has no horizontal overflow and keeps 44px touch targets at a mobile viewport', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-accounts-mobile');
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading accounts' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const createButton = await page.getByRole('link', { name: 'Create account' }).boundingBox();
    expect(createButton?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('shows no fabricated metrics or charts anywhere on the account-management page', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-accounts-no-fake-metrics');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading accounts' })).toBeVisible();
    await expect(page.locator('[data-kpi]')).toHaveCount(0);
    await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
    await expect(
      accountRegion(page, 'Main Trading Account').getByText('Starting balance', { exact: true }),
    ).toBeVisible();
  });

  test('completes the create/edit/set-active flow in Thai', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-accounts-th');
    await loginAs(page, 'th', user);

    await page.goto('/th/app/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'บัญชีเทรด' })).toBeVisible();

    await page.getByRole('link', { name: 'สร้างบัญชี' }).click();
    await expect(page.getByRole('heading', { name: 'สร้างบัญชีเทรด' })).toBeVisible();
    await page.getByLabel('ชื่อบัญชีเทรด').fill('บัญชีที่สอง');
    await page.getByLabel('ยอดเงินเริ่มต้น').fill('1000');
    await page.getByRole('button', { name: 'สร้างบัญชี' }).click();

    await expect(page).toHaveURL(/status=created$/);
    await expect(
      accountRegion(page, 'บัญชีที่สอง').getByRole('heading', { name: 'บัญชีที่สอง' }),
    ).toBeVisible();

    await accountRegion(page, 'บัญชีที่สอง')
      .getByRole('button', { name: 'ตั้งเป็นบัญชีที่ใช้งาน' })
      .click();
    await expect(
      accountRegion(page, 'บัญชีที่สอง').getByText('บัญชีที่กำลังใช้งาน', { exact: true }),
    ).toBeVisible();

    await page.goto('/th/app');
    await expect(
      page.getByRole('region', { name: 'สรุปบัญชีเทรดที่ใช้งานอยู่' }).getByRole('heading', {
        name: 'บัญชีที่สอง',
      }),
    ).toBeVisible();
  });
});
