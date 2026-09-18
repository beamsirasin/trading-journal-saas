/**
 * MIGRATION 0023 — the database admits Save Closed Trade under the Add Trade
 * contract without changing what any existing row means.
 *
 * Legacy evidence is written under 0022 first, then 0023 is applied over it, so
 * "legacy rows keep their meaning" is observed rather than assumed. Every probe
 * runs inside a throwaway schema in a transaction that is always rolled back,
 * with one savepoint per statement so each refusal is its own verdict.
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

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000011';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000013';
const LEGACY_SIGN_ID = '00000000-0000-4000-8000-000000000101';
const LEGACY_R_ID = '00000000-0000-4000-8000-000000000102';

let counter = 0;
let emotionTypeId = '';
let otherEmotionTypeId = '';

type Attempt = { ok: true } | { ok: false; message: string };

async function applyMigrations(from: number, to: number): Promise<void> {
  for (const name of migrationFiles) {
    const index = Number(name.slice(0, 4));
    if (index < from || index > to) continue;
    const source = readFileSync(join(drizzleDirectory, name), 'utf8');
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim() !== '') await raw.unsafe(statement);
    }
  }
}

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
  return `00000000-0000-4000-8000-${String(2000 + counter).padStart(12, '0')}`;
}

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

/** A Save Closed Trade row with nothing but identity. */
const CONTRACT_CLOSED = {
  recording_contract: `'add_trade_v1'`,
  status: `'closed'`,
  actual_result_mode: `'money'`,
};

function expectRefused(result: Attempt, constraint: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(constraint);
}

describe('migration 0023 — Add Trade contract After Trade', () => {
  beforeAll(async () => {
    await raw.unsafe('BEGIN');
    await raw.unsafe('DROP SCHEMA public CASCADE');
    await raw.unsafe('CREATE SCHEMA public');
    await applyMigrations(0, 22);
    await raw.unsafe(
      `INSERT INTO users (id, name, email, email_verified)
       VALUES ('user-after-trade-fixture', 'A', 'a@example.test', true)`,
    );
    await raw.unsafe(
      `INSERT INTO workspaces (id, name, slug, kind, personal_owner_user_id)
       VALUES ('${WORKSPACE_ID}', 'W', 'w', 'personal', 'user-after-trade-fixture')`,
    );
    await raw.unsafe(
      `INSERT INTO trading_accounts
         (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone)
       VALUES ('${ACCOUNT_ID}', '${WORKSPACE_ID}', 'Acct', 'live', 'USD', '10000', 'UTC')`,
    );
    const emotions = await raw.unsafe<{ id: string }[]>(
      `SELECT id FROM emotion_types WHERE is_system ORDER BY sort_order LIMIT 2`,
    );
    emotionTypeId = emotions[0]!.id;
    otherEmotionTypeId = emotions[1]!.id;

    // Legacy evidence written under 0022, before this migration exists.
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, symbol, direction,
         status, actual_result_mode, net_pnl_minor, trader_outcome, exit_history_completeness,
         final_pnl_source)
       VALUES ('${LEGACY_SIGN_ID}', '${WORKSPACE_ID}', '${LEGACY_SIGN_ID}', '${ACCOUNT_ID}',
         'EURUSD', 'long', 'closed', 'money', -2500, 'loss', 'unknown', 'manual_total')`,
    );
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, symbol, direction,
         status, actual_result_mode, actual_initial_risk_minor, net_pnl_minor, actual_r,
         trader_outcome, entered_at, exited_at)
       VALUES ('${LEGACY_R_ID}', '${WORKSPACE_ID}', '${LEGACY_R_ID}', '${ACCOUNT_ID}',
         'GBPUSD', 'short', 'closed', 'money', 10000, 300, 0.0300, 'break_even',
         now() - interval '2 hours', now() - interval '1 hour')`,
    );
    await raw.unsafe(
      `INSERT INTO trade_emotions (trade_id, emotion_type_id, workspace_id)
       VALUES ('${LEGACY_SIGN_ID}', '${emotionTypeId}', '${WORKSPACE_ID}')`,
    );

    // The fixture's deferred constraint checks must run before an ALTER TABLE.
    await raw.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
    await applyMigrations(23, 23);
  }, 180_000);

  afterAll(async () => {
    await raw.unsafe('ROLLBACK');
    await raw.end();
  });

  it('is present and named for After Trade', () => {
    expect(migrationFiles).toContain('0023_after_trade_contract.sql');
  });

  describe('legacy rows keep their meaning', () => {
    it('keeps legacy outcomes as derived, and every existing emotion as an Entry Emotion', async () => {
      const trades = await raw.unsafe<
        { id: string; trader_outcome: string; trader_outcome_selected_at: Date | null }[]
      >(
        `SELECT id, trader_outcome, trader_outcome_selected_at FROM trades
         WHERE id IN ('${LEGACY_SIGN_ID}', '${LEGACY_R_ID}') ORDER BY id`,
      );
      expect(trades).toEqual([
        { id: LEGACY_SIGN_ID, trader_outcome: 'loss', trader_outcome_selected_at: null },
        { id: LEGACY_R_ID, trader_outcome: 'break_even', trader_outcome_selected_at: null },
      ]);
      const emotions = await raw.unsafe<{ phase: string }[]>(
        `SELECT phase FROM trade_emotions WHERE trade_id = '${LEGACY_SIGN_ID}'`,
      );
      expect(emotions).toEqual([{ phase: 'entry' }]);
    });

    it('still holds a legacy derived outcome to its sign', async () => {
      expectRefused(
        await insertTrade({
          status: `'closed'`,
          actual_result_mode: `'money'`,
          net_pnl_minor: '-100',
          trader_outcome: `'win'`,
        }),
        'trades_status_consistency_check',
      );
    });

    it('still refuses a legacy Money reward without a risk', async () => {
      expectRefused(
        await insertTrade({ planned_reward_minor: '10000' }),
        'trades_planned_money_check',
      );
    });

    it('never lets a legacy row claim a selected outcome or Post-Trade Emotion', async () => {
      expectRefused(
        await insertTrade({
          status: `'closed'`,
          actual_result_mode: `'money'`,
          net_pnl_minor: '-100',
          trader_outcome: `'loss'`,
          trader_outcome_selected_at: 'now()',
        }),
        'trades_trader_outcome_selection_check',
      );
      expectRefused(
        await insertTrade({ post_trade_emotions_recorded_at: 'now()' }),
        'trades_post_trade_emotions_check',
      );
    });
  });

  describe('Save Closed Trade on a contract row', () => {
    it('accepts a closed Trade with nothing but identity', async () => {
      expect(await insertTrade(CONTRACT_CLOSED)).toEqual({ ok: true });
    });

    it('accepts a selected outcome that contradicts the P&L sign, and BE beside a profit', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_CLOSED,
          net_pnl_minor: '-2500',
          trader_outcome: `'win'`,
          trader_outcome_selected_at: 'now()',
        }),
      ).toEqual({ ok: true });
      expect(
        await insertTrade({
          ...CONTRACT_CLOSED,
          planned_risk_minor: '5000',
          net_pnl_minor: '1000',
          actual_r: '0.2000',
          trader_outcome: `'break_even'`,
          trader_outcome_selected_at: 'now()',
        }),
      ).toEqual({ ok: true });
    });

    it('accepts a selected outcome with no Final Net P&L, and a P&L with no outcome', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_CLOSED,
          trader_outcome: `'loss'`,
          trader_outcome_selected_at: 'now()',
        }),
      ).toEqual({ ok: true });
      expect(
        await insertTrade({
          ...CONTRACT_CLOSED,
          planned_risk_minor: '5000',
          net_pnl_minor: '-5000',
          actual_r: '-1.0000',
        }),
      ).toEqual({ ok: true });
    });

    it('accepts a remembered Target Profit without a Risk at Entry', async () => {
      expect(
        await insertTrade({
          ...CONTRACT_CLOSED,
          target_state: `'fixed'`,
          planned_reward_minor: '10000',
        }),
      ).toEqual({ ok: true });
    });

    it('refuses an unselected outcome that its P&L does not derive', async () => {
      expectRefused(
        await insertTrade({ ...CONTRACT_CLOSED, net_pnl_minor: '-2500', trader_outcome: `'win'` }),
        'trades_status_consistency_check',
      );
    });

    it('refuses Actual R without both of its inputs', async () => {
      expectRefused(
        await insertTrade({ ...CONTRACT_CLOSED, net_pnl_minor: '1000', actual_r: '0.5000' }),
        'trades_status_consistency_check',
      );
      expectRefused(
        await insertTrade({ ...CONTRACT_CLOSED, planned_risk_minor: '5000', actual_r: '0.5000' }),
        'trades_status_consistency_check',
      );
    });

    it('refuses a selected marker without an outcome', async () => {
      expectRefused(
        await insertTrade({ ...CONTRACT_CLOSED, trader_outcome_selected_at: 'now()' }),
        'trades_trader_outcome_selection_check',
      );
    });

    it('accepts Unanswered and Don’t know Actual Risk without a Risk at Entry', async () => {
      expect(await insertTrade({ ...CONTRACT_CLOSED, actual_risk_answer: `'unknown'` })).toEqual({
        ok: true,
      });
      expect(
        await insertTrade({
          ...CONTRACT_CLOSED,
          actual_risk_answer: `'different'`,
          actual_initial_risk_minor: '7000',
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('exit history', () => {
    it('accepts a reason-only exit and an explicit unknown scope, and still refuses an empty exit', async () => {
      const tradeId = nextTradeId();
      expect(await insertTrade(CONTRACT_CLOSED, tradeId)).toEqual({ ok: true });
      const exit = (sequence: number, columns: string, values: string) =>
        attempt(
          `INSERT INTO trade_exits (id, mutation_key, workspace_id, trade_id, sequence${columns})
           VALUES (gen_random_uuid(), gen_random_uuid(), '${WORKSPACE_ID}', '${tradeId}',
             ${sequence}${values})`,
        );
      expect(await exit(1, ', exit_reason', `, 'Stopped at break-even'`)).toEqual({ ok: true });
      expect(await exit(2, ', exit_scope', `, 'unknown'`)).toEqual({ ok: true });
      expectRefused(await exit(3, '', ''), 'trade_exits_evidence_present_check');
      expectRefused(await exit(4, ', exit_scope', `, 'most'`), 'trade_exits_scope_check');
    });
  });

  describe('Post-Trade Emotion', () => {
    it('holds the same emotion in both phases, once per phase', async () => {
      const tradeId = nextTradeId();
      expect(
        await insertTrade(
          {
            ...CONTRACT_CLOSED,
            emotions_recorded_at: 'now()',
            post_trade_emotions_recorded_at: 'now()',
          },
          tradeId,
        ),
      ).toEqual({ ok: true });
      const emotion = (typeId: string, phase: string) =>
        attempt(
          `INSERT INTO trade_emotions (trade_id, emotion_type_id, workspace_id, phase)
           VALUES ('${tradeId}', '${typeId}', '${WORKSPACE_ID}', '${phase}')`,
        );
      expect(await emotion(emotionTypeId, 'entry')).toEqual({ ok: true });
      expect(await emotion(emotionTypeId, 'post_trade')).toEqual({ ok: true });
      expect(await emotion(otherEmotionTypeId, 'post_trade')).toEqual({ ok: true });
      expectRefused(
        await emotion(emotionTypeId, 'post_trade'),
        'trade_emotions_trade_id_emotion_type_id_phase_pk',
      );
      expectRefused(await emotion(otherEmotionTypeId, 'during'), 'trade_emotions_phase_check');
    });
  });
});
