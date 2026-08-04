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
 *
 * Locked plan decision (correcting the earlier starter/pro/elite 1/3/10
 * draft): the trial is a fixed 1-account allowance (never the highest
 * plan's), and paid limits are starter=1, trader=5, professional=15. Tests
 * here that want real trial semantics pass `entitlement: {}` explicitly —
 * `provisionVerifiedUser`'s default (entitlement omitted entirely) seeds an
 * active Professional plan instead, for every OTHER spec file that creates
 * several accounts without knowing entitlements exist.
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

  test('shows the trial banner with the full-feature 7-day/1-account summary and days remaining', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-banner', { entitlement: {} });
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    const banner = page.getByRole('region', { name: 'Trial status' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Free trial');
    await expect(banner).toContainText(
      'Your 7-day full-feature trial includes 1 active trading account.',
    );
    await expect(banner).toContainText('days remaining');
    await expect(banner.getByRole('link', { name: 'View plans' })).toBeVisible();
  });

  test('account usage starts at 1/1 during the trial and a second account is rejected', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-trial-limit', { entitlement: {} });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('1 of 1 trading accounts used')).toBeVisible();
    await expect(page.getByText('Account limit reached')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    // A direct submission to /app/accounts/new is rejected server-side
    // rather than merely hidden client-side — no form is rendered at all.
    await page.goto('/en/app/accounts/new');
    await expect(page.getByText('Create unavailable')).toBeVisible();
    await expect(
      page.getByText("You've used your plan's active trading account limit."),
    ).toBeVisible();
    await expect(
      page.getByText('Additional accounts require the Trader or Professional plan.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to accounts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View plans' })).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toHaveCount(0);
  });

  test('archiving an account below the Trader limit makes Create available again', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-archive-frees-slot', {
      entitlement: { status: 'active', planKey: 'trader', trialEndsAt: null },
      additionalAccounts: 4,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('5 of 5 trading accounts used')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    await page
      .getByRole('region', { name: 'Additional Account 1' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await page.getByRole('button', { name: 'Archive account' }).click();

    await expect(page.getByText('4 of 5 trading accounts used')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();

    await createAccountViaUI(page, 'Freshly Allowed Account');
    await expect(page.getByRole('region', { name: 'Freshly Allowed Account' })).toBeVisible();
  });

  test('restoring an archived account is blocked once it would exceed the Starter limit', async ({
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
      archivedRegion.getByText("You've used your plan's active trading account limit."),
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

    // Editing remains available.
    await page
      .getByRole('region', { name: 'Main Trading Account' })
      .getByRole('link', { name: 'Edit' })
      .click();
    await expect(page.getByRole('heading', { name: 'Edit trading account' })).toBeVisible();
    await page.getByRole('link', { name: 'Cancel' }).click();

    await page.goto('/en/app/accounts/new');
    await expect(page.getByText('Create unavailable')).toBeVisible();
  });

  test('an over-limit Starter workspace preserves all accounts and blocks create/restore with a clear notice', async ({
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

  test('the plan page shows Starter/Trader/Professional with the locked prices, and never fakes a purchase', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-plan-page', { entitlement: {} });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/plan');
    await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
    await expect(page.getByText('Online payment is not connected yet.')).toBeVisible();
    await expect(
      page.getByText(
        'All plans include the same features and analytics. Plans differ only by how many active trading accounts you can keep.',
      ),
    ).toBeVisible();

    const expectations: Array<[string, string]> = [
      ['Starter', '฿149 / $5 per month'],
      ['Trader', '฿299 / $9 per month'],
      ['Professional', '฿499 / $15 per month'],
    ];
    for (const [planName, price] of expectations) {
      await expect(page.getByRole('heading', { name: planName })).toBeVisible();
      await expect(page.getByText(price)).toBeVisible();
    }
    // No stale draft plan names remain.
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Elite', exact: true })).toHaveCount(0);

    // Every plan CTA is a disabled "Coming soon" — never an active purchase button.
    const comingSoonButtons = page.getByRole('button', { name: 'Coming soon' });
    await expect(comingSoonButtons).toHaveCount(3);
    for (const button of await comingSoonButtons.all()) {
      await expect(button).toBeDisabled();
    }
  });

  test('the public pricing page shows the same Starter/Trader/Professional 1/5/15 limits and identical feature lists', async ({
    page,
  }) => {
    await page.goto('/en/pricing');
    const pricing = page.getByRole('region', { name: /three plans, one free trial/i });

    for (const planName of ['Starter', 'Trader', 'Professional']) {
      await expect(pricing.getByRole('heading', { name: planName, exact: true })).toBeVisible();
    }

    // Every shared feature string appears exactly once per plan card —
    // three cards, so exactly three occurrences each. A per-plan feature
    // list divergence (the old pro/elite design) would break this count.
    const sharedFeatures = [
      'Manual journal & TradingView links',
      'System-vs-trader comparison',
      'Mistake tracking & discipline scoring',
    ];
    for (const feature of sharedFeatures) {
      await expect(pricing.getByText(feature, { exact: true })).toHaveCount(3);
    }
  });

  test('trial banner and plan page render correctly in Thai', async ({ page }) => {
    const user = await provisionUser('e2e-entitlements-th', { entitlement: {} });
    await loginAs(page, 'th', user);

    await page.goto('/th/app');
    const banner = page.getByRole('region', { name: 'สถานะการทดลองใช้' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('ทดลองใช้ฟรี');
    await expect(banner).toContainText(
      'ทดลองใช้ทุกฟีเจอร์ 7 วัน พร้อมบัญชีเทรดที่ใช้งานอยู่ 1 บัญชี',
    );

    await page.goto('/th/app/plan');
    await expect(page.getByRole('heading', { name: 'แผนและการเรียกเก็บเงิน' })).toBeVisible();
  });

  test('no horizontal overflow at a 320px viewport with the trial banner and usage summary visible', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-mobile-320', { entitlement: {} });
    await page.setViewportSize({ width: 320, height: 720 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('region', { name: 'Trial status' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('when the entitlement snapshot is unavailable, Create and Restore fail closed while existing accounts stay usable', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-unavailable', {
      omitEntitlementRow: true,
      additionalArchivedAccounts: 1,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');

    // A generic, localized explanation — never a fabricated plan/trial
    // status, never a raw internal code.
    await expect(
      page.getByText(
        "We couldn't check this workspace's plan right now. Please try again in a moment.",
      ),
    ).toBeVisible();

    // Create is unavailable.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    // Existing accounts — active and archived — remain fully visible.
    await expect(page.getByRole('region', { name: 'Main Trading Account' })).toBeVisible();
    const archivedRegion = page.getByRole('region', { name: 'Archived Account 1' });
    await expect(archivedRegion).toBeVisible();

    // Restore is disabled with an accessible explanation, not merely a
    // color change.
    const restoreButton = archivedRegion.getByRole('button', { name: 'Restore' });
    await expect(restoreButton).toBeDisabled();
    const describedById = await restoreButton.getAttribute('aria-describedby');
    expect(describedById).not.toBeNull();
    await expect(page.locator(`#${describedById}`)).toContainText(
      "We couldn't check this workspace's plan right now.",
    );

    // Editing the existing active account remains available — entitlement
    // unavailability never blocks edit/switch/archive.
    await page
      .getByRole('region', { name: 'Main Trading Account' })
      .getByRole('link', { name: 'Edit' })
      .click();
    await expect(page.getByRole('heading', { name: 'Edit trading account' })).toBeVisible();

    // A direct submission to /app/accounts/new is rejected server-side too.
    await page.goto('/en/app/accounts/new');
    await expect(page.getByText('Create unavailable')).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toHaveCount(0);
  });

  test('the entitlement-unavailable state has no horizontal overflow at a 320px viewport', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-unavailable-mobile', {
      omitEntitlementRow: true,
      additionalArchivedAccounts: 1,
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(
      page.getByText(
        "We couldn't check this workspace's plan right now. Please try again in a moment.",
      ),
    ).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
