import { expect, test, type Page } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * Phase 3C trial entitlements and account limits — deterministic database
 * fixtures only (`provisionVerifiedUser`'s `entitlement`/`additionalAccounts`
 * options), never a mocked clock or a real 7-day wait. Every test provisions
 * its own fresh user, matching `e2e/accounts.spec.ts`'s own reasoning: this
 * suite's create/archive/restore mutations must never bleed into another
 * test's state under Playwright's `fullyParallel: true`.
 */
const VALID_TEST_PASSWORD = 'Correct-Horse9!';

function uniqueEmail(labelPrefix: string): string {
  return `${labelPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function provisionUser(
  labelPrefix: string,
  options: Parameters<typeof provisionVerifiedUser>[2] = {},
) {
  const { testUrl } = validateTestDatabaseEnvironment();
  return provisionVerifiedUser(
    testUrl,
    {
      email: uniqueEmail(labelPrefix),
      password: VALID_TEST_PASSWORD,
      name: 'E2E Entitlements Tester',
    },
    { onboarded: true, ...options },
  );
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
  await page.waitForURL(new RegExp(`/${locale}/app(?:[/?]|$)`), { timeout: 15000 });
}

async function createAccountViaUI(page: Page, name: string): Promise<void> {
  await page.goto('/en/app/accounts/new');
  await page.getByLabel('Trading account name').fill(name);
  await page.getByLabel('Starting balance').fill('1000');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/status=created$/);
}

test.describe('trial entitlements and account limits', () => {
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  test('shows the trial banner with days remaining and account usage after onboarding', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-banner');
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    const banner = page.getByRole('region', { name: 'Trial status' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Free trial');
    await expect(banner).toContainText('days remaining');
    await expect(banner.getByRole('link', { name: 'View plans' })).toBeVisible();
  });

  test('account usage starts at 1/10 during the trial and reaches the limit at 10', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-limit');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('1 of 10 trading accounts used')).toBeVisible();

    for (let i = 2; i <= 10; i += 1) {
      await createAccountViaUI(page, `Account ${i}`);
    }

    await page.goto('/en/app/accounts');
    await expect(page.getByText('10 of 10 trading accounts used')).toBeVisible();
    await expect(page.getByText('Account limit reached')).toBeVisible();

    // The Create button is now disabled with an explanation, and a direct
    // submission to /app/accounts/new is rejected server-side rather than
    // merely hidden client-side.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    await page.goto('/en/app/accounts/new');
    await expect(page.getByText('Create unavailable')).toBeVisible();
    await expect(
      page.getByText("You've used all the trading accounts your plan allows."),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to accounts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View plans' })).toBeVisible();
    // No form is rendered at all — nothing to submit.
    await expect(page.getByLabel('Trading account name')).toHaveCount(0);
  });

  test('archiving an account below the limit makes Create available again', async ({ page }) => {
    const user = await provisionUser('e2e-entitlements-archive-frees-slot', {
      additionalAccounts: 9,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('10 of 10 trading accounts used')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    await page
      .getByRole('region', { name: 'Additional Account 1' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await page.getByRole('button', { name: 'Archive account' }).click();

    await expect(page.getByText('9 of 10 trading accounts used')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();

    await createAccountViaUI(page, 'Freshly Allowed Account');
    await expect(page.getByRole('region', { name: 'Freshly Allowed Account' })).toBeVisible();
  });

  test('restoring an archived account is blocked once it would exceed the limit', async ({
    page,
  }) => {
    // Starter plan (limit 1), already at its limit with the seed account —
    // an archived second account exists but restoring it would push the
    // workspace to 2 active accounts, over the plan's allowance.
    const user = await provisionUser('e2e-entitlements-restore-blocked', {
      entitlement: { status: 'active', planKey: 'starter', trialEndsAt: null },
      additionalArchivedAccounts: 1,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('1 of 1 trading accounts used')).toBeVisible();

    const archivedRegion = page.getByRole('region', { name: 'Archived Account 1' });
    await expect(archivedRegion).toBeVisible();
    await expect(archivedRegion.getByRole('button', { name: 'Restore' })).toBeDisabled();
    await expect(
      archivedRegion.getByText("You've used all the trading accounts your plan allows."),
    ).toBeVisible();
  });

  test('an expired trial preserves existing accounts and blocks only create/restore', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-expired', {
      entitlement: { status: 'trialing', trialEndsAt: new Date(Date.now() - 60_000) },
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    const banner = page.getByRole('region', { name: 'Trial status' });
    await expect(banner).toContainText('Your trial has expired');

    await page.goto('/en/app/accounts');
    await expect(
      page.getByRole('region', { name: 'Main Trading Account' }).getByRole('heading', {
        name: 'Main Trading Account',
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    // Editing and switching remain available.
    await page
      .getByRole('region', { name: 'Main Trading Account' })
      .getByRole('link', { name: 'Edit' })
      .click();
    await expect(page.getByRole('heading', { name: 'Edit trading account' })).toBeVisible();
    await page.getByRole('link', { name: 'Cancel' }).click();

    // Archiving remains available too (never blocked by trial expiry) —
    // requires a second account first, since the last account cannot be
    // archived regardless of entitlement.
    await page.goto('/en/app/accounts/new');
    await expect(page.getByText('Create unavailable')).toBeVisible();
  });

  test('an over-limit workspace preserves all accounts and blocks create/restore with a clear notice', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-over-limit', {
      entitlement: { status: 'active', planKey: 'starter', trialEndsAt: null },
      additionalAccounts: 2,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    await expect(page.getByRole('region', { name: 'Trial status' })).toContainText(
      "This workspace is over its plan's account limit",
    );

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('region', { name: 'Main Trading Account' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Additional Account 1' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Additional Account 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('the plan page shows the three real plan definitions and never fakes a purchase', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-plan-page');
    await loginAs(page, 'en', user);

    await page.goto('/en/app/plan');
    await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
    await expect(page.getByText('Online payment is not connected yet.')).toBeVisible();

    for (const planName of ['Starter', 'Pro', 'Elite']) {
      await expect(page.getByRole('heading', { name: planName })).toBeVisible();
    }
    // Every plan CTA is a disabled "Coming soon" — never an active purchase button.
    const comingSoonButtons = page.getByRole('button', { name: 'Coming soon' });
    await expect(comingSoonButtons).toHaveCount(3);
    for (const button of await comingSoonButtons.all()) {
      await expect(button).toBeDisabled();
    }
  });

  test('trial banner and plan page render correctly in Thai', async ({ page }) => {
    const user = await provisionUser('e2e-entitlements-th');
    await loginAs(page, 'th', user);

    await page.goto('/th/app');
    const banner = page.getByRole('region', { name: 'สถานะการทดลองใช้' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('ทดลองใช้ฟรี');

    await page.goto('/th/app/plan');
    await expect(page.getByRole('heading', { name: 'แผนและการเรียกเก็บเงิน' })).toBeVisible();
  });

  test('no horizontal overflow at a 320px viewport with the trial banner and usage summary visible', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-mobile-320', { additionalAccounts: 1 });
    await page.setViewportSize({ width: 320, height: 720 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('region', { name: 'Trial status' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
