import { expect, test } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

function projectSegment(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

test.describe('Phase 04F pricing and mock checkout', () => {
  test('English pricing defaults to USD, switches to THB, and preserves a safe auth callback', async ({
    page,
  }) => {
    await page.goto('/en/pricing');
    await expect(page.getByRole('radio', { name: 'USD' })).toBeChecked();
    await expect(page.getByText('$5.00 / month')).toBeVisible();
    await page.locator('label').filter({ hasText: /^THB$/ }).click();
    await expect(page.getByText('฿149.00 / month')).toBeVisible();
    await expect(page.getByText(/VAT/i)).toHaveCount(0);

    await page.getByRole('link', { name: 'Choose plan' }).first().click();
    await expect(page).toHaveURL(/\/en\/login\?callbackUrl=/);
    const callback = new URL(page.url()).searchParams.get('callbackUrl');
    expect(callback).toBe('/en/app/checkout?plan=starter&currency=THB');
  });

  test('Thai pricing defaults to THB and has no launch VAT notice', async ({ page }) => {
    await page.goto('/th/pricing');
    await expect(page.getByRole('radio', { name: 'THB' })).toBeChecked();
    await expect(page.getByText('฿149.00 / เดือน')).toBeVisible();
    await expect(page.getByText('ราคาไม่รวมภาษีมูลค่าเพิ่ม 7%')).toHaveCount(0);
  });

  test('an authenticated trial user completes mock checkout and sees the real plan update', async ({
    page,
  }, testInfo) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    const { testUrl } = validateTestDatabaseEnvironment();
    const segment = projectSegment(testInfo.project.name);
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: `e2e-checkout-success-${segment}@example.test`,
        password: 'checkout-success-password-123',
        name: 'Checkout Success',
      },
      { entitlement: {} },
    );
    await loginAs(page, 'en', user);
    await page.goto('/en/app/checkout?plan=starter&currency=USD');
    await expect(page.getByText(/no real charge will occur/i).last()).toBeVisible();
    await page.getByRole('button', { name: 'Confirm mock subscription' }).evaluate((button) => {
      const form = button.closest('form');
      if (form === null) throw new Error('checkout form missing');
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.getByText(/Mock payment completed for starter: \$5.00/)).toBeVisible();
    await page.getByRole('link', { name: 'View current plan' }).click();
    await expect(page.getByText('Starter').first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Upgrade' }).first().click();
    await expect(page).toHaveURL(/plan=trader/);
    await page.getByRole('button', { name: 'Confirm mock subscription' }).click();
    await expect(page.getByText(/Mock payment completed for trader: \$9.00/)).toBeVisible();
  });

  test('processing can be reconciled from the browser using only server-injected provider behavior', async ({
    page,
  }, testInfo) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    const { testUrl } = validateTestDatabaseEnvironment();
    const segment = projectSegment(testInfo.project.name);
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: `e2e-checkout-processing-${segment}@example.test`,
        password: 'checkout-processing-password-123',
        name: 'Checkout Processing',
      },
      { entitlement: {} },
    );
    await loginAs(page, 'en', user);
    await page.goto('/en/app/checkout?plan=starter&currency=USD');
    await page.getByRole('button', { name: 'Confirm mock subscription' }).click();
    await expect(page.getByText(/mock payment is processing/i)).toBeVisible();
    await page.getByRole('button', { name: 'Check payment status' }).click();
    await expect(page.getByText(/Mock payment completed/)).toBeVisible();
  });

  test('a failed mock payment leaves the trial unchanged and mobile checkout does not overflow', async ({
    page,
  }, testInfo) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    const { testUrl } = validateTestDatabaseEnvironment();
    const segment = projectSegment(testInfo.project.name);
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: `e2e-checkout-failed-${segment}@example.test`,
        password: 'checkout-failed-password-123',
        name: 'Checkout Failed',
      },
      { entitlement: {} },
    );
    await loginAs(page, 'th', user);
    await page.goto('/th/app/checkout?plan=starter&currency=THB');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: 'ยืนยันแผนแบบจำลอง' }).click();
    await expect(page.getByText(/การชำระเงินจำลองไม่สำเร็จ/)).toBeVisible();
    await page.getByRole('link', { name: 'กลับไปหน้าแผน' }).click();
    await expect(page.getByText('ทดลองใช้ฟรี').first()).toBeVisible();
  });

  test('Phase 04H-A: a non-E2E identity in the production build sees the unavailable panel, never a usable free activation', async ({
    page,
  }, testInfo) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    const { testUrl } = validateTestDatabaseEnvironment();
    const segment = projectSegment(testInfo.project.name);
    // This build IS the guarded production E2E seam (E2E_TEST_MODE=true,
    // loopback BETTER_AUTH_URL — see playwright.config.ts's webServer.env),
    // so the only thing standing between this ordinary authenticated
    // identity and mock checkout is the trusted e2e-checkout-* email
    // allowlist. This account deliberately does not match it.
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: `not-a-trusted-e2e-identity-${segment}@example.test`,
        password: 'ordinary-customer-password-123',
        name: 'Ordinary Customer',
      },
      { entitlement: {} },
    );
    await loginAs(page, 'en', user);
    await page.goto('/en/app/checkout?plan=starter&currency=USD');

    await expect(
      page.getByRole('heading', { name: 'Payments are not available yet' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mock payment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm mock subscription' })).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);
    // Public pricing/order-summary information remains visible even though
    // payment is unavailable.
    await expect(page.getByText('Starter').first()).toBeVisible();

    await page.getByRole('link', { name: 'View billing history' }).click();
    await expect(page).toHaveURL(/\/en\/app\/billing/);
  });
});
