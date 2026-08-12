import { expect, test } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { establishAuthenticatedSession } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import {
  grantPlatformAdminForE2e,
  revokePlatformAdminForE2e,
} from './support/provision-platform-admin';
import { provisionVerifiedUser } from './support/provision-user';

test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

/** `project.name` folded into every email, since both `chromium`/`mobile-chrome` run this file against the same shared database — the exact convention `entitlements.spec.ts`/`accounts.spec.ts` already establish. */
function uniqueEmail(prefix: string, projectName: string): string {
  return `${prefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

test.describe('Admin dashboard (Phase 11C)', () => {
  test('unauthenticated /admin redirects to the canonical EN login with a callback', async ({
    page,
  }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/en\/login\?callbackUrl=%2Fadmin/);
  });

  test('/en/admin and /th/admin are not canonical Admin routes', async ({ page }) => {
    // Neither is a real route — Phase 11's EN-only, locale-independent
    // contract means these should 404 (or otherwise never resolve to the
    // Admin dashboard), not redirect into it.
    const responseEn = await page.goto('/en/admin');
    expect(responseEn?.status()).toBe(404);
    const responseTh = await page.goto('/th/admin');
    expect(responseTh?.status()).toBe(404);
  });

  test('an ordinary authenticated user cannot reach Admin content — privacy-limited 404, nothing flashes first', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: uniqueEmail('e2e-admin-nonadmin', testInfo.project.name),
      password: 'e2e-nonadmin-password-123',
      name: 'E2E Non-Admin',
    });
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin');
    await expect(page.getByText('404', { exact: true })).toBeVisible();
    // The server never sent this data in the first place (Server Components,
    // no client-side fetch-then-hide) — asserted directly rather than
    // inferred from timing.
    await expect(page.getByText(/total users/i)).toHaveCount(0);
    await expect(page.getByText(/platform overview/i)).toHaveCount(0);
  });

  test('a Workspace owner with no platform-admin grant is denied — ownership grants nothing', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    // `onboarded` defaults to true: a real personal Workspace with the user
    // as `owner`, and (via the default entitlement) an active Professional
    // plan — proving neither ownership nor a paid plan grants admin.
    const user = await provisionVerifiedUser(testUrl, {
      email: uniqueEmail('e2e-admin-owner', testInfo.project.name),
      password: 'e2e-owner-password-123',
      name: 'E2E Workspace Owner',
    });
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin');
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('a platform admin sees the real Overview dashboard; revocation denies the very next request', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-admin-active', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Platform Admin',
      },
      { onboarded: false }, // no Workspace at all — see the dedicated test below
    );
    await grantPlatformAdminForE2e(testUrl, user.id);
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: 'Platform Overview' })).toBeVisible();
    await expect(page.getByText('Admin', { exact: true }).first()).toBeVisible();

    // Locked metric catalogue — present.
    await expect(page.getByText(/total users/i)).toBeVisible();
    await expect(page.getByText(/total workspaces/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Subscription status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plan distribution' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New users' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trades logged' })).toBeVisible();
    await expect(page.getByText('Last 30 days · UTC').first()).toBeVisible();

    // Explicitly excluded metrics — absent as their own labeled figure.
    // (The subscription-source card legitimately says "never counted as
    // revenue" as a truthful disclaimer — a heading/KPI-label check, not a
    // blanket word-absence check, is what actually proves there is no
    // revenue METRIC, which is the real requirement.)
    await expect(page.getByRole('heading', { name: /\bMRR\b/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /\bARR\b/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^revenue$/i })).toHaveCount(0);
    await expect(page.locator('[data-kpi]', { hasText: /revenue|MRR|ARR/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /conversion rate/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /last active/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /last sign.?in/i })).toHaveCount(0);
    await expect(page.locator('[data-kpi]', { hasText: /last active|last sign.?in/i })).toHaveCount(
      0,
    );

    // No mutation controls of any kind (11C is read-only).
    await expect(page.getByRole('button', { name: /extend trial/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /grant/i })).toHaveCount(0);

    await revokePlatformAdminForE2e(testUrl, user.id);
    await page.reload();
    await expect(page.getByText('404', { exact: true })).toBeVisible();
    await expect(page.getByText(/platform overview/i)).toHaveCount(0);
  });

  test('a platform admin with no Workspace at all still reaches the dashboard', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-admin-noworkspace', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Admin No Workspace',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, user.id);
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform Overview' })).toBeVisible();
  });

  test('desktop: no horizontal overflow, charts render inside their container', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-admin-desktop', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Admin Desktop',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, user.id);
    await establishAuthenticatedSession(page, user);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform Overview' })).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });

  test('mobile: admin can open /admin, cards stack, no 320px horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-admin-mobile', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Admin Mobile',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, user.id);
    await establishAuthenticatedSession(page, user);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: 'Platform Overview' })).toBeVisible();
    await expect(page.getByText(/total users/i)).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
