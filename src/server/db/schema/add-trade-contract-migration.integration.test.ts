/**
 * MIGRATION 0021 — what the database itself must refuse for Add Trade contract v1.
 *
 * The contract marks its rows with `recording_contract = 'add_trade_v1'`. Every
 * other row is legacy and must keep exactly the shape it could hold before
 * this migration: the contract columns are unreachable from a legacy row, and
 * a legacy open Money row still needs its own Actual Risk. These cases insert
 * directly, inside a throwaway schema in a transaction that is always rolled
 * back, with one savepoint per insert so each refusal is its own verdict.
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
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';

let counter = 0;

async function attempt(statement: string): Promise<{ ok: true } | { ok: false; message: string }> {
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

/** Inserts a Trade from a column → SQL-literal map layered over a minimal row. */
function insertTrade(columns: Record<string, string>) {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(1000 + counter).padStart(12, '0')}`;
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

const LEGACY_OPEN_MONEY = {
  status: `'open'`,
  actual_result_mode: `'money'`,
  entered_at: 'now()',
  planned_risk_minor: '10000',
  actual_initial_risk_minor: '10000',
};

function expectRefused(
  result: { ok: true } | { ok: false; message: string },
  constraint: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(constraint);
}

describe('migration 0021 — Add Trade contract At Entry schema', () => {
  beforeAll(async () => {
    await raw.unsafe('BEGIN');
    await raw.unsafe('DROP SCHEMA public CASCADE');
    await raw.unsafe('CREATE SCHEMA public');
    for (const name of migrationFiles) {
      if (Number(name.slice(0, 4)) > 21) continue;
      const source = readFileSync(join(drizzleDirectory, name), 'utf8');
      for (const statement of source.split('--> statement-breakpoint')) {
        if (statement.trim() !== '') await raw.unsafe(statement);
      }
    }
    await raw.unsafe(
      `INSERT INTO users (id, name, email, email_verified)
       VALUES ('user-contract-fixture', 'A', 'a@example.test', true)`,
    );
    await raw.unsafe(
      `INSERT INTO workspaces (id, name, slug, kind, personal_owner_user_id)
       VALUES ('${WORKSPACE_ID}', 'W', 'w', 'personal', 'user-contract-fixture')`,
    );
    await raw.unsafe(
      `INSERT INTO trading_accounts
         (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone)
       VALUES ('${ACCOUNT_ID}', '${WORKSPACE_ID}', 'Acct', 'live', 'USD', '10000', 'UTC')`,
    );
  });

  afterAll(async () => {
    await raw.unsafe('ROLLBACK');
    await raw.end();
  });

  it('is the latest migration and is named for the contract', () => {
    expect(migrationFiles.at(-1)).toBe('0021_add_trade_contract_at_entry.sql');
  });

  describe('legacy rows keep their pre-contract shape', () => {
    it('still accepts an ordinary legacy planned and open Money Trade', async () => {
      expect(await insertTrade({ planned_risk_minor: '10000' })).toEqual({ ok: true });
      expect(await insertTrade(LEGACY_OPEN_MONEY)).toEqual({ ok: true });
    });

    it('still requires Actual Risk and an entry time on a legacy open Money Trade', async () => {
      expectRefused(
        await insertTrade({ ...LEGACY_OPEN_MONEY, actual_initial_risk_minor: 'NULL' }),
        'trades_status_consistency_check',
      );
      expectRefused(
        await insertTrade({ ...LEGACY_OPEN_MONEY, entered_at: 'NULL' }),
        'trades_status_consistency_check',
      );
    });

    it('never lets a legacy row carry contract answers', async () => {
      expectRefused(
        await insertTrade({ target_state: `'no_fixed'` }),
        'trades_contract_target_check',
      );
      expectRefused(
        await insertTrade({ context_entry_price: `'2400'` }),
        'trades_context_price_check',
      );
      expectRefused(
        await insertTrade({ ...LEGACY_OPEN_MONEY, actual_risk_answer: `'matched'` }),
        'trades_actual_risk_answer_check',
      );
      expectRefused(
        await insertTrade({ exit_plan_state: `'no_rule'` }),
        'trades_exit_plan_contract_check',
      );
      expectRefused(
        await insertTrade({ exit_plan_inheritance_declined: 'true' }),
        'trades_exit_plan_contract_check',
      );
    });
  });

  describe('contract rows', () => {
    it('accepts the minimum At Entry Trade and an Actual Risk that differs or is unknown', async () => {
      expect(await insertTrade(CONTRACT_OPEN)).toEqual({ ok: true });
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          actual_initial_risk_minor: '25000',
          actual_risk_answer: `'different'`,
        }),
      ).toEqual({ ok: true });
      // "Different, amount unknown": the 1R baseline stays Risk at Entry.
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          actual_initial_risk_minor: 'NULL',
          actual_risk_answer: `'different'`,
        }),
      ).toEqual({ ok: true });
    });

    it('refuses a contract open Trade without Risk at Entry', async () => {
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          planned_risk_minor: 'NULL',
          actual_initial_risk_minor: 'NULL',
          actual_risk_answer: 'NULL',
        }),
        'trades_contract_open_risk_check',
      );
    });

    it('refuses a Matched Actual Risk that is not Risk at Entry', async () => {
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, actual_initial_risk_minor: '9999' }),
        'trades_actual_risk_answer_check',
      );
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, actual_risk_answer: `'unknown'` }),
        'trades_actual_risk_answer_check',
      );
    });

    it('keeps price as context: no Price plan and no Price-mode Actual', async () => {
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          planned_entry: `'2400'`,
          planned_stop: `'2390'`,
        }),
        'trades_contract_price_authority_check',
      );
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          context_entry_price: `'2400'`,
          context_stop_price: `'2410'`,
          context_position_size: `'0.5'`,
        }),
      ).toEqual({ ok: true });
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, context_stop_price: `'0'` }),
        'trades_context_price_check',
      );
    });

    it('holds Target Unanswered, Fixed and No Fixed apart', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          target_state: `'fixed'`,
          planned_reward_minor: '20000',
        }),
      ).toEqual({ ok: true });
      expect(
        await insertTrade({ ...CONTRACT_OPEN, target_state: `'fixed'`, target_price: `'2450'` }),
      ).toEqual({ ok: true });
      expect(await insertTrade({ ...CONTRACT_OPEN, target_state: `'no_fixed'` })).toEqual({
        ok: true,
      });
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, target_state: `'fixed'` }),
        'trades_contract_target_check',
      );
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, target_state: `'fixed'`, planned_reward_minor: '0' }),
        'trades_contract_target_check',
      );
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, target_state: `'no_fixed'`, target_price: `'2450'` }),
        'trades_contract_target_check',
      );
      // Unanswered carries no Target values either. A NULL `target_state` is
      // exactly the input that once made this CHECK evaluate to NULL, and a
      // NULL CHECK passes.
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, planned_reward_minor: '20000' }),
        'trades_contract_target_check',
      );
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, target_price: `'2450'` }),
        'trades_contract_target_check',
      );
    });

    it('refuses a Matched Actual Risk with no amount rather than letting NULL pass', async () => {
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, actual_initial_risk_minor: 'NULL' }),
        'trades_actual_risk_answer_check',
      );
    });

    it('snapshots an Exit Plan in exactly one coherent shape', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          exit_plan_state: `'saved'`,
          exit_plan_provenance: `'selected'`,
          exit_plan_name: `'Scale out'`,
          exit_plan_instructions: `'Half at 1R, trail the rest.'`,
        }),
      ).toEqual({ ok: true });
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          exit_plan_state: `'customized'`,
          exit_plan_provenance: `'selected'`,
          exit_plan_instructions: `'Close before the news.'`,
        }),
      ).toEqual({ ok: true });
      expect(await insertTrade({ ...CONTRACT_OPEN, exit_plan_state: `'no_rule'` })).toEqual({
        ok: true,
      });
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          exit_plan_state: `'saved'`,
          exit_plan_provenance: `'selected'`,
          exit_plan_name: `'Scale out'`,
          exit_plan_instructions: `'  '`,
        }),
        'trades_exit_plan_shape_check',
      );
      expectRefused(
        await insertTrade({
          ...CONTRACT_OPEN,
          exit_plan_state: `'no_rule'`,
          exit_plan_instructions: `'Anything'`,
        }),
        'trades_exit_plan_shape_check',
      );
    });

    it('refuses an explicit "No Strategy" alongside a Strategy and a bad capture origin', async () => {
      expect(await insertTrade({ ...CONTRACT_OPEN, no_strategy: 'true' })).toEqual({ ok: true });
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, no_setup: 'true' }),
        'trades_no_setup_check',
      );
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, confidence_origin: `'guessed'` }),
        'trades_capture_origin_check',
      );
    });

    it('records where an entry time came from only when one exists', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          entered_at: 'now()',
          entered_at_source: `'default_now'`,
        }),
      ).toEqual({ ok: true });
      expectRefused(
        await insertTrade({ ...CONTRACT_OPEN, entered_at_source: `'trader'` }),
        'trades_entered_at_source_check',
      );
    });

    it('lets a closed contract Trade measure Actual R without an Actual Risk amount', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_OPEN,
          status: `'closed'`,
          actual_initial_risk_minor: 'NULL',
          actual_risk_answer: `'different'`,
          entered_at: `'2026-09-01T10:00:00Z'`,
          exited_at: `'2026-09-01T12:00:00Z'`,
          actual_exit: `'2410'`,
          net_pnl_minor: '15000',
          actual_r: `'1.5000'`,
          trader_outcome: `'win'`,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('exit_plans', () => {
    it('stores a named plan and refuses blank wording', async () => {
      expect(
        await attempt(
          `INSERT INTO exit_plans (id, workspace_id, name, instructions, mutation_key)
           VALUES (gen_random_uuid(), '${WORKSPACE_ID}', 'Scale out', 'Half at 1R.', gen_random_uuid())`,
        ),
      ).toEqual({ ok: true });
      expectRefused(
        await attempt(
          `INSERT INTO exit_plans (id, workspace_id, name, instructions, mutation_key)
           VALUES (gen_random_uuid(), '${WORKSPACE_ID}', ' ', 'Half at 1R.', gen_random_uuid())`,
        ),
        'exit_plans_name_not_blank_check',
      );
    });
  });
});
