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

const { testUrl, hostname } = guarded;
console.log(`[prepare-test-db] applying migrations to ${hostname} (confirmed disposable)`);

// drizzle-kit reads DATABASE_MIGRATION_URL. Keep DATABASE_URL untouched so
// any subprocess cannot mistake this administrative connection for the app's.
execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_MIGRATION_URL: testUrl },
  shell: process.platform === 'win32',
});

console.log('[prepare-test-db] done');
