/**
 * The one formula for what `BETTER_AUTH_SECRET` the Playwright-managed web
 * server actually runs with — `playwright.config.ts`'s `webServer.env` uses
 * this exact function, and so must anything that needs to sign a cookie the
 * SAME running server will verify (`e2e/support/authenticate.ts`'s
 * database-session fixture). Duplicating the fallback literal in two places
 * would risk silent drift; importing this one function cannot.
 */
export const E2E_DEFAULT_BETTER_AUTH_SECRET =
  'playwright-loopback-only-secret-never-use-in-production';

export function resolveE2eBetterAuthSecret(): string {
  return process.env.BETTER_AUTH_SECRET ?? E2E_DEFAULT_BETTER_AUTH_SECRET;
}
