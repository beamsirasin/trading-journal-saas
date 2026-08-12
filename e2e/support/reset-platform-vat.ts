import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';
import { generateId } from '../../src/lib/identifiers';
import { platformVatConfiguration } from '../../src/server/db/schema';

/**
 * Restores the deterministic TEST VAT baseline (`enabled: false`, 700 basis
 * points) directly in the guarded TEST database — a safety net independent
 * of `admin-vat.spec.ts`'s own UI-driven "disable again" steps.
 *
 * `platform_vat_configuration` is the one genuinely platform-global,
 * append-only, mutable singleton any E2E spec touches (unlike every other
 * fixture in this repo, which is scoped to a Workspace/user).
 * `getEffectivePlatformVatConfiguration()` always selects the row with the
 * greatest `effective_at`, so restoring the baseline requires inserting a
 * NEW row with `effective_at = now()` — an equivalent-shaped row with an
 * old/fixed timestamp (as `scripts/reset-test-database.mjs` uses between
 * full-suite runs) would NOT become the current row, since a later,
 * incorrect mutation would still sort after it.
 *
 * Call this from a `test.afterAll()` in any spec that mutates VAT — never
 * from inside an individual test — so it runs exactly once, unconditionally,
 * regardless of whether the file's own tests passed, failed, or were skipped
 * (Playwright runs `afterAll` in all three cases). This is what actually
 * closes the gap `admin-vat.spec.ts`'s own header comment already flagged:
 * a transient failure in an EARLIER serial test that enables VAT, before it
 * reaches its own later "disable again" step, permanently leaves VAT
 * enabled for the rest of a single-worker CI run — because `mode: 'serial'`
 * skips every subsequent test (including the one that would have restored
 * it) once one test in the group fails, and no independent hook previously
 * guaranteed cleanup regardless of outcome.
 *
 * Deliberately a raw insert via `postgres`/`drizzle`, not a call into
 * `changeVatConfiguration` (`src/server/services/admin/vat-configuration-
 * support.ts`) — that module carries `import 'server-only'` transitively,
 * the same constraint every other `e2e/support/provision-*.ts` helper routes
 * around by connecting directly instead.
 */
export async function resetPlatformVatConfigurationForE2e(connectionUrl: string): Promise<void> {
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error('Refusing to reset VAT configuration outside the guarded TEST_DATABASE_URL.');
  }

  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, { schema: { platformVatConfiguration } });
  try {
    await db.insert(platformVatConfiguration).values({
      id: generateId(),
      enabled: false,
      rateBasisPoints: 700,
      effectiveAt: new Date(),
      createdByAdminId: null,
      reasonCode: 'configuration_change',
      reasonNote: 'E2E afterAll safety-net restore to the deterministic TEST baseline.',
    });
  } finally {
    await client.end();
  }
}
