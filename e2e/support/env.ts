/**
 * Auth and app-shell E2E tests require a migrated disposable database. The
 * Playwright config validates TEST_DATABASE_URL and passes only that guarded
 * value to the production web server as DATABASE_URL.
 */
export const hasE2eDatabase = Boolean(process.env.TEST_DATABASE_URL);

export const E2E_SKIP_REASON =
  'TEST_DATABASE_URL is not set for this e2e run - see docs/migration-runbook.md. ' +
  'The database-backed suite runs for real in CI.';
