import { test as setup } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { hasE2eDatabase } from './support/env';
import { E2E_USER_A } from './support/fixtures';

/**
 * Playwright's own documented pattern for a mixed authenticated/unauthenticated
 * suite: a dedicated "setup" project (see playwright.config.ts) that logs in
 * once via the real UI and saves the resulting session cookie to disk, so
 * every-page-needs-a-session specs (app-shell, demo-dashboard, i18n, theme —
 * all inherited from Phase 1, written before `/app/*` required a real
 * session) can start already authenticated with `test.use({ storageState })`
 * instead of failing on the login redirect Phase 02 now enforces.
 *
 * `e2e/auth-authorization.spec.ts` and `e2e/pricing-and-auth.spec.ts`
 * deliberately do NOT use this file's output — they test the unauthenticated
 * and authentication-transition states themselves, which a pre-authenticated
 * storage state would short-circuit.
 */
setup('authenticate as E2E_USER_A', async ({ page }) => {
  setup.skip(!hasE2eDatabase, 'DATABASE_URL is not set — see e2e/support/env.ts');

  await page.goto('/en/login');
  await page.getByLabel('Email').fill(E2E_USER_A.email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_USER_A.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/app$/);

  await page.context().storageState({ path: authStateFile });
});
