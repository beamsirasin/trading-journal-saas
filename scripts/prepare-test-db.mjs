#!/usr/bin/env node
/** Applies committed migrations to a guarded, disposable test database. */
import { execFileSync } from 'node:child_process';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

let guarded;
try {
  guarded = validateTestDatabaseEnvironment();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { hostname } = guarded;
console.log(`[prepare-test-db] applying migrations to ${hostname} (confirmed disposable)`);

/*
  THE URL IS NOT PASSED DOWN — THE MARKER IS.

  This used to hand the test URL to drizzle-kit as DATABASE_MIGRATION_URL. That
  read as harmless plumbing and was not: the developer-write guard in
  drizzle.config.ts compares DATABASE_URL against DATABASE_MIGRATION_URL and
  refuses when they name different databases, which — for a test database whose
  contract REQUIRES it to be a different database — is unconditional. The script
  could not run at all, so the disposable database silently stopped receiving
  migrations.

  The marker instead tells the config which of the two guards applies, and the
  config re-derives the URL by validating TEST_DATABASE_URL itself. Nothing here
  is trusted downstream: the same disposability checks run again on the other
  side. DATABASE_URL and DATABASE_MIGRATION_URL are both left untouched, so a
  subprocess can never mistake this administrative run for the app's connection.
*/
execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: { ...process.env, DRIZZLE_TEST_DATABASE_MIGRATION: '1' },
  shell: process.platform === 'win32',
});

console.log('[prepare-test-db] done');
