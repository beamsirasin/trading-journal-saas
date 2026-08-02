import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/server/db/schema';

/**
 * The safety boundary every integration test goes through to reach a real
 * database. Never used by application runtime code — only by
 * `*.integration.test.ts` files and `scripts/prepare-test-db.mjs`.
 *
 * Guards, in order:
 *
 * 1. `TEST_DATABASE_URL` must be set. There is no fallback to `DATABASE_URL`
 *    — a missing test database fails the test run loudly, never falls
 *    through to whatever `DATABASE_URL` happens to be.
 * 2. It must not be byte-for-byte identical to `DATABASE_URL` — the most
 *    likely real mistake is copy-pasting the wrong variable, and this catches
 *    exactly that without needing to parse or trust either connection string.
 * 3. A non-local host (anything but `localhost`/`127.0.0.1`) requires an
 *    explicit `TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE`.
 *    A hostname allowlist alone cannot distinguish a Neon test branch from a
 *    Neon production database — both live under the same `neon.tech` domain
 *    — so the real guarantee here is an unmissable, deliberately-worded
 *    opt-in for anyone pointing this at a remote host, not a regex.
 */
export function resolveTestDatabaseUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (testUrl === undefined || testUrl === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests refuse to run against DATABASE_URL — ' +
        'see docs/migration-runbook.md for how to point this at a disposable database.',
    );
  }

  if (testUrl === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run integration tests against ' +
        'what may be your real database — use a separate, disposable database.',
    );
  }

  const { hostname } = new URL(testUrl);
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (
    !isLocalHost &&
    process.env.TEST_DATABASE_ACK !== 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE'
  ) {
    throw new Error(
      `TEST_DATABASE_URL points at a non-local host (${hostname}). Integration tests will freely ` +
        'create and drop schema objects there. Set TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE ' +
        'to confirm this is a dedicated, disposable database — see docs/migration-runbook.md.',
    );
  }

  return testUrl;
}

let testClient: ReturnType<typeof postgres> | undefined;

/** A fresh Drizzle handle against the guarded test database. Callers close it with `closeTestDb()`. */
export function getTestDb() {
  testClient ??= postgres(resolveTestDatabaseUrl(), { max: 5 });
  return drizzle(testClient, { schema });
}

export async function closeTestDb(): Promise<void> {
  if (testClient !== undefined) {
    await testClient.end();
    testClient = undefined;
  }
}
