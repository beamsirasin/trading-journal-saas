import { expect, test } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { establishAuthenticatedSession } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import {
  getPersonalWorkspaceId,
  setWorkspaceEntitlementSourceForUser,
} from './support/provision-entitlement-source';
import {
  grantPlatformAdminForE2e,
  revokePlatformAdminForE2e,
} from './support/provision-platform-admin';
import { provisionVerifiedUser } from './support/provision-user';

test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

function uniqueEmail(prefix: string, projectName: string): string {
  return `${prefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/** A valid trial-extension target: comfortably future, comfortably inside the locked 90-day maximum (`MAX_TRIAL_EXTENSION_DAYS`) relative to whenever the test actually runs — never a hardcoded calendar date. */
function trialExtensionTarget(): { inputValue: string; monthDayLabel: string } {
  const target = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const inputValue = target.toISOString().slice(0, 16);
  const monthDayLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(target);
  return { inputValue, monthDayLabel };
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

test.describe('Admin Subscription Support (Phase 11E)', () => {
  test('Chromium: extend trial, grant complimentary, change plan, revoke — full journey with Audit trail', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium coverage');
    const { testUrl } = validateTestDatabaseEnvironment();

    const target = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-support-target', testInfo.project.name),
        password: 'e2e-target-password-123',
        name: 'E2E Support Target',
      },
      { entitlement: {} }, // real trial semantics: source='trial', status='trialing'
    );
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-support-admin');
    const workspaceId = await getPersonalWorkspaceId(testUrl, target.id);
    await establishAuthenticatedSession(page, admin);

    await page.goto(`/admin/workspaces/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'Subscription Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extend Trial' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grant Complimentary Plan' })).toBeVisible();

    // --- Extend Trial ---
    // Each step confirms the in-dialog success message, then uses a fresh
    // `page.reload()` (a new navigation/request, not the pending client
    // transition `router.refresh()` itself triggers) to verify the outcome
    // actually persisted — robust to that transition running slowly under
    // concurrent E2E load, since it doesn't wait on that specific promise.
    const { inputValue, monthDayLabel } = trialExtensionTarget();
    await page.getByRole('button', { name: 'Extend Trial' }).click();
    await expect(page.getByRole('heading', { name: 'Extend trial' })).toBeVisible();
    const extendDialog = page.locator('[data-slot="dialog-content"]');
    await extendDialog.getByLabel('New trial end (UTC)').fill(inputValue);
    await extendDialog.getByRole('button', { name: 'Extend trial' }).click();
    await expect(extendDialog.getByText('Trial extended.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(new RegExp(monthDayLabel))).toBeVisible();

    // --- Grant Complimentary ---
    await page.getByRole('button', { name: 'Grant Complimentary Plan' }).click();
    await expect(page.getByRole('heading', { name: 'Grant complimentary plan' })).toBeVisible();
    const grantDialog = page.locator('[data-slot="alert-dialog-content"]');
    await grantDialog.getByLabel('Plan').selectOption('trader');
    await grantDialog.getByLabel('Type COMPLIMENTARY to confirm').fill('COMPLIMENTARY');
    await grantDialog.getByRole('button', { name: 'Grant complimentary plan' }).click();
    await expect(grantDialog.getByText('Complimentary plan granted.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Complimentary').first()).toBeVisible();
    await expect(page.getByText('Trader').first()).toBeVisible();

    // No billing transaction was ever created by the comp grant.
    await expect(page.getByText('No billing transactions on record.')).toBeVisible();

    // --- Change complimentary plan ---
    await expect(page.getByRole('button', { name: 'Change Complimentary Plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Change Complimentary Plan' }).click();
    const changeDialog = page.locator('[data-slot="alert-dialog-content"]');
    await changeDialog.getByLabel('Plan').selectOption('starter');
    await changeDialog.getByLabel('Type COMPLIMENTARY to confirm').fill('COMPLIMENTARY');
    await changeDialog.getByRole('button', { name: 'Grant complimentary plan' }).click();
    await expect(changeDialog.getByText('Complimentary plan granted.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Starter').first()).toBeVisible();

    // --- Revoke complimentary ---
    await expect(page.getByRole('button', { name: 'Revoke Complimentary' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke Complimentary' }).click();
    await expect(page.getByRole('heading', { name: 'Revoke complimentary access' })).toBeVisible();
    const revokeDialog = page.locator('[data-slot="alert-dialog-content"]');
    await revokeDialog.getByLabel('Type REVOKE to confirm').fill('REVOKE');
    await revokeDialog.getByRole('button', { name: 'Revoke complimentary access' }).click();
    await expect(revokeDialog.getByText('Complimentary access revoked.')).toBeVisible();
    await page.reload();
    // Workspace returned to its trial baseline.
    await expect(page.getByRole('button', { name: 'Extend Trial' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grant Complimentary Plan' })).toBeVisible();

    // --- Audit trail ---
    // Scoped to `tbody`, not `page` — the filter `<select>` above the table
    // also renders an (invisible-but-DOM-present) "Trial extended" `<option>`
    // with the same text, which `page.getByText(...).first()` would resolve
    // to instead of the actual result row.
    await page.goto(`/admin/audit?subjectWorkspace=${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();
    const auditRows = page.locator('tbody');
    await expect(auditRows.getByText('Trial extended').first()).toBeVisible();
    await expect(auditRows.getByText('Complimentary plan granted').first()).toBeVisible();
    await expect(auditRows.getByText('Complimentary plan revoked').first()).toBeVisible();
  });

  test('Chromium: a paid Workspace shows no Admin mutation controls', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium coverage');
    const { testUrl } = validateTestDatabaseEnvironment();

    const target = await provisionVerifiedUser(testUrl, {
      email: uniqueEmail('e2e-paid-target', testInfo.project.name),
      password: 'e2e-target-password-123',
      name: 'E2E Paid Target',
    }); // default fixture: status active, professional plan
    await setWorkspaceEntitlementSourceForUser(testUrl, target.id, 'paid');
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-paid-admin');
    const workspaceId = await getPersonalWorkspaceId(testUrl, target.id);
    await establishAuthenticatedSession(page, admin);

    await page.goto(`/admin/workspaces/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'Subscription Support' })).toBeVisible();
    await expect(
      page.getByText(
        'This Workspace has a paid subscription. Paid lifecycle changes are managed through the canonical customer/payment flow — no Admin mutation is available here.',
      ),
    ).toBeVisible();

    await expect(page.getByRole('button', { name: 'Extend Trial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Grant Complimentary/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Change Complimentary/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Revoke Complimentary' })).toHaveCount(0);
    // No other forbidden lifecycle control exists anywhere on this page.
    await expect(
      page.getByRole('button', { name: /cancel|refund|suspend|delete|recover/i }),
    ).toHaveCount(0);
  });

  test('an ordinary authenticated user cannot see Audit or invoke Admin mutation actions', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: uniqueEmail('e2e-support-nonadmin', testInfo.project.name),
      password: 'e2e-nonadmin-password-123',
      name: 'E2E Support Non-Admin',
    });
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin/audit');
    await expect(page.getByText('404', { exact: true })).toBeVisible();
    await expect(page.getByText(/append-only record of platform-admin activity/i)).toHaveCount(0);

    // A direct Server Action call, forged from the browser console, is
    // rejected server-side regardless of the client UI — the service layer
    // independently re-verifies `requirePlatformAdmin()` (see the guarded
    // integration suite for the exact rejection code); this only proves the
    // customer session cannot reach the Admin surface at all to attempt it.
    await page.goto(`/admin/workspaces/${crypto.randomUUID()}`);
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('revoking the admin grant denies the very next request to /admin/audit', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-audit-revoke');
    await establishAuthenticatedSession(page, admin);

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();

    await revokePlatformAdminForE2e(testUrl, admin.id);
    await page.reload();
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('mobile: Subscription Support fits 320px and the type-to-confirm dialog is usable', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    const { testUrl } = validateTestDatabaseEnvironment();

    const target = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-support-mobile-target', testInfo.project.name),
        password: 'e2e-target-password-123',
        name: 'E2E Mobile Target',
      },
      { entitlement: {} },
    );
    const admin = await provisionAdmin(testUrl, testInfo.project.name, 'e2e-support-mobile-admin');
    const workspaceId = await getPersonalWorkspaceId(testUrl, target.id);
    await establishAuthenticatedSession(page, admin);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/admin/workspaces/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'Subscription Support' })).toBeVisible();
    let hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);

    await page.getByRole('button', { name: 'Grant Complimentary Plan' }).click();
    await expect(page.getByRole('heading', { name: 'Grant complimentary plan' })).toBeVisible();
    await page.getByLabel('Type COMPLIMENTARY to confirm').fill('COMPLIMENTARY');
    hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
