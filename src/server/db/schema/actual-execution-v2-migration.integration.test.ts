import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '@/test/integration-db';

const root = process.cwd();
const drizzleDirectory = join(root, 'drizzle');
const migrationPath = join(drizzleDirectory, '0013_actual_execution_v2.sql');
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

async function applyThrough(sql: Sql, lastIndex: number) {
  for (const name of migrationFiles) {
    if (Number(name.slice(0, 4)) > lastIndex) continue;
    const source = readFileSync(join(drizzleDirectory, name), 'utf8');
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim() !== '') await sql.unsafe(statement);
    }
  }
}

async function beginIsolatedSchema() {
  await raw.unsafe('BEGIN');
  await raw.unsafe('DROP SCHEMA public CASCADE');
  await raw.unsafe('CREATE SCHEMA public');
}

async function rollbackIsolatedSchema() {
  await raw.unsafe('ROLLBACK');
}

describe('migration 0013 — Actual Execution V2', () => {
  afterAll(async () => raw.end());

  it('is the only migration after 0012 and leaves 0010–0012 byte-identical', () => {
    expect(hash('0010_trade_plan_price_money_confidence.sql')).toBe(
      '00880C0637A21571EB2F99FB8A204A521B51704393C4792D0B4AFAEDD66DED1D',
    );
    expect(hash('0011_setup_conditions_domain.sql')).toBe(
      '17D20BC15BC661A65FE9D1E44F2CAA89E0D1C3A4E6ADDBA78CC5EDD2B1B8AB21',
    );
    expect(hash('0012_emotions_and_review.sql')).toBe(
      '63E3A8F9E52BF293F97E5B26C63663FD67C979C45F3034FC6C29D7C817BB6AF6',
    );
    expect(migrationFiles.filter((name) => Number(name.slice(0, 4)) > 12)).toEqual([
      '0013_actual_execution_v2.sql',
    ]);
  });

  it('contains only the Phase 13E column/table/backfill and integrity machinery', () => {
    expect(migrationSql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(migrationSql).toMatch(/CREATE TABLE "trade_exits"/);
    expect(migrationSql).toMatch(/ADD COLUMN "actual_result_mode" text/);
    expect(migrationSql).toMatch(/SET "actual_result_mode" = 'money'/);
    expect(migrationSql).toMatch(/"closed_bps"[^\n]+10000/);
    expect(migrationSql).toMatch(/trade_exits_guard_trigger/);
    expect(migrationSql).toMatch(/trade_exits_consistency_trigger/);
    expect(migrationSql).toMatch(/trades_actual_mode_immutability_trigger/);
    expect(migrationSql).not.toMatch(/system_gross|execution_gap|emotion|condition/i);
  });

  it('builds a fresh public schema through 0000→0013', async () => {
    await beginIsolatedSchema();
    try {
      await applyThrough(raw, 13);
      const [shape] = await raw<
        {
          mode_columns: number;
          exit_tables: number;
          guard_triggers: number;
        }[]
      >`
          SELECT
            (SELECT count(*)::int FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'trades'
                AND column_name = 'actual_result_mode') AS mode_columns,
            (SELECT count(*)::int FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'trade_exits') AS exit_tables,
            (SELECT count(*)::int FROM pg_trigger
              WHERE tgname IN (
                'trade_exits_guard_trigger',
                'trade_exits_consistency_trigger',
                'trades_execution_consistency_trigger',
                'trades_actual_mode_immutability_trigger'
              ) AND NOT tgisinternal) AS guard_triggers
        `;
      expect(shape).toEqual({ mode_columns: 1, exit_tables: 1, guard_triggers: 4 });
    } finally {
      await rollbackIsolatedSchema();
    }
  }, 120_000);

  it('upgrades 0012→0013 with value-stable closed backfill and truthful legacy-open Money policy', async () => {
    await beginIsolatedSchema();
    try {
      await applyThrough(raw, 12);
      const ids = {
        workspace: '019b6d40-7a00-7000-8000-000000001301',
        account: '019b6d40-7a00-7000-8000-000000001302',
        strategy: '019b6d40-7a00-7000-8000-000000001303',
        version: '019b6d40-7a00-7000-8000-000000001304',
        setup: '019b6d40-7a00-7000-8000-000000001305',
        setupVersion: '019b6d40-7a00-7000-8000-000000001306',
        openTrade: '019b6d40-7a00-7000-8000-000000001307',
        closedTrade: '019b6d40-7a00-7000-8000-000000001308',
      };
      await raw`
          INSERT INTO workspaces (id, name, slug, kind)
          VALUES (${ids.workspace}, '0013 fixture', 'p13e-fixture', 'personal')
        `;
      await raw`
          INSERT INTO trading_accounts
            (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone, mutation_key)
          VALUES
            (${ids.account}, ${ids.workspace}, 'Fixture', 'demo', 'USD', 10000, 'UTC', gen_random_uuid())
        `;
      await raw`
          INSERT INTO strategies (id, workspace_id, mutation_key)
          VALUES (${ids.strategy}, ${ids.workspace}, gen_random_uuid())
        `;
      await raw`
          INSERT INTO strategy_versions
            (id, workspace_id, strategy_id, version_number, name)
          VALUES (${ids.version}, ${ids.workspace}, ${ids.strategy}, 1, 'Fixture version')
        `;
      await raw`UPDATE strategies SET current_version_id = ${ids.version} WHERE id = ${ids.strategy}`;
      await raw`
          INSERT INTO setups (id, workspace_id, strategy_id, mutation_key)
          VALUES (${ids.setup}, ${ids.workspace}, ${ids.strategy}, gen_random_uuid())
        `;
      await raw`
          INSERT INTO strategy_setup_versions
            (id, workspace_id, strategy_id, strategy_version_id, setup_id, name)
          VALUES
            (${ids.setupVersion}, ${ids.workspace}, ${ids.strategy}, ${ids.version}, ${ids.setup}, 'Fixture setup')
        `;
      await raw`
          INSERT INTO trades
            (id, workspace_id, mutation_key, trading_account_id, strategy_id, strategy_version_id,
             setup_id, setup_version_id, symbol, direction, planned_entry, planned_stop,
             actual_entry, actual_initial_stop, actual_initial_risk_minor, entered_at, status)
          VALUES
            (${ids.openTrade}, ${ids.workspace}, gen_random_uuid(), ${ids.account}, ${ids.strategy},
             ${ids.version}, ${ids.setup}, ${ids.setupVersion}, 'OPEN', 'long', 100, 90,
             101, 91, 10000, '2026-08-01T09:00:00Z', 'open')
        `;
      await raw`
          INSERT INTO trades
            (id, workspace_id, mutation_key, trading_account_id, strategy_id, strategy_version_id,
             setup_id, setup_version_id, symbol, direction, planned_entry, planned_stop,
             actual_entry, actual_initial_stop, actual_exit, actual_initial_risk_minor,
             net_pnl_minor, entered_at, exited_at, actual_r, trader_outcome, status)
          VALUES
            (${ids.closedTrade}, ${ids.workspace}, gen_random_uuid(), ${ids.account}, ${ids.strategy},
             ${ids.version}, ${ids.setup}, ${ids.setupVersion}, 'CLOSED', 'long', 100, 90,
             101, 91, 123.4567890123, 10000, -1234,
             '2026-08-01T09:00:00Z', '2026-08-01T15:34:56.789Z', -0.1234, 'loss', 'closed')
        `;

      const [before] = await raw<
        {
          actual_exit: string;
          net_pnl_minor: string;
          actual_r: string;
          trader_outcome: string;
          exited_at: Date;
        }[]
      >`
          SELECT actual_exit::text, net_pnl_minor::text, actual_r::text,
                 trader_outcome, exited_at
          FROM trades WHERE id = ${ids.closedTrade}
        `;
      const source0013 = readFileSync(migrationPath, 'utf8');
      for (const statement of source0013.split('--> statement-breakpoint')) {
        if (statement.trim() !== '') await raw.unsafe(statement);
      }

      const modes = await raw<{ id: string; actual_result_mode: string }[]>`
          SELECT id::text, actual_result_mode FROM trades
          WHERE id IN (${ids.openTrade}, ${ids.closedTrade}) ORDER BY id
        `;
      expect(modes.map((row) => row.actual_result_mode)).toEqual(['money', 'money']);
      const exits = await raw<
        {
          trade_id: string;
          sequence: number;
          closed_bps: number;
          exit_price: string;
          realized_pnl_minor: string;
          exit_reason: string | null;
          exited_at: Date;
        }[]
      >`
          SELECT trade_id::text, sequence, closed_bps, exit_price::text,
                 realized_pnl_minor::text, exit_reason, exited_at
          FROM trade_exits ORDER BY trade_id, sequence
        `;
      expect(exits).toHaveLength(1);
      expect(exits[0]).toMatchObject({
        trade_id: ids.closedTrade,
        sequence: 1,
        closed_bps: 10_000,
        exit_price: before?.actual_exit,
        realized_pnl_minor: before?.net_pnl_minor,
        exit_reason: null,
        exited_at: before?.exited_at,
      });
      const [after] = await raw<
        {
          actual_exit: string;
          net_pnl_minor: string;
          actual_r: string;
          trader_outcome: string;
          exited_at: Date;
        }[]
      >`
          SELECT actual_exit::text, net_pnl_minor::text, actual_r::text,
                 trader_outcome, exited_at
          FROM trades WHERE id = ${ids.closedTrade}
        `;
      expect(after).toEqual(before);
      const [openExitCount] = await raw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM trade_exits WHERE trade_id = ${ids.openTrade}
        `;
      expect(openExitCount?.count).toBe(0);
    } finally {
      await rollbackIsolatedSchema();
    }
  }, 120_000);
});
