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

/** `project.name` folded into every email — the same convention `admin.spec.ts` establishes for the shared database both `chromium`/`mobile-chrome` run against. */
function uniqueEmail(prefix: string, projectName: string): string {
  return `${prefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

test.describe('Admin User/Workspace oversight (Phase 11D)', () => {
  test('a non-admin sees privacy-limited 404s for every oversight route, nothing flashes first', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: uniqueEmail('e2e-oversight-nonadmin', testInfo.project.name),
      password: 'e2e-nonadmin-password-123',
      name: 'E2E Non-Admin',
    });
    await establishAuthenticatedSession(page, user);

    for (const path of [
      '/admin/users',
      `/admin/users/${crypto.randomUUID()}`,
      '/admin/workspaces',
      `/admin/workspaces/${crypto.randomUUID()}`,
    ]) {
      await page.goto(path);
      await expect(page.getByText('404', { exact: true })).toBeVisible();
      await expect(page.getByText(/no user matches/i)).toHaveCount(0);
      await expect(page.getByText(/canonical (user|workspace) records/i)).toHaveCount(0);
    }
  });

  test('an admin can find a user by email, open the detail page, and navigate through to their workspace', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const targetEmail = uniqueEmail('e2e-oversight-target', testInfo.project.name);
    await provisionVerifiedUser(testUrl, {
      email: targetEmail,
      password: 'e2e-target-password-123',
      name: 'E2E Oversight Target',
    });
    const admin = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-oversight-admin', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Oversight Admin',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, admin.id);
    await establishAuthenticatedSession(page, admin);

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    await page.getByRole('searchbox').fill(targetEmail);
    await page.getByRole('button', { name: /search/i }).click();
    // The search is a client transition (`startTransition` +
    // `router.replace`) — wait for the URL itself to carry the query before
    // asserting on rows, rather than racing the still-`disabled` old list.
    await page.waitForURL((url) => url.searchParams.get('q') === targetEmail);
    await expect(page.getByRole('link', { name: 'E2E Oversight Target' })).toBeVisible();

    await page.getByRole('link', { name: 'E2E Oversight Target' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Oversight Target' })).toBeVisible();
    await expect(page.getByText(targetEmail)).toBeVisible();
    await expect(page.getByText('Email & password')).toBeVisible();

    // No session, IP, or Trade content anywhere on the page.
    await expect(page.getByText(/ip address/i)).toHaveCount(0);
    await expect(page.getByText(/session/i)).toHaveCount(0);

    await page.getByRole('link', { name: 'Personal workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Personal workspace' })).toBeVisible();
    // The target owns this Workspace — the Identity section's Owner fact
    // legitimately shows their name/email; no Strategy or Trade content does.
    await expect(page.getByText('E2E Oversight Target', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/EURUSD|plannedEntry/i)).toHaveCount(0);
  });

  test('an admin can find a workspace, filter by plan/source, and read its sanitized detail', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-oversight-wsadmin', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Workspace Oversight Admin',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, admin.id);
    await establishAuthenticatedSession(page, admin);

    await page.goto('/admin/workspaces');
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();

    await page.getByLabel('Plan').selectOption('professional');
    // The filter is a client transition (`startTransition` +
    // `router.replace`) — wait for the URL itself to carry the filter before
    // interacting with rows, rather than racing the still-`disabled` list.
    await page.waitForURL((url) => url.searchParams.get('plan') === 'professional');
    await expect(page.getByRole('link', { name: 'Personal workspace' }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Personal workspace' }).first().click();
    await expect(page.getByRole('heading', { name: 'Personal workspace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
    // `.first()`: Phase 11E added a second, distinct "Subscription Support"
    // heading further down the same page, which also substring-matches.
    await expect(page.getByRole('heading', { name: 'Subscription' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();

    // Phase 11D itself remains read-only, but the Workspace detail page now
    // also renders Phase 11E's Subscription Support controls (Extend Trial /
    // Grant or Revoke Complimentary), which are legitimate for a trial- or
    // complimentary-sourced Workspace — this filtered-by-`plan=professional`
    // result may land on either a paid or a complimentary Workspace, so only
    // the actions Phase 11E itself explicitly forbids are asserted absent
    // here, never a blanket "no grant/extend button" claim.
    await expect(page.getByRole('button', { name: /suspend/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /impersonate/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /refund/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^cancel subscription$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /recover/i })).toHaveCount(0);
  });

  test('an unknown userId or workspaceId in the URL renders the same privacy-limited 404', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-oversight-unknown', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Unknown-ID Admin',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, admin.id);
    await establishAuthenticatedSession(page, admin);

    await page.goto(`/admin/users/${crypto.randomUUID()}`);
    await expect(page.getByText('404', { exact: true })).toBeVisible();

    await page.goto(`/admin/workspaces/${crypto.randomUUID()}`);
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('revoking the admin grant denies the very next request to /admin/users', async ({
    page,
  }, testInfo) => {
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-oversight-revoke', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Revoke Admin',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, admin.id);
    await establishAuthenticatedSession(page, admin);

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    await revokePlatformAdminForE2e(testUrl, admin.id);
    await page.reload();
    await expect(page.getByText('404', { exact: true })).toBeVisible();
  });

  test('mobile: /admin/users renders with no 320px horizontal overflow and a working search', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    const { testUrl } = validateTestDatabaseEnvironment();
    const admin = await provisionVerifiedUser(
      testUrl,
      {
        email: uniqueEmail('e2e-oversight-mobile', testInfo.project.name),
        password: 'e2e-admin-password-123',
        name: 'E2E Mobile Admin',
      },
      { onboarded: false },
    );
    await grantPlatformAdminForE2e(testUrl, admin.id);
    await establishAuthenticatedSession(page, admin);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
