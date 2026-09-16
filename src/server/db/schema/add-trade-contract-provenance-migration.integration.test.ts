/**
 * MIGRATION 0022 — the database closes what migration 0021 left to the service.
 *
 * Each case is a probe the At Entry production audit ran against 0021 and got
 * accepted: a legacy row wearing contract-era capture provenance, a contract
 * row parked in `planned`, a Different Actual Risk equal to Risk at Entry, an
 * inherited Exit Plan with no Strategy or a declined inheritance, and a Trade
 * pointing at another workspace's Exit Plan. Every insert runs inside a
 * throwaway schema in a transaction that is always rolled back, with one
 * savepoint per statement so each refusal is its own verdict.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '@/test/integration-db';

const drizzleDirectory = join(process.cwd(), 'drizzle');
const migrationFiles = readdirSync(drizzleDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const raw = postgres(resolveTestDatabaseUrl(), { max: 1, prepare: false });

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const STRATEGY_ID = '00000000-0000-4000-8000-000000000004';
const STRATEGY_VERSION_ID = '00000000-0000-4000-8000-000000000005';
const PLAN_ID = '00000000-0000-4000-8000-000000000006';
const FOREIGN_PLAN_ID = '00000000-0000-4000-8000-000000000007';

let counter = 0;

type Attempt = { ok: true } | { ok: false; message: string };

async function attempt(statement: string): Promise<Attempt> {
  counter += 1;
  const savepoint = `sp_${counter}`;
  await raw.unsafe(`SAVEPOINT ${savepoint}`);
  try {
    await raw.unsafe(statement);
    await raw.unsafe(`RELEASE SAVEPOINT ${savepoint}`);
    return { ok: true };
  } catch (error) {
    await raw.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function nextTradeId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(1000 + counter).padStart(12, '0')}`;
}

/** Inserts a Trade from a column → SQL-literal map layered over a minimal row. */
function insertTrade(columns: Record<string, string>, id = nextTradeId()): Promise<Attempt> {
  const row: Record<string, string> = {
    id: `'${id}'`,
    workspace_id: `'${WORKSPACE_ID}'`,
    mutation_key: `'${id}'`,
    trading_account_id: `'${ACCOUNT_ID}'`,
    symbol: `'XAUUSD'`,
    direction: `'long'`,
    status: `'planned'`,
    ...columns,
  };
  return attempt(
    `INSERT INTO trades (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`,
  );
}

const CONTRACT_OPEN = {
  recording_contract: `'add_trade_v1'`,
  status: `'open'`,
  actual_result_mode: `'money'`,
  planned_risk_minor: '10000',
  actual_initial_risk_minor: '10000',
  actual_risk_answer: `'matched'`,
};

const WITH_STRATEGY = {
  strategy_id: `'${STRATEGY_ID}'`,
  strategy_version_id: `'${STRATEGY_VERSION_ID}'`,
};

const SAVED_PLAN_SNAPSHOT = {
  exit_plan_state: `'saved'`,
  exit_plan_name: `'Scale out'`,
  exit_plan_instructions: `'Half at 1R, trail the rest.'`,
};

function expectRefused(result: Attempt, constraint: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(constraint);
}

describe('migration 0022 — Add Trade contract provenance hardening', () => {
  beforeAll(async () => {
    await raw.unsafe('BEGIN');
    await raw.unsafe('DROP SCHEMA public CASCADE');
    await raw.unsafe('CREATE SCHEMA public');
    for (const name of migrationFiles) {
      if (Number(name.slice(0, 4)) > 22) continue;
      const source = readFileSync(join(drizzleDirectory, name), 'utf8');
      for (const statement of source.split('--> statement-breakpoint')) {
        if (statement.trim() !== '') await raw.unsafe(statement);
      }
    }
    await raw.unsafe(
      `INSERT INTO users (id, name, email, email_verified)
       VALUES ('user-provenance-fixture', 'A', 'a@example.test', true),
              ('user-provenance-other', 'B', 'b@example.test', true)`,
    );
    await raw.unsafe(
      `INSERT INTO workspaces (id, name, slug, kind, personal_owner_user_id)
       VALUES ('${WORKSPACE_ID}', 'W', 'w', 'personal', 'user-provenance-fixture'),
              ('${OTHER_WORKSPACE_ID}', 'X', 'x', 'personal', 'user-provenance-other')`,
    );
    await raw.unsafe(
      `INSERT INTO trading_accounts
         (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone)
       VALUES ('${ACCOUNT_ID}', '${WORKSPACE_ID}', 'Acct', 'live', 'USD', '10000', 'UTC')`,
    );
    await raw.unsafe(
      `INSERT INTO strategies (id, workspace_id, mutation_key)
       VALUES ('${STRATEGY_ID}', '${WORKSPACE_ID}', gen_random_uuid())`,
    );
    await raw.unsafe(
      `INSERT INTO strategy_versions (id, workspace_id, strategy_id, version_number, name)
       VALUES ('${STRATEGY_VERSION_ID}', '${WORKSPACE_ID}', '${STRATEGY_ID}', 1, 'Breakout')`,
    );
    await raw.unsafe(
      `INSERT INTO exit_plans (id, workspace_id, name, instructions, mutation_key)
       VALUES ('${PLAN_ID}', '${WORKSPACE_ID}', 'Scale out', 'Half at 1R.', gen_random_uuid()),
              ('${FOREIGN_PLAN_ID}', '${OTHER_WORKSPACE_ID}', 'Theirs', 'Not yours.', gen_random_uuid())`,
    );
  }, 120_000);

  afterAll(async () => {
    await raw.unsafe('ROLLBACK');
    await raw.end();
  });

  it('is the latest migration and is named for the hardening', () => {
    expect(migrationFiles.at(-1)).toBe('0022_add_trade_contract_provenance_hardening.sql');
  });

  describe('capture provenance belongs to contract rows only', () => {
    it('still accepts a legacy row without provenance and a contract row with it', async () => {
      expect(await insertTrade({ planned_risk_minor: '10000' })).toEqual({ ok: true });
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          confidence: '75',
          confidence_origin: `'recorded_at_entry'`,
          confidence_revised_at: 'now()',
        }),
      ).toEqual({ ok: true });
    });

    it.each([
      ['strategy_origin', `'recalled_after_trade'`],
      ['setup_origin', `'recalled_after_trade'`],
      ['exit_plan_origin', `'recorded_at_entry'`],
      ['confidence_origin', `'recorded_during_trade'`],
      ['emotions_origin', `'recorded_during_trade'`],
      ['classification_revised_at', 'now()'],
      ['exit_plan_revised_at', 'now()'],
      ['confidence_revised_at', 'now()'],
      ['emotions_revised_at', 'now()'],
    ])('refuses a legacy row carrying %s', async (column, value) => {
      expectRefused(
        await insertTrade({ planned_risk_minor: '10000', [column]: value }),
        'trades_capture_origin_check',
      );
    });

    it('refuses an entry-time source on a legacy row', async () => {
      expectRefused(
        await insertTrade({
          planned_risk_minor: '10000',
          entered_at: 'now()',
          entered_at_source: `'trader'`,
        }),
        'trades_entered_at_source_check',
      );
    });
  });

  it('refuses a contract row in the planned state', async () => {
    expectRefused(
      await insertTrade({ ...CONTRACT_OPEN, status: `'planned'` }),
      'trades_contract_open_risk_check',
    );
  });

  describe('a Different Actual Risk never equals Risk at Entry', () => {
    it('accepts a different amount and an unknown amount', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          actual_initial_risk_minor: '25000',
          actual_risk_answer: `'different'`,
        }),
      ).toEqual({ ok: true });
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          actual_initial_risk_minor: 'NULL',
          actual_risk_answer: `'different'`,
        }),
      ).toEqual({ ok: true });
    });

    it('refuses Different with Risk at Entry’s own amount', async () => {
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, actual_risk_answer: `'different'` }),
        'trades_actual_risk_answer_check',
      );
    });
  });

  describe('an inherited Exit Plan needs its Strategy and an undeclined inheritance', () => {
    it('accepts an inherited plan under a Strategy', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          ...WITH_STRATEGY,
          ...SAVED_PLAN_SNAPSHOT,
          exit_plan_provenance: `'strategy_default'`,
          exit_plan_id: `'${PLAN_ID}'`,
        }),
      ).toEqual({ ok: true });
    });

    it('refuses an inherited plan with no Strategy', async () => {
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          ...SAVED_PLAN_SNAPSHOT,
          exit_plan_provenance: `'strategy_default'`,
        }),
        'trades_exit_plan_shape_check',
      );
    });

    it('refuses an inherited plan whose inheritance was declined', async () => {
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          ...WITH_STRATEGY,
          ...SAVED_PLAN_SNAPSHOT,
          exit_plan_provenance: `'strategy_default'`,
          exit_plan_inheritance_declined: 'true',
        }),
        'trades_exit_plan_shape_check',
      );
      // A plan the trader selected after declining the default is fine.
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          ...WITH_STRATEGY,
          ...SAVED_PLAN_SNAPSHOT,
          exit_plan_provenance: `'selected'`,
          exit_plan_inheritance_declined: 'true',
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('an Exit Plan reference stays inside its workspace', () => {
    it('refuses a Trade pointing at another workspace’s Exit Plan', async () => {
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          ...SAVED_PLAN_SNAPSHOT,
          exit_plan_provenance: `'selected'`,
          exit_plan_id: `'${FOREIGN_PLAN_ID}'`,
        }),
        'trades_exit_plan_workspace_fk',
      );
    });

    it('clears only the pointer when the plan is deleted, keeping the snapshot and workspace', async () => {
      const tradeId = nextTradeId();
      const planId = '00000000-0000-4000-8000-000000000008';
      expect(
        await attempt(
          `INSERT INTO exit_plans (id, workspace_id, name, instructions, mutation_key)
           VALUES ('${planId}', '${WORKSPACE_ID}', 'Doomed', 'Gone soon.', gen_random_uuid())`,
        ),
      ).toEqual({ ok: true });
      expect(
        await insertTrade(
          {
            ...CONTRACT_OPEN,
            ...SAVED_PLAN_SNAPSHOT,
            exit_plan_provenance: `'selected'`,
            exit_plan_id: `'${planId}'`,
          },
          tradeId,
        ),
      ).toEqual({ ok: true });
      expect(await attempt(`DELETE FROM exit_plans WHERE id = '${planId}'`)).toEqual({ ok: true });
      const [row] = await raw.unsafe<
        { workspace_id: string; exit_plan_id: string | null; exit_plan_name: string }[]
      >(`SELECT workspace_id, exit_plan_id, exit_plan_name FROM trades WHERE id = '${tradeId}'`);
      expect(row).toEqual({
        workspace_id: WORKSPACE_ID,
        exit_plan_id: null,
        exit_plan_name: 'Scale out',
      });
    });
  });
});
