import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { tradingAccounts, workspaces } from '../src/server/db/schema';
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

async function provisionOnboardedUser(labelPrefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${labelPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(
    testUrl,
    { email, password: VALID_TEST_PASSWORD, name: 'E2E Accounts Tester' },
    { onboarded: true },
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

async function loginAs(
  page: Page,
  locale: 'en' | 'th',
  user: { email: string; password: string },
): Promise<void> {
  await page.goto(`/${locale}/login`);
  await page.getByLabel(locale === 'en' ? 'Email' : 'อีเมล').fill(user.email);
  await page
    .getByLabel(locale === 'en' ? 'Password' : 'รหัสผ่าน', { exact: true })
    .fill(user.password);
  await page.getByRole('button', { name: locale === 'en' ? 'Log in' : 'เข้าสู่ระบบ' }).click();
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
    await expect(page.getByText('Main Trading Account')).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

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
    await expect(page.getByText('Account created.')).toBeVisible();
    await expect(page.getByText('Second Account')).toBeVisible();

    // The original account remains active.
    const mainCard = page.locator('li', { hasText: 'Main Trading Account' });
    await expect(mainCard.getByText('Active', { exact: true })).toBeVisible();

    // Edit the second account.
    const secondCard = page.locator('li', { hasText: 'Second Account' });
    await secondCard.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit trading account' })).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toHaveValue('Second Account');
    await page.getByLabel('Trading account name').fill('Second Account Renamed');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/en\/app\/accounts\?status=updated$/);
    await expect(page.getByText('Account updated.')).toBeVisible();

    // Set the renamed account active.
    const renamedCard = page.locator('li', { hasText: 'Second Account Renamed' });
    await renamedCard.getByRole('button', { name: 'Set as active' }).click();
    await expect(page.getByText('Active account changed.')).toBeVisible();
    await expect(renamedCard.getByText('Active', { exact: true })).toBeVisible();

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

  test('archive confirmation, archiving the active account chooses a fallback, and the final account cannot be archived', async ({
    page,
  }) => {
    const user = await provisionOnboardedUser('e2e-accounts-archive');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await page.getByRole('link', { name: 'Create account' }).click();
    await page.getByLabel('Trading account name').fill('Second Account');
    await page.getByLabel('Starting balance').fill('1000');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/status=created$/);

    // Archive the non-active account: requires confirmation.
    const secondCard = page.locator('li', { hasText: 'Second Account' });
    await secondCard.getByRole('button', { name: 'Archive' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Archive Second Account?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await secondCard.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive account' }).click();
    await expect(page.getByText('Account archived.')).toBeVisible();

    // It disappears from the switcher and from the active section, and
    // appears in the archived section.
    await page.getByRole('button', { name: 'Switch trading account' }).click();
    await expect(page.getByRole('menuitem', { name: /Second Account/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Archived accounts' })).toBeVisible();
    const archivedSection = page.getByRole('list', { name: 'Archived accounts' });
    await expect(archivedSection.getByText('Second Account')).toBeVisible();

    // Archive the active (main) account: the only remaining non-archived
    // account is deterministically activated.
    const mainCard = page.locator('li', { hasText: 'Main Trading Account' });
    await mainCard.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive account' }).click();
    await expect(page.getByText('Account archived.')).toBeVisible();

    // Restore the archived "Second Account" and confirm it can be selected.
    const restoredRow = page.getByRole('list', { name: 'Archived accounts' }).locator('li');
    await restoredRow
      .filter({ hasText: 'Second Account' })
      .getByRole('button', { name: 'Restore' })
      .click();
    await expect(page.getByText('Account restored.')).toBeVisible();

    const restoredCard = page.locator('li', { hasText: 'Second Account' }).first();
    await restoredCard.getByRole('button', { name: 'Set as active' }).click();
    await expect(page.getByText('Active account changed.')).toBeVisible();

    // Attempting to archive the only usable account is blocked.
    const onlyCard = page.locator('li', { hasText: 'Second Account' }).first();
    await onlyCard.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive account' }).click();
    await expect(
      page.getByText(
        'You cannot archive your last trading account. Create another trading account first.',
      ),
    ).toBeVisible();

    const workspaceId = await getWorkspaceId(user.id);
    expect(await countAccounts(workspaceId)).toBe(2);
  });

  test('rapid double-submit on create creates exactly one account', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-accounts-doubleclick');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts/new');
    await page.getByLabel('Trading account name').fill('Double Click Account');
    await page.getByLabel('Starting balance').fill('500');

    const createButton = page.getByRole('button', { name: 'Create account' });
    await createButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    await expect(page).toHaveURL(/status=created$/, { timeout: 10000 });
    const workspaceId = await getWorkspaceId(user.id);
    // The seed account plus exactly one new one — never two.
    expect(await countAccounts(workspaceId)).toBe(2);
  });

  test('is keyboard operable: switcher and archive dialog', async ({ page }) => {
    const user = await provisionOnboardedUser('e2e-accounts-keyboard');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await page.getByRole('link', { name: 'Create account' }).click();
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
    const secondCard = page.locator('li', { hasText: 'Second Account' });
    await secondCard.getByRole('button', { name: 'Archive' }).focus();
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
    await expect(page.locator('[data-kpi]')).toHaveCount(0);
    await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
    await expect(page.getByText('Starting balance', { exact: true }).first()).toBeVisible();
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
    await expect(page.getByText('สร้างบัญชีเรียบร้อยแล้ว')).toBeVisible();

    const secondCard = page.locator('li', { hasText: 'บัญชีที่สอง' });
    await secondCard.getByRole('button', { name: 'ตั้งเป็นบัญชีที่ใช้งาน' }).click();
    await expect(page.getByText('เปลี่ยนบัญชีที่ใช้งานเรียบร้อยแล้ว')).toBeVisible();

    await page.goto('/th/app');
    await expect(
      page.getByRole('region', { name: 'สรุปบัญชีเทรดที่ใช้งานอยู่' }).getByRole('heading', {
        name: 'บัญชีที่สอง',
      }),
    ).toBeVisible();
  });
});
