#!/usr/bin/env node
/**
 * Applies committed migrations to the integration-test database.
 *
 * Standalone script rather than a TypeScript module: it runs before Vitest
 * starts, outside the Next.js runtime, so it re-implements the same three
 * safety checks as `src/test/integration-db.ts` in plain JS rather than
 * importing it — mirroring why `drizzle.config.ts` already re-reads
 * `process.env` directly instead of going through `env.server.ts`. Keeping
 * both copies short and side by side is cheaper than a shared module that
 * would need its own build step to be importable from a bare `node` script.
 */
import { execFileSync } from 'node:child_process';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl === undefined || testUrl === '') {
  console.error(
    'TEST_DATABASE_URL is not set. See docs/migration-runbook.md for how to point this at a disposable database.',
  );
  process.exit(1);
}

if (testUrl === process.env.DATABASE_URL) {
  console.error('TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run.');
  process.exit(1);
}

const { hostname } = new URL(testUrl);
const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
if (!isLocalHost && process.env.TEST_DATABASE_ACK !== 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE') {
  console.error(
    `TEST_DATABASE_URL points at a non-local host (${hostname}). Set ` +
      'TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE to confirm this is disposable — ' +
      'see docs/migration-runbook.md.',
  );
  process.exit(1);
}

console.log(
  `[prepare-test-db] applying migrations to ${hostname} (test database, confirmed disposable)`,
);

// drizzle-kit reads DATABASE_MIGRATION_URL, falling back to DATABASE_URL (drizzle.config.ts).
// Setting DATABASE_MIGRATION_URL here — never DATABASE_URL itself — keeps this process's env
// from ever making the test URL look like the application's real connection string to anything
// else this script might spawn.
//
// Invoked through `pnpm exec` rather than the bare `drizzle-kit` binary
// name: a plain `execFileSync('drizzle-kit', ...)` relies on the OS PATH,
// which does not include this project's local `node_modules/.bin` — `pnpm
// exec` resolves it correctly on every platform this project targets.
execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_MIGRATION_URL: testUrl },
  shell: process.platform === 'win32',
});

console.log('[prepare-test-db] done');
