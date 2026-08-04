import { test as setup } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { authenticateContext } from './support/authenticate';
import { hasE2eDatabase } from './support/env';
import { E2E_USER_A } from './support/fixtures';

/**
 * Playwright's own documented pattern for a mixed authenticated/unauthenticated
 * suite: a dedicated "setup" project (see playwright.config.ts) that
 * authenticates once and saves the resulting session cookie to disk, so
 * every-page-needs-a-session specs (app-shell, demo-dashboard, i18n, theme —
 * all inherited from Phase 1, written before `/app/*` required a real
 * session) can start already authenticated with `test.use({ storageState })`
 * instead of failing on the login redirect Phase 02 now enforces.
 *
 * Uses `authenticateContext` (the real Better Auth HTTP endpoints, never the
 * login form) for the same reason `e2e/entitlements.spec.ts` and
 * `e2e/accounts.spec.ts` do: it proves the session via `/api/auth/get-session`
 * before anything depends on it, rather than trusting the login form's own
 * client-side fetch + `router.push` timing to have landed by the time the
 * next line runs.
 *
 * `e2e/auth-authorization.spec.ts` and `e2e/pricing-and-auth.spec.ts`
 * deliberately do NOT use this file's output — they test the unauthenticated
 * and authentication-transition states themselves, which a pre-authenticated
 * storage state would short-circuit.
 */
setup('authenticate as E2E_USER_A', async ({ page }) => {
  setup.skip(!hasE2eDatabase, 'DATABASE_URL is not set — see e2e/support/env.ts');

  await authenticateContext(page, E2E_USER_A);

  await page.context().storageState({ path: authStateFile });
});
