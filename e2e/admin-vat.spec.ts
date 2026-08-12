import { expect, test } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { establishAuthenticatedSession, loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { getPersonalWorkspaceId } from './support/provision-entitlement-source';
import {
  grantPlatformAdminForE2e,
  revokePlatformAdminForE2e,
} from './support/provision-platform-admin';
import { provisionVerifiedUser } from './support/provision-user';

test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

/**
 * Phase 11F VAT E2E — deliberately serialized (`mode: 'serial'`), and
 * intended to be run in FOCUSED isolation from the rest of the E2E suite
 * (`npx playwright test e2e/admin-vat.spec.ts`), not mixed into a
 * `fullyParallel` run of the whole repository. `platform_vat_configuration`
 * is one platform-wide row, not scoped to a Workspace like every other E2E
 * fixture in this repo — a test here that enables VAT would otherwise race
 * with unrelated specs (`checkout.spec.ts`, the landing/pricing specs) that
 * assert VAT is disabled. 11G's later complete `workers=1` full-repository
 * E2E run is the point at which full-suite ordering safety is established;
 * this file's own tests restore VAT to disabled before finishing regardless.
 */
test.describe.configure({ mode: 'serial' });

function uniqueEmail(prefix: string, projectName: string): string {
  return `${prefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function provisionAdmin(testUrl: string, projectName: string, prefix: string) {
  const admin = await provisionVerifiedUser(
    testUrl,
    {
      email: uniqueEmail(prefix, projectName),
      password: 'e2e-admin-password-123',
      name: `E2E ${prefix}`,
    },
    { onboarded: false },
  );
  await grantPlatformAdminForE2e(testUrl, admin.id);
  return admin;
}

test.describe('Admin VAT configuration (Phase 11F)', () => {
  test('Chromium: baseline, enable at 7%, Audit trail, disable again — full journey', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-vat-admin');
    await establishAuthenticatedSession(page, admin);

    await page.goto('/admin/vat');
    await expect(page.getByRole('heading', { name: 'VAT', exact: true })).toBeVisible();
    await expect(page.getByText('Disabled', { exact: true }).first()).toBeVisible();

    // --- Enable at 7% ---
    await page.getByRole('button', { name: 'Change VAT Configuration' }).click();
    await expect(page.getByRole('heading', { name: 'Change VAT configuration' })).toBeVisible();
    const dialog = page.locator('[data-slot="alert-dialog-content"]');
    await dialog.getByLabel('Enabled').selectOption('enabled');
    await dialog.getByLabel('Rate (%)').fill('');
    await dialog.getByLabel('Rate (%)').fill('7');
    await dialog.getByLabel('Type VAT to confirm').fill('VAT');
    await dialog.getByRole('button', { name: 'Change VAT configuration' }).click();
    await expect(dialog.getByText('VAT configuration changed.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Enabled', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('7.00%').first()).toBeVisible();

    // --- Audit trail ---
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();
    await expect(
      page.locator('tbody').getByText('VAT configuration changed').first(),
    ).toBeVisible();

    // --- Disable again (restores the true baseline before this file finishes) ---
    await page.goto('/admin/vat');
    await page.getByRole('button', { name: 'Change VAT Configuration' }).click();
    const disableDialog = page.locator('[data-slot="alert-dialog-content"]');
    await disableDialog.getByLabel('Enabled').selectOption('disabled');
    await disableDialog.getByLabel('Type VAT to confirm').fill('VAT');
    await disableDialog.getByRole('button', { name: 'Change VAT configuration' }).click();
    await expect(disableDialog.getByText('VAT configuration changed.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Disabled', { exact: true }).first()).toBeVisible();

    // --- History shows append-only changes, newest first ---
    const historyRows = page.locator('table tbody tr');
    await expect(historyRows.first()).toContainText('Disabled');
    await expect(page.getByText('Recent configuration history')).toBeVisible();
  });

  test('a non-admin caller cannot see or mutate VAT configuration', async ({ page }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: uniqueEmail('e2e-vat-nonadmin', testInfo.project.name),
      password: 'e2e-nonadmin-password-123',
      name: 'E2E VAT Non-Admin',
    });
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin/vat');
    await expect(page.getByText('404', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'VAT', exact: true })).toHaveCount(0);
  });

  test('revoking the admin grant denies the very next request to /admin/vat', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-vat-revoke');
    await establishAuthenticatedSession(page, admin);

    await page.goto('/admin/vat');
    await expect(page.getByRole('heading', { name: 'VAT', exact: true })).toBeVisible();

    await revokePlatformAdminForE2e(testUrl, admin.id);
    await page.reload();
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('mobile: /admin/vat fits 320px and the change dialog is usable', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-vat-mobile-admin');
    await establishAuthenticatedSession(page, admin);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/admin/vat');
    await expect(page.getByRole('heading', { name: 'VAT', exact: true })).toBeVisible();
    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    await page.getByRole('button', { name: 'Change VAT Configuration' }).click();
    await expect(page.getByRole('heading', { name: 'Change VAT configuration' })).toBeVisible();
    const dialog = page.locator('[data-slot="alert-dialog-content"]');
    await dialog.getByLabel('Type VAT to confirm').fill('VAT');
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    // Cancel — this test proves layout fitness, not a live commercial mutation.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Customer checkout reflects the effective VAT configuration (Phase 11F)', () => {
  test('Chromium: Flow A (disabled) then Admin enables VAT, Flow B (enabled, an upgrade) reflects the new rate, Flow A history is unchanged', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    // The mock payment provider is gated to this EXACT trusted E2E identity
    // pattern (`src/config/billing-capability.server.ts`) — a randomized
    // per-run email never reaches a usable "Confirm mock subscription"
    // button at all (it sees the "Payments are not available yet" panel
    // `checkout.spec.ts`'s own Phase 04H-A test proves for any other
    // identity). One identity performs BOTH flows sequentially — starter,
    // then an upgrade to trader — mirroring `checkout.spec.ts`'s own
    // established success-flow shape exactly. Admin and customer use
    // SEPARATE browser contexts throughout — switching identities on one
    // `page` via repeated `establishAuthenticatedSession` calls is not a
    // reliable pattern (the session cookie replacement is not guaranteed to
    // take effect before the next navigation).
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      const customer = await provisionVerifiedUser(
        testUrl,
        {
          email: `e2e-checkout-success-${testInfo.project.name}@example.test`,
          password: 'e2e-vat-checkout-password-123',
          name: 'E2E VAT Checkout',
        },
        { entitlement: {} },
      );

      // --- Flow A: VAT disabled (baseline) ---
      await loginAs(customerPage, 'en', customer);
      await customerPage.goto('/en/app/checkout?plan=starter&currency=USD');
      await expect(customerPage.getByText(/no real charge will occur/i).last()).toBeVisible();
      await expect(customerPage.getByText(/^VAT \d/)).toHaveCount(0);
      await customerPage.getByRole('button', { name: 'Confirm mock subscription' }).click();
      await expect(
        customerPage.getByText(/Mock payment completed for starter: \$5\.00/),
      ).toBeVisible();

      // --- Admin enables VAT at 7% ---
      const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-vat-checkout-admin');
      await establishAuthenticatedSession(adminPage, admin);
      await adminPage.goto('/admin/vat');
      await adminPage.getByRole('button', { name: 'Change VAT Configuration' }).click();
      const dialog = adminPage.locator('[data-slot="alert-dialog-content"]');
      await dialog.getByLabel('Enabled').selectOption('enabled');
      await dialog.getByLabel('Rate (%)').fill('');
      await dialog.getByLabel('Rate (%)').fill('7');
      await dialog.getByLabel('Type VAT to confirm').fill('VAT');
      await dialog.getByRole('button', { name: 'Change VAT configuration' }).click();
      await expect(dialog.getByText('VAT configuration changed.')).toBeVisible();

      // --- Flow B: the SAME identity's next checkout (an upgrade) now reflects VAT ---
      await customerPage.goto('/en/app/checkout?plan=trader&currency=USD');
      await expect(customerPage.getByText('VAT 7%')).toBeVisible();
      await expect(customerPage.getByText('Prices exclude 7% VAT.')).toBeVisible();
      await customerPage.getByRole('button', { name: 'Confirm mock subscription' }).click();
      await expect(
        customerPage.getByText(/Mock payment completed for trader: \$9\.63/),
      ).toBeVisible();

      // --- Flow A's historical Billing record is unchanged by the later Admin VAT change ---
      await customerPage.goto('/en/app/billing');
      await expect(customerPage.getByText('$5.00').first()).toBeVisible();
      await expect(customerPage.getByText('$9.63').first()).toBeVisible();

      // --- Restore baseline before this file finishes ---
      await adminPage.goto('/admin/vat');
      await adminPage.getByRole('button', { name: 'Change VAT Configuration' }).click();
      const restoreDialog = adminPage.locator('[data-slot="alert-dialog-content"]');
      await restoreDialog.getByLabel('Enabled').selectOption('disabled');
      await restoreDialog.getByLabel('Type VAT to confirm').fill('VAT');
      await restoreDialog.getByRole('button', { name: 'Change VAT configuration' }).click();
      await expect(restoreDialog.getByText('VAT configuration changed.')).toBeVisible();
    } finally {
      await customerContext.close();
      await adminContext.close();
    }
  });

  test('a complimentary customer converts to real paid; the checkout reflects the current Admin VAT configuration', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();

    try {
      const admin = await provisionAdmin(
        testUrl,
        testInfo.project.name,
        'e2e-vat-complimentary-admin',
      );
      await establishAuthenticatedSession(adminPage, admin);
      await adminPage.goto('/admin/vat');
      await adminPage.getByRole('button', { name: 'Change VAT Configuration' }).click();
      const enableDialog = adminPage.locator('[data-slot="alert-dialog-content"]');
      await enableDialog.getByLabel('Enabled').selectOption('enabled');
      await enableDialog.getByLabel('Rate (%)').fill('');
      await enableDialog.getByLabel('Rate (%)').fill('7');
      await enableDialog.getByLabel('Type VAT to confirm').fill('VAT');
      await enableDialog.getByRole('button', { name: 'Change VAT configuration' }).click();
      await expect(enableDialog.getByText('VAT configuration changed.')).toBeVisible();

      // Real mock checkout requires the exact trusted E2E identity pattern
      // (see the previous test's own comment) — reused here since this file
      // runs its tests serially, so `provisionVerifiedUser`'s own
      // delete-then-recreate idempotency gives this test a clean identity.
      const customer = await provisionVerifiedUser(
        testUrl,
        {
          email: `e2e-checkout-success-${testInfo.project.name}@example.test`,
          password: 'e2e-vat-complimentary-password-123',
          name: 'E2E VAT Complimentary Customer',
        },
        { entitlement: {} },
      );
      const workspaceId = await getPersonalWorkspaceId(testUrl, customer.id);

      // Grant a genuinely truthful complimentary state through the real,
      // already-verified Phase 11E Admin mutation — not a raw DB shortcut —
      // so this test proves the real `source==='complimentary'` shape
      // (`status:'active'`, null commercial fields) the Phase 11E-patch
      // resolver and checkout wiring were built for.
      await adminPage.goto(`/admin/workspaces/${workspaceId}`);
      await adminPage.getByRole('button', { name: 'Grant Complimentary Plan' }).click();
      const grantDialog = adminPage.locator('[data-slot="alert-dialog-content"]');
      await grantDialog.getByLabel('Plan').selectOption('starter');
      await grantDialog.getByLabel('Type COMPLIMENTARY to confirm').fill('COMPLIMENTARY');
      await grantDialog.getByRole('button', { name: 'Grant complimentary plan' }).click();
      await expect(grantDialog.getByText('Complimentary plan granted.')).toBeVisible();

      await loginAs(customerPage, 'en', customer);
      await customerPage.goto('/en/app/checkout?plan=trader&currency=USD');
      await expect(customerPage.getByText('VAT 7%')).toBeVisible();
      await customerPage.getByRole('button', { name: 'Confirm mock subscription' }).click();
      await expect(
        customerPage.getByText(/Mock payment completed for trader: \$9\.63/),
      ).toBeVisible();
      await customerPage.getByRole('link', { name: 'View current plan' }).click();
      await expect(customerPage.getByText('Trader').first()).toBeVisible();
      await expect(customerPage.getByText('Active', { exact: true })).toBeVisible();

      await adminPage.goto(`/admin/workspaces/${workspaceId}`);
      await expect(adminPage.getByText('Paid').first()).toBeVisible();
      // No Admin Subscription Support mutation controls remain for a paid Workspace.
      await expect(adminPage.getByRole('button', { name: 'Grant Complimentary Plan' })).toHaveCount(
        0,
      );

      // --- Restore baseline before this file finishes ---
      await adminPage.goto('/admin/vat');
      await adminPage.getByRole('button', { name: 'Change VAT Configuration' }).click();
      const restoreDialog = adminPage.locator('[data-slot="alert-dialog-content"]');
      await restoreDialog.getByLabel('Enabled').selectOption('disabled');
      await restoreDialog.getByLabel('Type VAT to confirm').fill('VAT');
      await restoreDialog.getByRole('button', { name: 'Change VAT configuration' }).click();
      await expect(restoreDialog.getByText('VAT configuration changed.')).toBeVisible();
    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  });
});
