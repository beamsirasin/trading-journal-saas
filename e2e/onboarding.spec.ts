import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { tradingAccounts, workspaces } from '../src/server/db/schema';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * Phase 3A onboarding — deterministic database fixtures only, never Mailpit
 * (every user here is provisioned pre-verified via `provisionVerifiedUser`,
 * the same bypass `e2e/global-setup.ts` already relies on).
 *
 * A fresh, uniquely-emailed user per test rather than one shared fixture:
 * `playwright.config.ts` sets `fullyParallel: true`, so two onboarding tests
 * can run concurrently — a single shared "not yet onboarded" identity would
 * let them race each other's onboarding-completion state.
 */
const VALID_TEST_PASSWORD = 'Correct-Horse9!';

async function provisionPendingOnboardingUser(labelPrefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${labelPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  return provisionVerifiedUser(
    testUrl,
    { email, password: VALID_TEST_PASSWORD, name: 'E2E Onboarding Tester' },
    { onboarded: false },
  );
}

/** Direct DB read for assertions no page ever exposes verbatim (e.g. "exactly one row exists"). */
async function countTradingAccountsForUser(userId: string): Promise<number> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema: { tradingAccounts, workspaces } });
    const workspaceRows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    const workspaceId = workspaceRows[0]?.id;
    if (workspaceId === undefined) return 0;
    const accountRows = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    return accountRows.length;
  } finally {
    await client.end();
  }
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

test.describe('onboarding', () => {
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  test('an unauthenticated visitor is redirected to localized login', async ({ page }) => {
    await page.goto('/en/app/onboarding');
    await expect(page).toHaveURL(/\/en\/login/);

    await page.goto('/th/app/onboarding');
    await expect(page).toHaveURL(/\/th\/login/);
  });

  test('completes the full onboarding flow in English: redirect, both steps, back-preserves-values, finish, real dashboard, and survives a reload', async ({
    page,
  }) => {
    const user = await provisionPendingOnboardingUser('e2e-onboarding-en');

    await loginAs(page, 'en', user);
    await expect(page).toHaveURL(/\/en\/app\/onboarding$/);

    // Step 1 renders.
    await expect(page.getByRole('heading', { name: 'Your trading setup' })).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toBeVisible();

    // Continue validation: blocks on an empty name.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter a trading account name.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your trading setup' })).toBeVisible();

    await page.getByLabel('Trading account name').fill('My First Account');
    await page.getByLabel('Broker', { exact: false }).fill('Interactive Brokers');
    await page.getByLabel('Starting balance').fill('10000');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2 renders.
    await expect(page.getByRole('heading', { name: 'Risk preferences' })).toBeVisible();

    // Back preserves step-one values.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Trading account name')).toHaveValue('My First Account');
    await expect(page.getByLabel('Broker', { exact: false })).toHaveValue('Interactive Brokers');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('button', { name: 'Finish' }).click();

    // Completion redirects to /app.
    await expect(page).toHaveURL(/\/en\/app$/);

    // Active account is visible, with no fabricated performance metrics.
    await expect(page.getByText('My First Account').first()).toBeVisible();
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('USD', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('No trades recorded yet')).toBeVisible();
    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/win rate|expectancy|profit factor|net p&l/i);

    // Returning user does not see onboarding again.
    await page.reload();
    await expect(page).toHaveURL(/\/en\/app$/);
    await expect(page.getByText('My First Account').first()).toBeVisible();

    const accountCount = await countTradingAccountsForUser(user.id);
    expect(accountCount).toBe(1);
  });

  test('completes the full onboarding flow in Thai', async ({ page }) => {
    const user = await provisionPendingOnboardingUser('e2e-onboarding-th');

    await loginAs(page, 'th', user);
    await expect(page).toHaveURL(/\/th\/app\/onboarding$/);

    await expect(page.getByRole('heading', { name: 'การตั้งค่าการเทรดของคุณ' })).toBeVisible();

    await page.getByLabel('ชื่อบัญชีเทรด').fill('บัญชีแรกของฉัน');
    await page.getByLabel('ยอดเงินเริ่มต้น').fill('10000');
    await page.getByRole('button', { name: 'ถัดไป' }).click();

    await expect(page.getByRole('heading', { name: 'การตั้งค่าความเสี่ยง' })).toBeVisible();
    await page.getByRole('button', { name: 'เสร็จสิ้น' }).click();

    await expect(page).toHaveURL(/\/th\/app$/);
    await expect(page.getByText('บัญชีแรกของฉัน').first()).toBeVisible();
    await expect(page.getByText('ยังไม่มีการบันทึกเทรด')).toBeVisible();
  });

  test('a double-click on Finish creates exactly one trading account', async ({ page }) => {
    const user = await provisionPendingOnboardingUser('e2e-onboarding-doubleclick');

    await loginAs(page, 'en', user);
    await expect(page).toHaveURL(/\/en\/app\/onboarding$/);

    await page.getByLabel('Trading account name').fill('Double Click Account');
    await page.getByLabel('Starting balance').fill('5000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Risk preferences' })).toBeVisible();

    const finishButton = page.getByRole('button', { name: 'Finish' });
    await Promise.all([finishButton.click(), finishButton.click({ force: true }).catch(() => {})]);

    await expect(page).toHaveURL(/\/en\/app$/);
    const accountCount = await countTradingAccountsForUser(user.id);
    expect(accountCount).toBe(1);
  });

  test('is fully keyboard operable', async ({ page }) => {
    const user = await provisionPendingOnboardingUser('e2e-onboarding-keyboard');

    await loginAs(page, 'en', user);
    await expect(page).toHaveURL(/\/en\/app\/onboarding$/);

    await page.getByLabel('Trading account name').fill('Keyboard Account');
    await page.getByLabel('Starting balance').fill('2500');
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Risk preferences' })).toBeVisible();
    // Focus moved to the new step heading — an accessible signal the step
    // actually changed, not just that time passed.
    await expect(page.getByRole('heading', { name: 'Risk preferences' })).toBeFocused();

    await page.getByRole('button', { name: 'Finish' }).focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/en\/app$/);
  });

  test('the onboarding page has no horizontal overflow and keeps 44px touch targets at a mobile viewport', async ({
    page,
  }) => {
    const user = await provisionPendingOnboardingUser('e2e-onboarding-mobile');
    await page.setViewportSize({ width: 375, height: 812 });

    await loginAs(page, 'en', user);
    await expect(page).toHaveURL(/\/en\/app\/onboarding$/);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const continueButton = await page.getByRole('button', { name: 'Continue' }).boundingBox();
    expect(continueButton?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
