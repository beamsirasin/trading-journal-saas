import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '@/test/integration-db';

/**
 * Proves migration 0004's actual, committed SQL correctly translates the
 * retired draft plan keys (`pro`→`trader`, `elite`→`professional`) —
 * against a fixture that faithfully reproduces the schema state
 * IMMEDIATELY BEFORE 0004 (i.e. as of 0003: the old CHECK constraint that
 * still permits `pro`/`elite`), not the already-upgraded real
 * `workspace_entitlements` table this repository's test database has
 * already migrated past. Inserting a `pro`/`elite` row into THAT table
 * would simply fail with a Postgres constraint violation — which is
 * exactly why this test exists as a separate fixture instead of trying to
 * force an impossible row into the real, already-upgraded schema.
 *
 * `max: 1` is deliberate: a session-scoped `TEMP TABLE` is only visible on
 * the physical connection that created it, and `postgres.js` hands out an
 * arbitrary connection from a pool for each top-level `sql` call. Pinning
 * this client to a single connection is what guarantees every statement
 * below — create, seed, migrate, assert — runs against the same temp table
 * rather than one that silently doesn't exist from a different connection's
 * point of view.
 *
 * The CREATE TABLE and migration statements are read from the real,
 * committed migration files and only have the table name substituted —
 * never hand-retyped — so this test exercises the actual deployed SQL, not
 * a reimplementation that could drift from it.
 *
 * The three `it`s below are deliberately ORDER-DEPENDENT (pre-migration
 * constraint check → apply migration → post-migration constraint check),
 * run in declaration order (Vitest's default, unshuffled). This mirrors
 * what actually happens once, in order, in production, rather than
 * artificially re-running the whole create/seed/migrate sequence for every
 * independent assertion.
 */
const TABLE = `tmp_workspace_entitlements_0003_${Date.now().toString(36)}`;

function loadMigrationStatements(fileName: string): string[] {
  const path = join(process.cwd(), 'drizzle', fileName);
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('--> statement-breakpoint')
    .map((statement) => statement.replaceAll('workspace_entitlements', TABLE).trim())
    .filter((statement) => statement.length > 0);
}

describe('migration 0004 — pro/elite → trader/professional (real migration SQL, pre-0004 fixture)', () => {
  const sql = postgres(resolveTestDatabaseUrl(), { max: 1 });

  const workspaceIdPro = crypto.randomUUID();
  const workspaceIdElite = crypto.randomUUID();
  const workspaceIdStarter = crypto.randomUUID();
  const workspaceIdNull = crypto.randomUUID();
  const trialStartedAt = new Date('2026-01-01T00:00:00.000Z');
  const trialEndsAt = new Date('2026-01-08T00:00:00.000Z');

  beforeAll(async () => {
    // Only the CREATE TABLE statement (index [0]) from 0003 — the FK to
    // `workspaces` and the onboarding-backfill INSERT that follow it in the
    // real file need real `workspaces` rows this isolated fixture
    // deliberately has none of; the CHECK constraints (the only thing this
    // test cares about) live entirely in that first statement.
    const [createTableSql] = loadMigrationStatements('0003_add_workspace_entitlements.sql');
    if (createTableSql === undefined) {
      throw new Error('expected migration 0003 to contain a CREATE TABLE statement');
    }
    await sql.unsafe(createTableSql);

    await sql.unsafe(
      `INSERT INTO "${TABLE}" (id, workspace_id, status, plan_key, trial_started_at, trial_ends_at) VALUES
        (gen_random_uuid(), $1, 'active', 'pro', $5, $6),
        (gen_random_uuid(), $2, 'active', 'elite', $5, $6),
        (gen_random_uuid(), $3, 'active', 'starter', $5, $6),
        (gen_random_uuid(), $4, 'trialing', NULL, $5, $6)`,
      [
        workspaceIdPro,
        workspaceIdElite,
        workspaceIdStarter,
        workspaceIdNull,
        trialStartedAt,
        trialEndsAt,
      ],
    );
  });

  afterAll(async () => {
    await sql.unsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
    await sql.end();
  });

  it('rejects an unrecognized plan key under the OLD (pre-0004) constraint too — confirms the fixture is real, not permissive', async () => {
    await expect(
      sql.unsafe(
        `INSERT INTO "${TABLE}" (id, workspace_id, status, plan_key) VALUES (gen_random_uuid(), gen_random_uuid(), 'active', 'mystery')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('translates pro → trader and elite → professional, preserves starter/null, and preserves every workspace_id and timestamp', async () => {
    const migrationStatements = loadMigrationStatements(
      '0004_rename_plan_keys_trader_professional.sql',
    );
    for (const statement of migrationStatements) {
      await sql.unsafe(statement);
    }

    const rows = await sql.unsafe<
      {
        workspace_id: string;
        plan_key: string | null;
        trial_started_at: Date;
        trial_ends_at: Date;
      }[]
    >(
      `SELECT workspace_id, plan_key, trial_started_at, trial_ends_at FROM "${TABLE}" ORDER BY plan_key NULLS LAST`,
    );

    const byWorkspace = new Map(rows.map((row) => [row.workspace_id, row]));

    expect(byWorkspace.get(workspaceIdPro)?.plan_key).toBe('trader');
    expect(byWorkspace.get(workspaceIdElite)?.plan_key).toBe('professional');
    expect(byWorkspace.get(workspaceIdStarter)?.plan_key).toBe('starter');
    expect(byWorkspace.get(workspaceIdNull)?.plan_key).toBeNull();

    // No row was dropped or duplicated, and no timestamp or workspace_id
    // moved — the migration is a pure in-place key rename.
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(new Date(row.trial_started_at).toISOString()).toBe(trialStartedAt.toISOString());
      expect(new Date(row.trial_ends_at).toISOString()).toBe(trialEndsAt.toISOString());
    }
  });

  it('the new constraint rejects pro/elite after migration', async () => {
    await expect(
      sql.unsafe(
        `INSERT INTO "${TABLE}" (id, workspace_id, status, plan_key) VALUES (gen_random_uuid(), gen_random_uuid(), 'active', 'pro')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql.unsafe(
        `INSERT INTO "${TABLE}" (id, workspace_id, status, plan_key) VALUES (gen_random_uuid(), gen_random_uuid(), 'active', 'elite')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // The locked, current keys remain accepted.
    await expect(
      sql.unsafe(
        `INSERT INTO "${TABLE}" (id, workspace_id, status, plan_key) VALUES (gen_random_uuid(), gen_random_uuid(), 'active', 'professional')`,
      ),
    ).resolves.toBeDefined();
  });
});
