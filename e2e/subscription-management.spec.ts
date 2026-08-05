import { expect, test } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

const PASSWORD = 'Subscription-Management9!';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function provisionPaidUser(
  prefix: string,
  planKey: 'starter' | 'trader' | 'professional' = 'professional',
  additionalAccounts = 0,
) {
  const { testUrl } = validateTestDatabaseEnvironment();
  return provisionVerifiedUser(
    testUrl,
    { email: uniqueEmail(prefix), password: PASSWORD, name: 'Subscription Manager' },
    {
      onboarded: true,
      entitlement: { status: 'active', planKey, trialEndsAt: null },
      additionalAccounts,
    },
  );
}

test.describe('Phase 04G subscription management and billing history', () => {
  test.beforeEach(() => test.skip(!hasE2eDatabase, E2E_SKIP_REASON));

  test('active customer schedules and cancels downgrade, then schedules and reverses cancellation', async ({
    page,
  }) => {
    const user = await provisionPaidUser('e2e-subscription-lifecycle', 'professional', 6);
    await loginAs(page, 'en', user);
    await page.goto('/en/app/plan');

    const starterDowngrade = page
      .getByRole('heading', { name: 'Downgrade to Starter' })
      .locator('..')
      .locator('..');
    await expect(starterDowngrade.getByText('Future active-account limit')).toBeVisible();
    await expect(starterDowngrade.getByText(/will be over limit/i)).toBeVisible();
    await starterDowngrade.getByRole('button', { name: 'Schedule downgrade' }).click();
    await expect(
      page.getByRole('alertdialog', { name: /Schedule downgrade to Starter/ }),
    ).toBeVisible();
    await expect(page.getByText(/never deleted or automatically archived/i)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm downgrade' }).click();
    await expect(page.getByText(/Your plan will change to Starter/)).toBeVisible();

    await page.getByRole('button', { name: 'Cancel scheduled downgrade' }).click();
    await page.getByRole('button', { name: 'Keep current plan' }).click();
    await expect(page.getByText(/Your plan will change to Starter/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Schedule cancellation' }).click();
    await expect(page.getByText(/workspace becomes read-only/i)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.getByText('Cancellation scheduled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reverse cancellation' }).click();
    await page.getByRole('button', { name: 'Continue subscription' }).click();
    await expect(page.getByRole('button', { name: 'Schedule cancellation' })).toBeVisible();
  });

  test('billing history shows immutable mock snapshot and processing can return to reconciliation', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: `e2e-checkout-processing-history-${testInfo.project.name.toLowerCase()}@example.test`,
        password: PASSWORD,
        name: 'Processing History',
      },
      { entitlement: {} },
    );
    await loginAs(page, 'en', user);
    await page.goto('/en/app/checkout?plan=starter&currency=USD');
    await page.getByRole('button', { name: 'Confirm mock subscription' }).click();
    await expect(page.getByText(/mock payment is processing/i)).toBeVisible();
    await page.goto('/en/app/billing');
    await expect(page.getByText('Mock payment processing', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('$5.00').first()).toBeVisible();
    await expect(page.getByText(/VAT/)).toHaveCount(0);
    await page.getByRole('link', { name: 'Return to payment status' }).click();
    await page.getByRole('button', { name: 'Check payment status' }).click();
    await expect(page.getByText(/Mock payment completed/)).toBeVisible();
  });

  test('expired and canceled customers can activate while past-due customer has no checkout CTA', async ({
    page,
  }) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    for (const status of ['expired', 'canceled'] as const) {
      const user = await provisionVerifiedUser(
        testUrl,
        { email: uniqueEmail(`e2e-${status}-activation`), password: PASSWORD, name: status },
        {
          onboarded: true,
          entitlement: { status, planKey: 'starter', trialEndsAt: null },
        },
      );
      await loginAs(page, 'en', user);
      await page.goto('/en/app/plan');
      await expect(page.getByRole('link', { name: 'Choose plan' }).first()).toBeVisible();
      await page.context().clearCookies();
    }

    const pastDue = await provisionVerifiedUser(
      testUrl,
      { email: uniqueEmail('e2e-past-due-management'), password: PASSWORD, name: 'Past due' },
      {
        onboarded: true,
        entitlement: {
          status: 'past_due',
          planKey: 'starter',
          trialEndsAt: null,
          billingCurrency: 'USD',
          currentPeriodStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          currentPeriodEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    );
    await loginAs(page, 'en', pastDue);
    await page.goto('/en/app/plan');
    await expect(page.getByText(/Contact support for payment recovery/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Choose plan|Upgrade/ })).toHaveCount(0);
  });

  test('Thai mobile confirmation has no overflow and preserves keyboard focus behavior', async ({
    page,
  }) => {
    const user = await provisionPaidUser('e2e-subscription-th-mobile', 'trader');
    await page.setViewportSize({ width: 320, height: 720 });
    await loginAs(page, 'th', user);
    await page.goto('/th/app/plan');
    const downgrade = page.getByRole('button', { name: 'กำหนดลดระดับแผน' });
    await downgrade.focus();
    await expect(downgrade).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.keyboard.press('Escape');
    await expect(downgrade).toBeFocused();

    await page.goto('/th/app/billing');
    await expect(page.getByRole('heading', { name: 'ประวัติการเรียกเก็บเงิน' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  });
});
