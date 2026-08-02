import { expect, test, type Page } from '@playwright/test';

import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { E2E_USER_A, E2E_USER_B } from './support/fixtures';

/**
 * The authorization matrix (Phase 2 brief §22) that needs a real browser and
 * real cookies rather than a direct DAL call — route protection, session
 * forgery/revocation, and cross-user isolation of the authenticated shell.
 *
 * `E2E_USER_A`/`E2E_USER_B` are provisioned, pre-verified, by
 * `e2e/global-setup.ts` directly against the database `webServer` boots
 * against — no registration or email round-trip needed here, only real
 * `signIn.email` calls through the actual running app.
 *
 * Workspace-ID-in-URL/payload manipulation (the other half of §22) has no
 * UI surface yet: Phase 2 ships no route that accepts a workspace ID from
 * the client at all (no trading accounts, strategies, or trades exist to
 * scope). That boundary is exercised where it actually lives —
 * `requireWorkspaceMembership`/`assertWorkspaceResourceAccess` in
 * `src/server/auth/dal.integration.test.ts` — and will gain a browser-level
 * counterpart once a later phase introduces a workspace-scoped route.
 */

const SESSION_COOKIE_NAME = 'better-auth.session_token';

test.describe('route protection and session authorization', () => {
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  async function loginAs(page: Page, user: { email: string; password: string }): Promise<void> {
    await page.goto('/en/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app$/);
  }

  test('an unauthenticated visitor is redirected to login with the callback path preserved', async ({
    page,
  }) => {
    await page.goto('/en/app');

    await expect(page).toHaveURL(/\/en\/login\?callbackUrl=%2Fen%2Fapp/);
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  });

  test('an authenticated user reaches the app and sees their own identity and workspace', async ({
    page,
  }) => {
    await loginAs(page, E2E_USER_A);

    await page.getByRole('button', { name: 'Account menu' }).click();
    // Scoped to the open dropdown: the trigger button's own truncated name
    // span stays mounted (just hidden below `sm`) while the menu is open, so
    // an unscoped getByText resolves to two elements — the trigger and the
    // menu's own label — a strict-mode violation, not a real ambiguity.
    const menu = page.getByRole('menu');
    await expect(menu.getByText(E2E_USER_A.name)).toBeVisible();
    await expect(menu.getByText(E2E_USER_A.email)).toBeVisible();
    await expect(menu.getByText('Personal workspace')).toBeVisible();
  });

  test('a fabricated session cookie grants nothing', async ({ page, context }) => {
    // No real login ever happened in this context — the cookie value is
    // pure fiction, not a copy of anything genuine.
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: 'forged-token-that-was-never-issued-by-the-server',
        domain: '127.0.0.1',
        path: '/',
      },
    ]);

    await page.goto('/en/app');
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('logout invalidates the session server-side, not just in the browser', async ({
    page,
    context,
  }) => {
    await loginAs(page, E2E_USER_B);

    const cookiesBeforeLogout = await context.cookies();
    const sessionCookies = cookiesBeforeLogout.filter((cookie) =>
      cookie.name.startsWith('better-auth.session_'),
    );
    expect(
      sessionCookies.some((cookie) => cookie.name === SESSION_COOKIE_NAME),
      'expected a real session cookie after login',
    ).toBe(true);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/en\/login/);

    // Re-inject the EXACT cookie value the server issued before logout. If
    // logout only cleared the browser's copy, this would still authenticate
    // — proving the point requires putting the real (soon-to-be-revoked)
    // token back and confirming the server itself now rejects it.
    await context.clearCookies();
    await context.addCookies(sessionCookies.map((cookie) => ({ ...cookie, domain: '127.0.0.1' })));
    await page.goto('/en/app');
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('an authenticated visitor is redirected away from login and register', async ({ page }) => {
    await loginAs(page, E2E_USER_A);

    await page.goto('/en/login');
    await expect(page).toHaveURL(/\/en\/app$/);

    await page.goto('/en/register');
    await expect(page).toHaveURL(/\/en\/app$/);
  });

  test('two concurrently signed-in users see only their own identity', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await loginAs(pageA, E2E_USER_A);
      await loginAs(pageB, E2E_USER_B);

      await pageA.getByRole('button', { name: 'Account menu' }).click();
      await expect(pageA.getByText(E2E_USER_A.email)).toBeVisible();
      await expect(pageA.getByText(E2E_USER_B.email)).not.toBeVisible();

      await pageB.getByRole('button', { name: 'Account menu' }).click();
      await expect(pageB.getByText(E2E_USER_B.email)).toBeVisible();
      await expect(pageB.getByText(E2E_USER_A.email)).not.toBeVisible();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
