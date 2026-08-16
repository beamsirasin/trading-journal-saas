import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '@/test/integration-db';

const drizzleDirectory = join(process.cwd(), 'drizzle');
const migrationPath = join(drizzleDirectory, '0014_system_money_resolution.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');
const raw = postgres(resolveTestDatabaseUrl(), { max: 1, prepare: false });
const migrationFiles = readdirSync(drizzleDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function hash(name: string): string {
  return createHash('sha256')
    .update(readFileSync(join(drizzleDirectory, name)))
    .digest('hex')
    .toUpperCase();
}

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

async function beginIsolatedSchema() {
  await raw.unsafe('BEGIN');
  await raw.unsafe('DROP SCHEMA public CASCADE');
  await raw.unsafe('CREATE SCHEMA public');
}

describe('migration 0014 — Money-only System resolution', () => {
  afterAll(async () => raw.end());

  it('is exactly one migration after 0013 and leaves 0010–0013 byte-identical', () => {
    expect(hash('0010_trade_plan_price_money_confidence.sql')).toBe(
      '00880C0637A21571EB2F99FB8A204A521B51704393C4792D0B4AFAEDD66DED1D',
    );
    expect(hash('0011_setup_conditions_domain.sql')).toBe(
      '17D20BC15BC661A65FE9D1E44F2CAA89E0D1C3A4E6ADDBA78CC5EDD2B1B8AB21',
    );
    expect(hash('0012_emotions_and_review.sql')).toBe(
      '63E3A8F9E52BF293F97E5B26C63663FD67C979C45F3034FC6C29D7C817BB6AF6',
    );
    expect(hash('0013_actual_execution_v2.sql')).toBe(
      '6C82862C34586B6ADD329AE691AF91C9A684FC851E063A14D01F06CD4855B5AB',
    );
    expect(migrationFiles.filter((name) => Number(name.slice(0, 4)) > 13)).toEqual([
      '0014_system_money_resolution.sql',
    ]);
    expect(migrationSql).toMatch(/ADD COLUMN "system_resolution_kind" text/);
    expect(migrationSql).toMatch(/ADD COLUMN "system_gross_r_input" numeric\(12, 4\)/);
    expect(migrationSql).not.toMatch(/trade_exits|actual_result_mode|emotion|condition/i);
  });

  it('builds a fresh public schema through 0000→0014', async () => {
    await beginIsolatedSchema();
    try {
      await applyThrough(raw, 14);
      const [shape] = await raw<{ columns: number; constraints: number }[]>`
        SELECT
          (SELECT count(*)::int FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'trades'
             AND column_name IN ('system_resolution_kind', 'system_gross_r_input')) AS columns,
          (SELECT count(*)::int FROM pg_constraint
           WHERE conname IN ('trades_system_resolution_kind_check',
                             'trades_system_status_consistency_check')) AS constraints
      `;
      expect(shape).toEqual({ columns: 2, constraints: 2 });
    } finally {
      await raw.unsafe('ROLLBACK');
    }
  }, 120_000);

  it('upgrades 0013→0014 without changing resolved Price, pending, or no_trade history', async () => {
    await beginIsolatedSchema();
    try {
      await applyThrough(raw, 13);
      const ids = {
        workspace: '019b6d40-7b00-7000-8000-000000001401',
        account: '019b6d40-7b00-7000-8000-000000001402',
        strategy: '019b6d40-7b00-7000-8000-000000001403',
        version: '019b6d40-7b00-7000-8000-000000001404',
        setup: '019b6d40-7b00-7000-8000-000000001405',
        setupVersion: '019b6d40-7b00-7000-8000-000000001406',
        resolved: '019b6d40-7b00-7000-8000-000000001407',
        pending: '019b6d40-7b00-7000-8000-000000001408',
        noTrade: '019b6d40-7b00-7000-8000-000000001409',
      };
      await raw`INSERT INTO workspaces (id, name, slug, kind)
                VALUES (${ids.workspace}, '0014 fixture', 'p13f-fixture', 'personal')`;
      await raw`INSERT INTO trading_accounts
        (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone, mutation_key)
        VALUES (${ids.account}, ${ids.workspace}, 'Fixture', 'demo', 'USD', 10000, 'UTC', gen_random_uuid())`;
      await raw`INSERT INTO strategies (id, workspace_id, mutation_key)
                VALUES (${ids.strategy}, ${ids.workspace}, gen_random_uuid())`;
      await raw`INSERT INTO strategy_versions
        (id, workspace_id, strategy_id, version_number, name)
        VALUES (${ids.version}, ${ids.workspace}, ${ids.strategy}, 1, 'Fixture version')`;
      await raw`UPDATE strategies SET current_version_id = ${ids.version} WHERE id = ${ids.strategy}`;
      await raw`INSERT INTO setups (id, workspace_id, strategy_id, mutation_key)
                VALUES (${ids.setup}, ${ids.workspace}, ${ids.strategy}, gen_random_uuid())`;
      await raw`INSERT INTO strategy_setup_versions
        (id, workspace_id, strategy_id, strategy_version_id, setup_id, name)
        VALUES (${ids.setupVersion}, ${ids.workspace}, ${ids.strategy}, ${ids.version}, ${ids.setup}, 'Fixture setup')`;

      const baseColumns = raw`
        INSERT INTO trades
          (id, workspace_id, mutation_key, trading_account_id, strategy_id, strategy_version_id,
           setup_id, setup_version_id, symbol, direction, planned_entry, planned_stop,
           planned_target, planned_r, system_status, system_exit_price, system_exited_at,
           system_exit_reason, system_cost_r, system_resolved_at, system_r, system_outcome)
        VALUES
          (${ids.resolved}, ${ids.workspace}, gen_random_uuid(), ${ids.account}, ${ids.strategy},
           ${ids.version}, ${ids.setup}, ${ids.setupVersion}, 'RESOLVED', 'long', 100, 90,
           150, 5, 'resolved', 149.1234567890, '2026-08-01T12:34:56.789Z',
           'rule_exit', 0.1234, '2026-08-01T12:35:00Z', 4.7890, 'win'),
          (${ids.pending}, ${ids.workspace}, gen_random_uuid(), ${ids.account}, ${ids.strategy},
           ${ids.version}, ${ids.setup}, ${ids.setupVersion}, 'PENDING', 'long', 100, 90,
           NULL, NULL, 'pending', NULL, NULL, NULL, 0, NULL, NULL, NULL),
          (${ids.noTrade}, ${ids.workspace}, gen_random_uuid(), ${ids.account}, ${ids.strategy},
           ${ids.version}, ${ids.setup}, ${ids.setupVersion}, 'NO_TRADE', 'long', 100, 90,
           NULL, NULL, 'no_trade', NULL, NULL, 'setup_invalidated', 0,
           '2026-08-02T00:00:00Z', NULL, NULL)
      `;
      await baseColumns;
      await raw.unsafe('SET CONSTRAINTS ALL IMMEDIATE');

      const before = await raw<Record<string, unknown>[]>`
        SELECT id::text, system_status, system_exit_price::text, system_exited_at,
               system_exit_reason, system_cost_r::text, system_resolved_at,
               system_r::text, system_outcome
        FROM trades WHERE id IN (${ids.resolved}, ${ids.pending}, ${ids.noTrade}) ORDER BY id
      `;
      await applySource(raw, migrationSql);
      const after = await raw<Record<string, unknown>[]>`
        SELECT id::text, system_status, system_exit_price::text, system_exited_at,
               system_exit_reason, system_cost_r::text, system_resolved_at,
               system_r::text, system_outcome
        FROM trades WHERE id IN (${ids.resolved}, ${ids.pending}, ${ids.noTrade}) ORDER BY id
      `;
      expect(after).toEqual(before);

      const tagged = await raw<
        { id: string; system_resolution_kind: string | null; system_gross_r_input: string | null }[]
      >`SELECT id::text, system_resolution_kind, system_gross_r_input::text
         FROM trades WHERE id IN (${ids.resolved}, ${ids.pending}, ${ids.noTrade}) ORDER BY id`;
      expect(tagged).toEqual([
        { id: ids.resolved, system_resolution_kind: 'price_exit', system_gross_r_input: null },
        { id: ids.pending, system_resolution_kind: null, system_gross_r_input: null },
        { id: ids.noTrade, system_resolution_kind: null, system_gross_r_input: null },
      ]);
    } finally {
      await raw.unsafe('ROLLBACK');
    }
  }, 120_000);
});
