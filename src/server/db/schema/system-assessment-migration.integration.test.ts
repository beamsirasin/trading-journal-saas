/**
 * MIGRATION 0017 — what the database itself must refuse.
 *
 * The domain layer's rules are only as good as the constraint underneath them:
 * a service can be bypassed by a script, a fixture or a future caller, and the
 * CHECK cannot. These cases exercise the rewritten consistency constraint
 * directly with INSERTs, against a throwaway schema inside a transaction that is
 * always rolled back.
 *
 * THE CONSTRAINT IS ORGANIZED BY SEMANTIC GROUP, and that is what is under test:
 * a RESULT PAYLOAD belongs only to `resolved`, while ASSESSMENT METADATA — the
 * confirmation timestamp and the dependency snapshot — belongs to every
 * completed assessment, including the two that have no result at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '@/test/integration-db';

const drizzleDirectory = join(process.cwd(), 'drizzle');
const migrationFiles = readdirSync(drizzleDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const migrationName = migrationFiles.find((name) => name.startsWith('0017_')) ?? '0017_missing.sql';
const migrationSql = readFileSync(join(drizzleDirectory, migrationName), 'utf8');
const correctiveMigrationName =
  migrationFiles.find((name) => name.startsWith('0018_')) ?? '0018_missing.sql';
const correctiveMigrationSql = readFileSync(
  join(drizzleDirectory, correctiveMigrationName),
  'utf8',
);
const raw = postgres(resolveTestDatabaseUrl(), { max: 1, prepare: false });

async function applySource(sql: Sql, source: string) {
  for (const statement of source.split('--> statement-breakpoint')) {
    if (statement.trim() !== '') await sql.unsafe(statement);
  }
}

async function applyThrough(sql: Sql, lastIndex: number) {
  for (const name of migrationFiles) {
    if (Number(name.slice(0, 4)) <= lastIndex) {
      await applySource(sql, readFileSync(join(drizzleDirectory, name), 'utf8'));
    }
  }
}

async function beginIsolatedSchema(lastIndex = 17) {
  await raw.unsafe('BEGIN');
  await raw.unsafe('DROP SCHEMA public CASCADE');
  await raw.unsafe('CREATE SCHEMA public');
  await applyThrough(raw, lastIndex);
}

/** Minimal owning rows, so a `trades` INSERT has something to reference. */
async function seedScaffolding(): Promise<{ workspaceId: string; accountId: string }> {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const userId = 'user-system-assessment-fixture';
  const accountId = '00000000-0000-4000-8000-000000000003';
  await raw.unsafe(
    `INSERT INTO users (id, name, email, email_verified)
     VALUES ('${userId}', 'A', 'a@example.test', true)`,
  );
  await raw.unsafe(
    `INSERT INTO workspaces (id, name, slug, kind, personal_owner_user_id)
     VALUES ('${workspaceId}', 'W', 'w', 'personal', '${userId}')`,
  );
  await raw.unsafe(
    `INSERT INTO trading_accounts
       (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone)
     VALUES ('${accountId}', '${workspaceId}', 'Acct', 'live', 'USD', '10000', 'UTC')`,
  );
  return { workspaceId, accountId };
}

let tradeCounter = 0;

/** Inserts a Trade with the given System columns, returning the DB's verdict. */
async function insertTrade(
  scaffolding: { workspaceId: string; accountId: string },
  systemColumns: Record<string, string>,
  plan: { risk: string; reward: string; r: string } = {
    risk: '10000',
    reward: '50000',
    r: `'5.0000'`,
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  tradeCounter += 1;
  const id = `00000000-0000-4000-8000-${String(100 + tradeCounter).padStart(12, '0')}`;
  const names = Object.keys(systemColumns);
  const values = Object.values(systemColumns);
  /*
    EACH INSERT GETS ITS OWN SAVEPOINT, AND THAT IS LOAD-BEARING.

    A CHECK violation aborts the enclosing transaction: every statement after it
    fails with "current transaction is aborted" regardless of its own merits. In
    a test whose whole purpose is to assert a sequence of REFUSALS, that turns
    every case after the first into a pass for the wrong reason — a suite that
    would stay green if the constraint stopped working entirely. Rolling back to
    a savepoint keeps each case's verdict its own.
  */
  const savepoint = `sp_${tradeCounter}`;
  await raw.unsafe(`SAVEPOINT ${savepoint}`);
  try {
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, symbol, direction,
         status, planned_risk_minor, planned_reward_minor, planned_r
         ${names.length > 0 ? ', ' + names.join(', ') : ''})
       VALUES ('${id}', '${scaffolding.workspaceId}', '${id}', '${scaffolding.accountId}',
         'XAUUSD', 'long', 'planned', ${plan.risk}, ${plan.reward}, ${plan.r}
         ${values.length > 0 ? ', ' + values.join(', ') : ''})`,
    );
    await raw.unsafe(`RELEASE SAVEPOINT ${savepoint}`);
    return { ok: true };
  } catch (error) {
    await raw.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

const RESOLVED_NET = {
  system_status: `'resolved'`,
  system_resolution_kind: `'money_target'`,
  system_gross_r_input: `'5.0000'`,
  system_exit_reason: `'target_hit'`,
  system_resolved_at: 'now()',
  system_gross_r: `'5.0000'`,
  system_cost_r: `'0.2000'`,
  system_r: `'4.8000'`,
  system_outcome: `'win'`,
};

describe('migration 0017 — System Assessment schema', () => {
  afterAll(async () => raw.end());

  it('is exactly one migration after 0016 and touches only System/adherence shape', () => {
    expect(
      migrationFiles.filter(
        (name) => Number(name.slice(0, 4)) > 16 && Number(name.slice(0, 4)) <= 17,
      ),
    ).toEqual([migrationName]);
    expect(migrationSql).toMatch(/ADD COLUMN "system_gross_r" numeric\(12, 4\)/);
    expect(migrationSql).toMatch(/ADD COLUMN "system_dependency_snapshot" jsonb/);
    expect(migrationSql).toMatch(/ADD COLUMN "system_plan_provenance" text/);
    expect(migrationSql).toMatch(/ADD COLUMN "plan_adherence" text/);
    expect(migrationSql).toMatch(/ALTER COLUMN "system_cost_r" DROP NOT NULL/);
    expect(migrationSql).toMatch(/ALTER COLUMN "system_cost_r" DROP DEFAULT/);
    // `followed_plan` is NOT dropped here — a later cleanup migration's job.
    expect(migrationSql).not.toMatch(/DROP COLUMN "followed_plan"/);
    // Nothing unrelated rides along.
    expect(migrationSql).not.toMatch(/trade_exits|emotion|mistake|billing/i);
  });

  it('adds one CHECK-only corrective migration after 0017', () => {
    expect(migrationFiles.filter((name) => Number(name.slice(0, 4)) === 18)).toEqual([
      correctiveMigrationName,
    ]);
    expect(correctiveMigrationSql).toMatch(
      /DROP CONSTRAINT "trades_system_status_consistency_check"/,
    );
    expect(correctiveMigrationSql).toMatch(
      /ADD CONSTRAINT "trades_system_status_consistency_check"/,
    );
    expect(correctiveMigrationSql).not.toMatch(/\bUPDATE\b|ADD COLUMN|DROP COLUMN/i);
    expect(correctiveMigrationSql).not.toMatch(/system_gross_r_input" = "trades"\."planned_r"/);
  });

  it('0018 accepts stale confirmed truth and rejects contradictory confirmed payloads', async () => {
    await beginIsolatedSchema(18);
    try {
      const scaffolding = await seedScaffolding();
      const snapshot =
        `jsonb_build_object('v', 1, 'resolutionKind', 'money_target', ` +
        `'exitReason', 'target_hit', 'plannedRiskMinor', '10000', ` +
        `'plannedRewardMinor', '50000')`;

      const stale = await insertTrade(
        scaffolding,
        { ...RESOLVED_NET, system_dependency_snapshot: snapshot },
        { risk: '10000', reward: '100000', r: `'10.0000'` },
      );
      expect(stale.ok).toBe(true);

      const mismatchedGross = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_gross_r_input: `'6.0000'`,
      });
      expect(mismatchedGross.ok).toBe(false);

      const mismatchedNet = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_r: `'4.7000'`,
      });
      expect(mismatchedNet.ok).toBe(false);

      const mismatchedOutcome = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_outcome: `'loss'`,
      });
      expect(mismatchedOutcome.ok).toBe(false);

      const missingKind = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_resolution_kind: 'NULL',
      });
      expect(missingKind.ok).toBe(false);
    } finally {
      await raw.unsafe('ROLLBACK');
    }
  });

  it('backfills gross R by arithmetic and never touches a resolved row’s cost', async () => {
    await beginIsolatedSchema();
    try {
      // The data steps are hand-added because drizzle-kit emits DDL only.
      expect(migrationSql).toMatch(/UPDATE "trades"\s+SET "system_gross_r"/);
      expect(migrationSql).toMatch(
        /system_gross_r" = "system_r" \+ COALESCE\("system_cost_r", 0\)/,
      );
      // Cost is nulled ONLY where it was schema-mandated filler.
      expect(migrationSql).toMatch(
        /UPDATE "trades" SET "system_cost_r" = NULL WHERE "system_status" <> 'resolved'/,
      );
    } finally {
      await raw.unsafe('ROLLBACK');
    }
  });

  it('accepts every new-model System state and refuses contradictory ones', async () => {
    await beginIsolatedSchema();
    try {
      const scaffolding = await seedScaffolding();

      // --- accepted -----------------------------------------------------
      expect((await insertTrade(scaffolding, RESOLVED_NET)).ok).toBe(true);

      // Gross-only: cost unknown, so no net R and no outcome verdict.
      expect(
        (
          await insertTrade(scaffolding, {
            ...RESOLVED_NET,
            system_cost_r: 'NULL',
            system_r: 'NULL',
            system_outcome: 'NULL',
          })
        ).ok,
      ).toBe(true);

      // `cannot_determine` — a completed assessment with metadata and no result.
      expect(
        (
          await insertTrade(scaffolding, {
            system_status: `'cannot_determine'`,
            system_resolved_at: 'now()',
            system_dependency_snapshot: `'{"v":1,"resolutionKind":null}'::jsonb`,
            system_plan_provenance: `'unknown'`,
            plan_adherence: `'partly'`,
          })
        ).ok,
      ).toBe(true);

      // `no_trade` — likewise a finding that carries what it rested on.
      expect(
        (
          await insertTrade(scaffolding, {
            system_status: `'no_trade'`,
            system_exit_reason: `'setup_invalidated'`,
            system_resolved_at: 'now()',
            system_dependency_snapshot: `'{"v":1,"resolutionKind":null}'::jsonb`,
            plan_adherence: `'not_followed'`,
          })
        ).ok,
      ).toBe(true);

      // A resolution with NO System exit instant — the counterfactual has a
      // magnitude whether or not anyone recorded when it would have closed.
      expect((await insertTrade(scaffolding, RESOLVED_NET)).ok).toBe(true);

      // --- refused ------------------------------------------------------
      // `cannot_determine` may never carry an invented result.
      const inventedResult = await insertTrade(scaffolding, {
        system_status: `'cannot_determine'`,
        system_resolved_at: 'now()',
        system_r: `'1.0000'`,
      });
      expect(inventedResult.ok).toBe(false);

      // `no_trade` may never carry System R.
      const noTradeWithR = await insertTrade(scaffolding, {
        system_status: `'no_trade'`,
        system_exit_reason: `'setup_invalidated'`,
        system_resolved_at: 'now()',
        system_gross_r: `'2.0000'`,
      });
      expect(noTradeWithR.ok).toBe(false);

      // A half-costed resolution: cost known but no net R.
      const halfCosted = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_r: 'NULL',
        system_outcome: 'NULL',
      });
      expect(halfCosted.ok).toBe(false);

      // A net R with no cost — the formula's right-hand side cannot be missing.
      const netWithoutCost = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_cost_r: 'NULL',
      });
      expect(netWithoutCost.ok).toBe(false);

      // Resolved without the frozen gross figure.
      const noGross = await insertTrade(scaffolding, { ...RESOLVED_NET, system_gross_r: 'NULL' });
      expect(noGross.ok).toBe(false);

      // A time-based exit genuinely needs its time.
      const timeExitWithoutTime = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_resolution_kind: `'money_custom'`,
        system_gross_r_input: `'2.0000'`,
        system_exit_reason: `'time_exit'`,
      });
      expect(timeExitWithoutTime.ok).toBe(false);

      // `pending` may never carry assessment metadata or a confirmation.
      const pendingConfirmed = await insertTrade(scaffolding, {
        system_status: `'pending'`,
        system_resolved_at: 'now()',
      });
      expect(pendingConfirmed.ok).toBe(false);

      // A negative cost is still refused.
      const negativeCost = await insertTrade(scaffolding, {
        ...RESOLVED_NET,
        system_cost_r: `'-0.1000'`,
        system_r: `'5.1000'`,
      });
      expect(negativeCost.ok).toBe(false);

      // Adherence and provenance are closed sets.
      expect((await insertTrade(scaffolding, { plan_adherence: `'sort_of'` })).ok).toBe(false);
      expect((await insertTrade(scaffolding, { system_plan_provenance: `'guessed'` })).ok).toBe(
        false,
      );

      // `partly` — the value a boolean could never hold — is accepted.
      expect((await insertTrade(scaffolding, { plan_adherence: `'partly'` })).ok).toBe(true);
    } finally {
      await raw.unsafe('ROLLBACK');
    }
  });

  it('keeps followed_plan and plan_adherence as independent columns', async () => {
    await beginIsolatedSchema();
    try {
      const [shape] = await raw<{ followed: number; adherence: number }[]>`
        SELECT
          (SELECT count(*)::int FROM information_schema.columns
           WHERE table_schema='public' AND table_name='trades' AND column_name='followed_plan') AS followed,
          (SELECT count(*)::int FROM information_schema.columns
           WHERE table_schema='public' AND table_name='trades' AND column_name='plan_adherence') AS adherence
      `;
      expect(shape).toEqual({ followed: 1, adherence: 1 });
    } finally {
      await raw.unsafe('ROLLBACK');
    }
  });
});
