#!/usr/bin/env node
/**
 * Phase 11E — guarded TEST-only fixture reset.
 *
 * `admin_audit_log` is append-only at the DATABASE level (migration 0009's
 * `admin_audit_log_protect_delete_trigger`, `BEFORE DELETE ... FOR EACH ROW`,
 * unconditionally rejects every DELETE, no bypass) and `platform_admins`
 * rows referenced by an audit row as `actor_admin_id` become RESTRICT-locked
 * once referenced. Every integration test file that exercises an Admin
 * mutation therefore leaves its admin/audit fixtures behind after DELETE-
 * based teardown, and repeated full-suite runs accumulate them without
 * bound.
 *
 * `TRUNCATE` is a different operation from `DELETE`: Postgres only fires
 * triggers explicitly declared `FOR EACH STATEMENT ... TRUNCATE` on it, and
 * this schema declares none — so `TRUNCATE ... CASCADE` empties every table
 * in this disposable TEST database that transitively references `users`/
 * `workspaces`, including `admin_audit_log`, WITHOUT ever invoking the
 * append-only DELETE trigger and without weakening it. This script is gated
 * by the exact same `validateTestDatabaseEnvironment` safety check every
 * other destructive test script uses (TEST_DATABASE_URL naming a `test`/
 * `e2e` database, distinct from DATABASE_URL, plus an explicit
 * TEST_DATABASE_ACK) — it can never run against production, and no
 * equivalent exists in any production/runtime code path.
 *
 * THREE WRINKLES, all because CASCADE follows the full transitive FK closure,
 * not just direct children:
 *
 * 1. `mistake_types` is not purely tenant fixture data — its nine canonical
 *    system rows (`workspace_id IS NULL`, seeded once by migration 0008) are
 *    global reference data every Trade/discipline feature depends on,
 *    co-located in the SAME table as workspace-owned custom mistake types.
 *    TRUNCATE is table-granular, not row-granular, so cascading through
 *    `mistake_types` (a direct child of `workspaces`) necessarily removes
 *    those nine rows too.
 * 2. `platform_vat_configuration` has no direct FK to `users`/`workspaces`,
 *    but its `created_by_admin_id` references `platform_admins`, which
 *    itself references `users` — so it is still reached transitively, and
 *    migration 0009's single bootstrap row (`enabled=false`, 700 basis
 *    points, `reason_code='bootstrap'`) is removed with it.
 *
 * 3. Phase 13D's `emotion_types` has the same mixed global-system/custom
 *    tenancy shape as `mistake_types`, so its ten canonical rows are also
 *    removed by the cascade.
 *
 * This script re-seeds all three immediately after truncating, using the EXACT
 * INSERTs the source migrations use — copied verbatim rather than
 * re-derived, so they can never silently drift from what a fresh migrated
 * database actually contains.
 *
 * Run this BETWEEN full integration-suite executions (CI or locally) to
 * keep the shared TEST database from accumulating fixtures across runs; it
 * is not invoked automatically by any individual test file.
 */
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

const { testUrl, hostname } = validateTestDatabaseEnvironment();
// `onnotice: () => {}` silences Postgres's routine "truncate cascades to
// table ..." NOTICE spam (one per cascaded table) — informational only, not
// an error, and otherwise drowns out this script's own summary output.
const sql = postgres(testUrl, { max: 1, onnotice: () => {} });

// Truncating these two root tables CASCADEs to every table that transitively
// references them via a foreign key — which, in this schema, is every
// tenant-owned business table plus the admin tables (`admin_audit_log`,
// `platform_admins`). `platform_vat_configuration` deliberately has no such
// FK and is not listed here — see the module comment.
const ROOT_TABLES = ['users', 'workspaces'];

console.log(`[reset-test-database] truncating ${hostname} (confirmed disposable TEST database)`);
// `ROOT_TABLES` is a fixed, hardcoded literal in this trusted script, never
// external input — `sql.unsafe` here is not building a query from anything
// a caller supplies, unlike every real application query in this codebase.
await sql.unsafe(`truncate table ${ROOT_TABLES.join(', ')} cascade`);

// Re-seed the nine canonical system mistake types — copied verbatim from
// drizzle/0008_trade_domain_and_discipline.sql's own seed INSERT.
await sql`
  INSERT INTO "mistake_types" ("id", "workspace_id", "key", "label", "severity", "default_weight", "is_system", "is_archived", "sort_order")
  VALUES
    ('019fd76f-1f75-723e-8772-3b408eb1b6cb', NULL, 'moved_stop', 'Moved stop', 'moderate', 1.0000, true, false, 0),
    ('019fd76f-1f76-7b7b-b40b-586254407590', NULL, 'early_exit', 'Early exit', 'moderate', 1.0000, true, false, 1),
    ('019fd76f-1f76-7b7b-b40b-586347a75b60', NULL, 'oversized_position', 'Oversized position', 'moderate', 1.0000, true, false, 2),
    ('019fd76f-1f76-7b7b-b40b-58642644a520', NULL, 'no_setup', 'No setup', 'moderate', 1.0000, true, false, 3),
    ('019fd76f-1f76-7b7b-b40b-586587215439', NULL, 'revenge_trade', 'Revenge trade', 'moderate', 1.0000, true, false, 4),
    ('019fd76f-1f76-7b7b-b40b-58668a23e267', NULL, 'chased_entry', 'Chased entry', 'moderate', 1.0000, true, false, 5),
    ('019fd76f-1f77-7dce-b59d-b0af9e8c3cc8', NULL, 'ignored_invalidation', 'Ignored invalidation', 'moderate', 1.0000, true, false, 6),
    ('019fd76f-1f77-7dce-b59d-b0b0c43f0a1a', NULL, 'moved_target', 'Moved target', 'moderate', 1.0000, true, false, 7),
    ('019fd76f-1f77-7dce-b59d-b0b19f89e886', NULL, 'no_stop', 'No stop', 'moderate', 1.0000, true, false, 8)
  ON CONFLICT ("key") WHERE "is_system" DO NOTHING
`;

// Re-seed the ten canonical system Emotion types — copied verbatim from
// drizzle/0012_emotions_and_review.sql.
await sql`
  INSERT INTO "emotion_types" ("id", "workspace_id", "key", "label", "is_system", "is_archived", "sort_order")
  VALUES
    ('019b6d40-7a00-7000-8000-000000000001', NULL, 'calm', 'Calm', true, false, 0),
    ('019b6d40-7a00-7000-8000-000000000002', NULL, 'focused', 'Focused', true, false, 1),
    ('019b6d40-7a00-7000-8000-000000000003', NULL, 'fearful', 'Fearful', true, false, 2),
    ('019b6d40-7a00-7000-8000-000000000004', NULL, 'fomo', 'FOMO', true, false, 3),
    ('019b6d40-7a00-7000-8000-000000000005', NULL, 'greedy', 'Greedy', true, false, 4),
    ('019b6d40-7a00-7000-8000-000000000006', NULL, 'hesitant', 'Hesitant', true, false, 5),
    ('019b6d40-7a00-7000-8000-000000000007', NULL, 'revenge', 'Revenge', true, false, 6),
    ('019b6d40-7a00-7000-8000-000000000008', NULL, 'excited', 'Excited', true, false, 7),
    ('019b6d40-7a00-7000-8000-000000000009', NULL, 'tired', 'Tired', true, false, 8),
    ('019b6d40-7a00-7000-8000-00000000000a', NULL, 'frustrated', 'Frustrated', true, false, 9)
  ON CONFLICT ("key") WHERE "is_system" DO NOTHING
`;

// Re-seed the single VAT bootstrap row — copied verbatim from drizzle/
// 0009_platform_admin_foundation.sql's own seed INSERT, made idempotent
// with an explicit existence check since that INSERT has no ON CONFLICT
// clause of its own (a fresh migrated database only ever runs it once).
// `effective_at` deliberately uses a fixed, clearly-historical timestamp
// instead of `now()`: the real migration's `now()` evaluates once, at
// whenever the database was first created — normally long before any
// fixture data. A RESET can run at any time, including after test files
// that construct fixed-clock scenarios dated in 2026; seeding with real
// "now" risks the reseeded baseline landing AFTER such a fixed test date,
// which would make Phase 11F's `effective_at <= now` resolver find no
// baseline row for that date and fail closed incorrectly. A date earlier
// than every fixed test-clock instant in this codebase avoids that.
await sql`
  INSERT INTO "platform_vat_configuration"
    ("id", "enabled", "rate_basis_points", "effective_at", "created_by_admin_id", "reason_code", "reason_note", "created_at")
  SELECT
    gen_random_uuid(), false, 700, '2000-01-01T00:00:00Z'::timestamptz, NULL, 'bootstrap',
    'Launch baseline seeded by migration 0009: VAT disabled, rate prepared at 7.00%. Mirrors src/config/billing.server.ts DEFAULT_VAT_CONFIGURATION, which remains the live source until Phase 11F wiring.',
    now()
  WHERE NOT EXISTS (SELECT 1 FROM "platform_vat_configuration")
`;

const [{ count: userCount }] = await sql`select count(*)::int as count from users`;
const [{ count: workspaceCount }] = await sql`select count(*)::int as count from workspaces`;
const [{ count: adminCount }] = await sql`select count(*)::int as count from platform_admins`;
const [{ count: auditCount }] = await sql`select count(*)::int as count from admin_audit_log`;
const [{ count: systemMistakeCount }] = await sql`
  select count(*)::int as count from mistake_types where is_system
`;
const [{ count: systemEmotionCount }] = await sql`
  select count(*)::int as count from emotion_types where is_system
`;
const [{ count: vatConfigCount }] =
  await sql`select count(*)::int as count from platform_vat_configuration`;

console.log(
  `[reset-test-database] post-reset counts — users=${userCount} workspaces=${workspaceCount} ` +
    `platform_admins=${adminCount} admin_audit_log=${auditCount} ` +
    `system_mistake_types=${systemMistakeCount} system_emotion_types=${systemEmotionCount} ` +
    `platform_vat_configuration=${vatConfigCount}`,
);

if (
  userCount !== 0 ||
  workspaceCount !== 0 ||
  adminCount !== 0 ||
  auditCount !== 0 ||
  systemMistakeCount !== 9 ||
  systemEmotionCount !== 10 ||
  vatConfigCount < 1
) {
  await sql.end();
  throw new Error(
    'Reset did not leave the TEST database in the expected state — refusing to report success.',
  );
}

console.log(
  '[reset-test-database] done — fixtures cleared, migration-seeded reference data intact.',
);
await sql.end();
