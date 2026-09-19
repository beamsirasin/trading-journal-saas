/**
 * MIGRATION 0025 — the canonical Review and System Assessment model is added
 * without changing what any existing row means.
 *
 * Legacy and pre-0025 contract evidence is written under 0024 first, then 0025
 * is applied over it, so "nothing is reinterpreted" is observed rather than
 * assumed. Every probe runs inside a throwaway schema in a transaction that is
 * always rolled back, with one savepoint per statement so each refusal is its
 * own verdict.
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

const USER_ID = 'user-review-r1-fixture';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000021';
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000022';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000023';
const OTHER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000024';
const STRATEGY_ID = '00000000-0000-4000-8000-000000000031';
const VERSION_ID = '00000000-0000-4000-8000-000000000032';
const RULE_A_ID = '00000000-0000-4000-8000-000000000033';
const RULE_B_ID = '00000000-0000-4000-8000-000000000034';
const RULE_A_KEY = '00000000-0000-4000-8000-000000000035';
const RULE_B_KEY = '00000000-0000-4000-8000-000000000036';
/** Legacy: review notes, a resolved legacy System result, `partly` adherence, rule checks, a mistake. */
const LEGACY_ID = '00000000-0000-4000-8000-000000000101';
/** Contract row resolved through the pre-contract System flow, with a default `not_checked`. */
const CONTRACT_EARLIER_MODEL_ID = '00000000-0000-4000-8000-000000000102';
/** Contract row with no mistake links. */
const CONTRACT_EMPTY_ID = '00000000-0000-4000-8000-000000000103';
const OTHER_WORKSPACE_TRADE_ID = '00000000-0000-4000-8000-000000000104';

let counter = 0;
let mistakeTypeId = '';

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

function expectRefused(result: Attempt, constraint: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(constraint);
}

function nextTradeId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(5000 + counter).padStart(12, '0')}`;
}

async function insertTrade(columns: Record<string, string>): Promise<string> {
  const id = nextTradeId();
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
  const result = await attempt(
    `INSERT INTO trades (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`,
  );
  if (!result.ok) throw new Error(result.message);
  return id;
}

/** A closed Add Trade v1 row with a Risk at Entry. */
const CONTRACT_CLOSED = {
  recording_contract: `'add_trade_v1'`,
  status: `'closed'`,
  actual_result_mode: `'money'`,
  planned_risk_minor: '5000',
};

/** A Finish Review, as the only writer of `reviewed` will perform it. */
const FINISH = `review_status = 'reviewed', review_first_finished_at = now(),
  review_last_finished_at = now(), review_finish_count = 1`;

const SNAPSHOT_V2 = JSON.stringify({
  kind: 'system_assessment_dependencies',
  version: 2,
  strategy: { strategyId: null, strategyVersionId: null, noStrategy: false },
  setup: { setupId: null, setupVersionId: null, noSetup: false },
  exitPlan: { state: null, exitPlanId: null, contentSha256: null },
  direction: 'long',
  captureOrigins: { strategy: null, setup: null, exitPlan: null },
});

function insertAssessment(tradeId: string, columns: Record<string, string>): Promise<Attempt> {
  const row: Record<string, string> = {
    trade_id: `'${tradeId}'`,
    workspace_id: `'${WORKSPACE_ID}'`,
    dependency_snapshot: `'${SNAPSHOT_V2}'::jsonb`,
    confirmed_at: 'now()',
    dependencies_confirmed_at: 'now()',
    ...columns,
  };
  return attempt(
    `INSERT INTO trade_system_assessments (${Object.keys(row).join(', ')})
     VALUES (${Object.values(row).join(', ')})`,
  );
}

const ASSESSED_MONEY_NET = {
  finding: `'assessed'`,
  exit_mechanism: `'fixed_target'`,
  result_basis: `'money'`,
  system_result_minor: '10000',
  result_comparability: `'net'`,
};

describe('migration 0025 — canonical Review and System Assessment', () => {
  beforeAll(async () => {
    await raw.unsafe('BEGIN');
    await raw.unsafe('DROP SCHEMA public CASCADE');
    await raw.unsafe('CREATE SCHEMA public');
    await applyMigrations(0, 24);
    await raw.unsafe(
      `INSERT INTO users (id, name, email, email_verified)
       VALUES ('${USER_ID}', 'A', 'r1@example.test', true),
         ('${USER_ID}-other', 'B', 'r1-other@example.test', true)`,
    );
    await raw.unsafe(
      `INSERT INTO workspaces (id, name, slug, kind, personal_owner_user_id) VALUES
         ('${WORKSPACE_ID}', 'W', 'w', 'personal', '${USER_ID}'),
         ('${OTHER_WORKSPACE_ID}', 'X', 'x', 'personal', '${USER_ID}-other')`,
    );
    await raw.unsafe(
      `INSERT INTO trading_accounts
         (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone) VALUES
         ('${ACCOUNT_ID}', '${WORKSPACE_ID}', 'Acct', 'live', 'USD', '10000', 'UTC'),
         ('${OTHER_ACCOUNT_ID}', '${OTHER_WORKSPACE_ID}', 'Other', 'live', 'USD', '10000', 'UTC')`,
    );
    await raw.unsafe(
      `INSERT INTO strategies (id, workspace_id, mutation_key)
       VALUES ('${STRATEGY_ID}', '${WORKSPACE_ID}', '${STRATEGY_ID}')`,
    );
    await raw.unsafe(
      `INSERT INTO strategy_versions (id, workspace_id, strategy_id, version_number, name)
       VALUES ('${VERSION_ID}', '${WORKSPACE_ID}', '${STRATEGY_ID}', 1, 'Breakout')`,
    );
    await raw.unsafe(
      `INSERT INTO strategy_rules (id, workspace_id, strategy_version_id, rule_key, category, title)
       VALUES
         ('${RULE_A_ID}', '${WORKSPACE_ID}', '${VERSION_ID}', '${RULE_A_KEY}', 'entry', 'Wait for close'),
         ('${RULE_B_ID}', '${WORKSPACE_ID}', '${VERSION_ID}', '${RULE_B_KEY}', 'exit', 'Trail stop')`,
    );
    mistakeTypeId = (
      await raw.unsafe<{ id: string }[]>(
        `SELECT id FROM mistake_types WHERE is_system ORDER BY sort_order LIMIT 1`,
      )
    )[0]!.id;

    // Evidence written under 0024, before this migration exists.
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, strategy_id,
         strategy_version_id, symbol, direction, status, actual_result_mode,
         actual_initial_risk_minor, net_pnl_minor, actual_r, trader_outcome, review_notes,
         plan_adherence, system_status, system_resolution_kind, system_gross_r_input,
         system_gross_r, system_cost_r, system_r, system_outcome, system_exit_reason,
         system_resolved_at)
       VALUES ('${LEGACY_ID}', '${WORKSPACE_ID}', '${LEGACY_ID}', '${ACCOUNT_ID}', '${STRATEGY_ID}',
         '${VERSION_ID}', 'EURUSD', 'long', 'closed', 'money', 10000, 20000, 2.0000, 'win',
         'Held too long', 'partly', 'resolved', 'money_target', 2.0000, 2.0000, 0, 2.0000, 'win',
         'target_hit', now())`,
    );
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, strategy_id,
         strategy_version_id, strategy_origin, symbol, direction, status, actual_result_mode,
         planned_risk_minor, recording_contract, system_status, system_resolution_kind,
         system_gross_r_input, system_gross_r, system_exit_reason, system_resolved_at,
         review_notes)
       VALUES ('${CONTRACT_EARLIER_MODEL_ID}', '${WORKSPACE_ID}', '${CONTRACT_EARLIER_MODEL_ID}',
         '${ACCOUNT_ID}', '${STRATEGY_ID}', '${VERSION_ID}', 'recalled_after_trade', 'GBPUSD',
         'short', 'closed', 'money', 5000, 'add_trade_v1', 'resolved', 'money_custom', 1.5000,
         1.5000, 'manual_system_valid_exit', now(), 'Earlier notes')`,
    );
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, symbol, direction,
         status, actual_result_mode, planned_risk_minor, recording_contract)
       VALUES ('${CONTRACT_EMPTY_ID}', '${WORKSPACE_ID}', '${CONTRACT_EMPTY_ID}', '${ACCOUNT_ID}',
         'USDJPY', 'long', 'closed', 'money', 5000, 'add_trade_v1')`,
    );
    await raw.unsafe(
      `INSERT INTO trades (id, workspace_id, mutation_key, trading_account_id, symbol, direction,
         status, actual_result_mode, planned_risk_minor, recording_contract)
       VALUES ('${OTHER_WORKSPACE_TRADE_ID}', '${OTHER_WORKSPACE_ID}', '${OTHER_WORKSPACE_TRADE_ID}',
         '${OTHER_ACCOUNT_ID}', 'USDJPY', 'long', 'closed', 'money', 5000, 'add_trade_v1')`,
    );
    await raw.unsafe(
      `INSERT INTO trade_rule_checks (id, workspace_id, trade_id, strategy_rule_id, strategy_version_id,
         rule_key, check_status, title, category, is_required, is_pre_trade_check)
       VALUES
         (gen_random_uuid(), '${WORKSPACE_ID}', '${LEGACY_ID}', '${RULE_A_ID}', '${VERSION_ID}', '${RULE_A_KEY}',
           'not_checked', 'Wait for close', 'entry', true, false),
         (gen_random_uuid(), '${WORKSPACE_ID}', '${LEGACY_ID}', '${RULE_B_ID}', '${VERSION_ID}', '${RULE_B_KEY}',
           'violated', 'Trail stop', 'exit', true, false),
         (gen_random_uuid(), '${WORKSPACE_ID}', '${CONTRACT_EARLIER_MODEL_ID}', '${RULE_A_ID}', '${VERSION_ID}',
           '${RULE_A_KEY}', 'not_checked', 'Wait for close', 'entry', true, false),
         (gen_random_uuid(), '${WORKSPACE_ID}', '${CONTRACT_EARLIER_MODEL_ID}', '${RULE_B_ID}', '${VERSION_ID}',
           '${RULE_B_KEY}', 'followed', 'Trail stop', 'exit', true, false)`,
    );
    await raw.unsafe(
      `INSERT INTO trade_mistakes (trade_id, mistake_type_id, workspace_id, severity_at_time,
         weight_at_time)
       VALUES ('${LEGACY_ID}', '${mistakeTypeId}', '${WORKSPACE_ID}', 'moderate', 1.0000),
         ('${CONTRACT_EARLIER_MODEL_ID}', '${mistakeTypeId}', '${WORKSPACE_ID}', 'moderate', 1.0000)`,
    );

    // The fixture's deferred constraint checks must run before an ALTER TABLE.
    await raw.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
    await applyMigrations(25, 25);
  }, 180_000);

  afterAll(async () => {
    await raw.unsafe('ROLLBACK');
    await raw.end();
  });

  it('is present and named for the canonical Review and System Assessment model', () => {
    expect(migrationFiles).toContain('0025_review_system_assessment_canonical.sql');
  });

  describe('existing rows are not reinterpreted', () => {
    it('starts every Trade Not Reviewed, with nothing answered, whatever its legacy notes', async () => {
      const rows = await raw.unsafe(
        `SELECT id, review_notes, review_status, review_first_finished_at, review_last_finished_at,
           review_finish_count, review_reflection_repeat, review_reflection_change,
           no_mistake_identified_at, exit_plan_adherence, exit_plan_adherence_revision,
           plan_adherence
         FROM trades WHERE workspace_id = '${WORKSPACE_ID}' ORDER BY id`,
      );
      expect(rows).toEqual([
        {
          id: LEGACY_ID,
          review_notes: 'Held too long',
          review_status: 'not_reviewed',
          review_first_finished_at: null,
          review_last_finished_at: null,
          review_finish_count: 0,
          review_reflection_repeat: null,
          review_reflection_change: null,
          no_mistake_identified_at: null,
          exit_plan_adherence: null,
          exit_plan_adherence_revision: 0,
          plan_adherence: 'partly',
        },
        {
          id: CONTRACT_EARLIER_MODEL_ID,
          review_notes: 'Earlier notes',
          review_status: 'not_reviewed',
          review_first_finished_at: null,
          review_last_finished_at: null,
          review_finish_count: 0,
          review_reflection_repeat: null,
          review_reflection_change: null,
          no_mistake_identified_at: null,
          exit_plan_adherence: null,
          exit_plan_adherence_revision: 0,
          plan_adherence: null,
        },
        {
          id: CONTRACT_EMPTY_ID,
          review_notes: null,
          review_status: 'not_reviewed',
          review_first_finished_at: null,
          review_last_finished_at: null,
          review_finish_count: 0,
          review_reflection_repeat: null,
          review_reflection_change: null,
          no_mistake_identified_at: null,
          exit_plan_adherence: null,
          exit_plan_adherence_revision: 0,
          plan_adherence: null,
        },
      ]);
    });

    it('keeps legacy System evidence readable and creates no canonical assessment for it', async () => {
      const legacy = await raw.unsafe(
        `SELECT id, system_status, system_resolution_kind, system_gross_r::text, system_r::text,
           system_outcome
         FROM trades WHERE id IN ('${LEGACY_ID}', '${CONTRACT_EARLIER_MODEL_ID}') ORDER BY id`,
      );
      expect(legacy).toEqual([
        {
          id: LEGACY_ID,
          system_status: 'resolved',
          system_resolution_kind: 'money_target',
          system_gross_r: '2.0000',
          system_r: '2.0000',
          system_outcome: 'win',
        },
        {
          id: CONTRACT_EARLIER_MODEL_ID,
          system_status: 'resolved',
          system_resolution_kind: 'money_custom',
          system_gross_r: '1.5000',
          system_r: null,
          system_outcome: null,
        },
      ]);
      const canonical = await raw.unsafe(`SELECT count(*)::int AS n FROM trade_system_assessments`);
      expect(canonical).toEqual([{ n: 0 }]);
    });

    it('keeps every rule check in the historical model with its stored status', async () => {
      const rows = await raw.unsafe(
        `SELECT trade_id, rule_key, check_status, answer_model FROM trade_rule_checks
         ORDER BY trade_id, rule_key`,
      );
      expect(rows).toEqual([
        {
          trade_id: LEGACY_ID,
          rule_key: RULE_A_KEY,
          check_status: 'not_checked',
          answer_model: null,
        },
        { trade_id: LEGACY_ID, rule_key: RULE_B_KEY, check_status: 'violated', answer_model: null },
        {
          trade_id: CONTRACT_EARLIER_MODEL_ID,
          rule_key: RULE_A_KEY,
          check_status: 'not_checked',
          answer_model: null,
        },
        {
          trade_id: CONTRACT_EARLIER_MODEL_ID,
          rule_key: RULE_B_KEY,
          check_status: 'followed',
          answer_model: null,
        },
      ]);
    });

    it('keeps mistake links as the selected mistakes, and an empty selection unanswered', async () => {
      const rows = await raw.unsafe(
        `SELECT t.id, t.no_mistake_identified_at, count(m.mistake_type_id)::int AS selected
         FROM trades t LEFT JOIN trade_mistakes m ON m.trade_id = t.id
         WHERE t.workspace_id = '${WORKSPACE_ID}' GROUP BY t.id ORDER BY t.id`,
      );
      expect(rows).toEqual([
        { id: LEGACY_ID, no_mistake_identified_at: null, selected: 1 },
        { id: CONTRACT_EARLIER_MODEL_ID, no_mistake_identified_at: null, selected: 1 },
        { id: CONTRACT_EMPTY_ID, no_mistake_identified_at: null, selected: 0 },
      ]);
    });
  });

  describe('Review lifecycle', () => {
    it('represents a first Finish and a repeated Finish', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      expect(
        await attempt(
          `UPDATE trades SET review_status = 'reviewed',
             review_first_finished_at = now() - interval '1 day',
             review_last_finished_at = now() - interval '1 day', review_finish_count = 1,
             review_reflection_repeat = 'Waited for the close'
           WHERE id = '${id}'`,
        ),
      ).toEqual({ ok: true });
      expect(
        await attempt(
          `UPDATE trades SET review_last_finished_at = now(), review_finish_count = 2,
             review_reflection_repeat = NULL, review_reflection_change = 'Size down'
           WHERE id = '${id}'`,
        ),
      ).toEqual({ ok: true });
      const [row] = await raw.unsafe<
        { review_finish_count: number; later: boolean; review_reflection_change: string }[]
      >(
        `SELECT review_finish_count, review_last_finished_at > review_first_finished_at AS later,
           review_reflection_change FROM trades WHERE id = '${id}'`,
      );
      expect(row).toEqual({
        review_finish_count: 2,
        later: true,
        review_reflection_change: 'Size down',
      });
    });

    it('accepts a Finish with both reflection prompts blank', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      expect(await attempt(`UPDATE trades SET ${FINISH} WHERE id = '${id}'`)).toEqual({ ok: true });
    });

    it('never returns a Reviewed Trade to Not Reviewed, or rewrites its first Finish', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      await attempt(`UPDATE trades SET ${FINISH} WHERE id = '${id}'`);
      expectRefused(
        await attempt(
          `UPDATE trades SET review_status = 'not_reviewed', review_first_finished_at = NULL,
             review_last_finished_at = NULL, review_finish_count = 0 WHERE id = '${id}'`,
        ),
        'reviewed trade never returns to not_reviewed',
      );
      expectRefused(
        await attempt(
          `UPDATE trades SET review_first_finished_at = review_first_finished_at - interval '1 hour'
           WHERE id = '${id}'`,
        ),
        'review_first_finished_at never changes',
      );
      await attempt(`UPDATE trades SET review_finish_count = 3 WHERE id = '${id}'`);
      expectRefused(
        await attempt(`UPDATE trades SET review_finish_count = 2 WHERE id = '${id}'`),
        'review_finish_count never decreases',
      );
    });

    it('refuses Reviewed without completion metadata, and Review content while Not Reviewed', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      expectRefused(
        await attempt(`UPDATE trades SET review_status = 'reviewed' WHERE id = '${id}'`),
        'trades_review_lifecycle_check',
      );
      expectRefused(
        await attempt(`UPDATE trades SET review_reflection_repeat = 'x' WHERE id = '${id}'`),
        'trades_review_lifecycle_check',
      );
      expectRefused(
        await attempt(`UPDATE trades SET review_status = 'needs_review' WHERE id = '${id}'`),
        // Refused by the status check and the lifecycle check alike; either may report.
        'violates check constraint "trades_review_',
      );
      expectRefused(
        await attempt(
          `UPDATE trades SET ${FINISH}, review_reflection_change = '  ' WHERE id = '${id}'`,
        ),
        'trades_review_reflection_check',
      );
    });

    it('does not let legacy review notes create a Reviewed state', async () => {
      const id = await insertTrade({ review_notes: `'Notes'` });
      const [row] = await raw.unsafe<{ review_status: string }[]>(
        `SELECT review_status FROM trades WHERE id = '${id}'`,
      );
      expect(row).toEqual({ review_status: 'not_reviewed' });
    });
  });

  describe('mistakes answer', () => {
    it('distinguishes Unanswered, No mistake identified and selected mistakes', async () => {
      const none = await insertTrade(CONTRACT_CLOSED);
      expect(
        await attempt(
          `UPDATE trades SET ${FINISH}, no_mistake_identified_at = now() WHERE id = '${none}'`,
        ),
      ).toEqual({ ok: true });
      const rows = await raw.unsafe(
        `SELECT t.id, t.no_mistake_identified_at IS NOT NULL AS none_answered,
           count(m.mistake_type_id)::int AS selected
         FROM trades t LEFT JOIN trade_mistakes m ON m.trade_id = t.id
         WHERE t.id IN ('${none}', '${CONTRACT_EMPTY_ID}', '${CONTRACT_EARLIER_MODEL_ID}')
         GROUP BY t.id ORDER BY t.id`,
      );
      expect(rows).toEqual([
        { id: CONTRACT_EARLIER_MODEL_ID, none_answered: false, selected: 1 },
        { id: CONTRACT_EMPTY_ID, none_answered: false, selected: 0 },
        { id: none, none_answered: true, selected: 0 },
      ]);
    });

    it('never lets No mistake identified coexist with a selected mistake', async () => {
      const none = await insertTrade(CONTRACT_CLOSED);
      await attempt(
        `UPDATE trades SET ${FINISH}, no_mistake_identified_at = now() WHERE id = '${none}'`,
      );
      expectRefused(
        await attempt(
          `INSERT INTO trade_mistakes (trade_id, mistake_type_id, workspace_id, severity_at_time,
             weight_at_time)
           VALUES ('${none}', '${mistakeTypeId}', '${WORKSPACE_ID}', 'moderate', 1.0000)`,
        ),
        'cannot have a selected mistake',
      );
      expectRefused(
        await attempt(
          `UPDATE trades SET ${FINISH}, no_mistake_identified_at = now()
           WHERE id = '${CONTRACT_EARLIER_MODEL_ID}'`,
        ),
        'cannot be answered "no mistake identified"',
      );
    });

    it('stores No mistake identified only as part of a finished Review', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      expectRefused(
        await attempt(`UPDATE trades SET no_mistake_identified_at = now() WHERE id = '${id}'`),
        'trades_review_lifecycle_check',
      );
    });
  });

  describe('rule-check answers', () => {
    it('represents all six canonical answers, including an explicit Not Checked', async () => {
      const statuses = [
        'unanswered',
        'followed',
        'violated',
        'not_applicable',
        'not_checked',
        'unknown',
      ];
      for (const status of statuses) {
        expect(
          await attempt(
            `UPDATE trade_rule_checks SET check_status = '${status}', answer_model = 'review_v1'
             WHERE trade_id = '${CONTRACT_EARLIER_MODEL_ID}' AND rule_key = '${RULE_B_KEY}'`,
          ),
        ).toEqual({ ok: true });
      }
    });

    it('keeps a historical not_checked distinguishable from a canonical explicit Not Checked', async () => {
      const rows = await raw.unsafe(
        `SELECT rule_key, check_status, answer_model FROM trade_rule_checks
         WHERE trade_id = '${CONTRACT_EARLIER_MODEL_ID}' ORDER BY rule_key`,
      );
      // The historical default (read as Unanswered on a contract row, decision
      // 42) and the canonical explicit answer differ in `answer_model`.
      expect(rows).toEqual([
        { rule_key: RULE_A_KEY, check_status: 'not_checked', answer_model: null },
        { rule_key: RULE_B_KEY, check_status: 'unknown', answer_model: 'review_v1' },
      ]);
    });

    it('refuses canonical-only answers in the historical model, and unknown models', async () => {
      for (const status of ['unanswered', 'unknown']) {
        expectRefused(
          await attempt(
            `UPDATE trade_rule_checks SET check_status = '${status}'
             WHERE trade_id = '${LEGACY_ID}' AND rule_key = '${RULE_A_KEY}'`,
          ),
          'trade_rule_checks_answer_model_check',
        );
      }
      expectRefused(
        await attempt(
          `UPDATE trade_rule_checks SET answer_model = 'review_v2'
           WHERE trade_id = '${LEGACY_ID}' AND rule_key = '${RULE_A_KEY}'`,
        ),
        'trade_rule_checks_answer_model_check',
      );
      expectRefused(
        await attempt(
          `UPDATE trade_rule_checks SET check_status = 'skipped', answer_model = 'review_v1'
           WHERE trade_id = '${LEGACY_ID}' AND rule_key = '${RULE_A_KEY}'`,
        ),
        'trade_rule_checks_check_status_check',
      );
    });
  });

  describe('Exit Plan Adherence', () => {
    it('represents every approved answer, and refuses the legacy vocabulary', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      for (const answer of [
        'followed',
        'partly_followed',
        'not_followed',
        'unknown',
        'not_applicable',
      ]) {
        expect(
          await attempt(`UPDATE trades SET exit_plan_adherence = '${answer}' WHERE id = '${id}'`),
        ).toEqual({ ok: true });
      }
      expect(
        await attempt(`UPDATE trades SET exit_plan_adherence = NULL WHERE id = '${id}'`),
      ).toEqual({ ok: true });
      expectRefused(
        await attempt(`UPDATE trades SET exit_plan_adherence = 'partly' WHERE id = '${id}'`),
        'trades_exit_plan_adherence_check',
      );
    });

    it('keeps Deviation Type / Reason to a deviating answer, as provisional free text', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      expect(
        await attempt(
          `UPDATE trades SET exit_plan_adherence = 'not_followed',
             exit_plan_deviation_type = 'Early exit', exit_plan_deviation_reason = 'Fear'
           WHERE id = '${id}'`,
        ),
      ).toEqual({ ok: true });
      expectRefused(
        await attempt(`UPDATE trades SET exit_plan_adherence = 'followed' WHERE id = '${id}'`),
        'trades_exit_plan_adherence_check',
      );
      const other = await insertTrade(CONTRACT_CLOSED);
      expectRefused(
        await attempt(
          `UPDATE trades SET exit_plan_deviation_reason = 'Fear' WHERE id = '${other}'`,
        ),
        'trades_exit_plan_adherence_check',
      );
    });

    it('owns the revision: bumps it on a change, keeps it otherwise, ignores a forged value', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      const revision = async (): Promise<number> =>
        (
          await raw.unsafe<{ r: number }[]>(
            `SELECT exit_plan_adherence_revision AS r FROM trades WHERE id = '${id}'`,
          )
        )[0]!.r;
      expect(await revision()).toBe(0);
      await attempt(`UPDATE trades SET exit_plan_adherence = 'followed' WHERE id = '${id}'`);
      expect(await revision()).toBe(1);
      await attempt(`UPDATE trades SET exit_plan_adherence = 'followed' WHERE id = '${id}'`);
      expect(await revision()).toBe(1);
      await attempt(`UPDATE trades SET exit_plan_adherence_revision = 99 WHERE id = '${id}'`);
      expect(await revision()).toBe(1);
      await attempt(`UPDATE trades SET symbol = 'EURUSD' WHERE id = '${id}'`);
      expect(await revision()).toBe(1);
      await attempt(
        `UPDATE trades SET exit_plan_adherence = 'partly_followed',
           exit_plan_deviation_type = 'Late exit' WHERE id = '${id}'`,
      );
      expect(await revision()).toBe(2);
    });

    it('lets a commit detect that the saved answer changed since its draft began', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      // Both drafts start from base revision 0.
      const first = await raw.unsafe(
        `UPDATE trades SET exit_plan_adherence = 'followed'
         WHERE id = '${id}' AND exit_plan_adherence_revision = 0 RETURNING id`,
      );
      expect(first).toHaveLength(1);
      const stale = await raw.unsafe(
        `UPDATE trades SET exit_plan_adherence = 'not_followed'
         WHERE id = '${id}' AND exit_plan_adherence_revision = 0 RETURNING id`,
      );
      expect(stale).toHaveLength(0);
      const [row] = await raw.unsafe<{ exit_plan_adherence: string; r: number }[]>(
        `SELECT exit_plan_adherence, exit_plan_adherence_revision AS r FROM trades
         WHERE id = '${id}'`,
      );
      expect(row).toEqual({ exit_plan_adherence: 'followed', r: 1 });
    });
  });

  describe('canonical System Assessment', () => {
    it('represents No Trade, Cannot Determine and assessed results in Money and in R', async () => {
      const cases: Record<string, string>[] = [
        { finding: `'no_trade'`, rules_in_place_claim: `'yes'` },
        { finding: `'cannot_determine'` },
        ASSESSED_MONEY_NET,
        {
          finding: `'assessed'`,
          exit_mechanism: `'trailing_exit'`,
          result_basis: `'r'`,
          system_result_r: '1.2500',
          result_comparability: `'gross_only'`,
          rules_in_place_claim: `'unknown'`,
        },
        {
          finding: `'assessed'`,
          exit_mechanism: `'break_even_rule'`,
          result_basis: `'money'`,
          system_result_minor: '0',
          result_comparability: `'net'`,
        },
      ];
      for (const columns of cases) {
        const id = await insertTrade(CONTRACT_CLOSED);
        expect(await insertAssessment(id, columns)).toEqual({ ok: true });
      }
    });

    it('stores no Win / Loss / BE, no derived System R and no staleness flag', async () => {
      const columns = await raw.unsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'trade_system_assessments'
         ORDER BY ordinal_position`,
      );
      const names = columns.map((column) => column.column_name);
      expect(names).toEqual([
        'trade_id',
        'workspace_id',
        'recording_contract',
        'finding',
        'exit_mechanism',
        'result_basis',
        'system_result_minor',
        'system_result_r',
        'result_comparability',
        'result_helper',
        'rules_in_place_claim',
        'dependency_snapshot',
        'revision',
        'confirmed_at',
        'revised_at',
        'dependencies_confirmed_at',
        'created_at',
        'updated_at',
      ]);
    });

    it('refuses an incomplete or blurred result, and a result on an answered non-result', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      const refusals: Record<string, string>[] = [
        { ...ASSESSED_MONEY_NET, result_comparability: 'NULL' },
        { ...ASSESSED_MONEY_NET, result_basis: 'NULL' },
        { ...ASSESSED_MONEY_NET, system_result_r: '2.0000' },
        { ...ASSESSED_MONEY_NET, result_basis: `'r'` },
        { ...ASSESSED_MONEY_NET, result_basis: `'price'` },
        { finding: `'no_trade'`, result_basis: `'money'`, system_result_minor: '100' },
        { finding: `'cannot_determine'`, exit_mechanism: `'initial_sl'` },
      ];
      for (const columns of refusals) {
        expectRefused(
          await insertAssessment(id, columns),
          'trade_system_assessments_result_shape_check',
        );
      }
      expectRefused(
        await insertAssessment(id, { finding: `'win'` }),
        'trade_system_assessments_finding_check',
      );
      expectRefused(
        await insertAssessment(id, { ...ASSESSED_MONEY_NET, exit_mechanism: `'price_exit'` }),
        'trade_system_assessments_exit_mechanism_check',
      );
      expectRefused(
        await insertAssessment(id, { finding: `'no_trade'`, rules_in_place_claim: `'maybe'` }),
        'trade_system_assessments_rules_in_place_claim_check',
      );
    });

    it('keeps each helper to its mechanism and its own fill', async () => {
      const accepted: Record<string, string>[] = [
        {
          finding: `'assessed'`,
          exit_mechanism: `'initial_sl'`,
          result_basis: `'r'`,
          system_result_r: '-1.0000',
          result_comparability: `'net'`,
          result_helper: `'initial_sl'`,
        },
        {
          finding: `'assessed'`,
          exit_mechanism: `'initial_sl'`,
          result_basis: `'money'`,
          system_result_minor: '-5000',
          result_comparability: `'gross_only'`,
          result_helper: `'initial_sl'`,
        },
        { ...ASSESSED_MONEY_NET, result_helper: `'target'` },
      ];
      for (const columns of accepted) {
        const id = await insertTrade(CONTRACT_CLOSED);
        expect(await insertAssessment(id, columns)).toEqual({ ok: true });
      }
      const id = await insertTrade(CONTRACT_CLOSED);
      const refused: Record<string, string>[] = [
        { ...ASSESSED_MONEY_NET, result_helper: `'initial_sl'` },
        {
          finding: `'assessed'`,
          exit_mechanism: `'initial_sl'`,
          result_basis: `'r'`,
          system_result_r: '-2.0000',
          result_comparability: `'net'`,
          result_helper: `'initial_sl'`,
        },
        { ...ASSESSED_MONEY_NET, exit_mechanism: `'trailing_exit'`, result_helper: `'target'` },
        { ...ASSESSED_MONEY_NET, result_helper: `'price'` },
      ];
      for (const columns of refused) {
        expectRefused(
          await insertAssessment(id, columns),
          'trade_system_assessments_result_helper_check',
        );
      }
    });

    it('accepts only a versioned v2 dependency snapshot', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      const legacyV1 = JSON.stringify({ version: 1, basis: 'money', plannedRiskMinor: '5000' });
      expectRefused(
        await insertAssessment(id, {
          finding: `'no_trade'`,
          dependency_snapshot: `'${legacyV1}'::jsonb`,
        }),
        'trade_system_assessments_dependency_snapshot_check',
      );
      expectRefused(
        await insertAssessment(id, { finding: `'no_trade'`, dependency_snapshot: `'[]'::jsonb` }),
        'trade_system_assessments_dependency_snapshot_check',
      );
    });

    it('records revision evidence for Update and snapshot time for Reconfirm', async () => {
      const id = await insertTrade(CONTRACT_CLOSED);
      await insertAssessment(id, { finding: `'cannot_determine'` });
      expectRefused(
        await attempt(`UPDATE trade_system_assessments SET revision = 2 WHERE trade_id = '${id}'`),
        'trade_system_assessments_revision_check',
      );
      expect(
        await attempt(
          `UPDATE trade_system_assessments SET finding = 'no_trade', revision = 2,
             revised_at = now(), dependencies_confirmed_at = now() WHERE trade_id = '${id}'`,
        ),
      ).toEqual({ ok: true });
      expectRefused(
        await attempt(
          `UPDATE trade_system_assessments
           SET dependencies_confirmed_at = confirmed_at - interval '1 second'
           WHERE trade_id = '${id}'`,
        ),
        'trade_system_assessments_dependencies_confirmed_at_check',
      );
    });

    it('exists only for an Add Trade v1 Trade in the same workspace', async () => {
      expectRefused(
        await insertAssessment(LEGACY_ID, { finding: `'no_trade'` }),
        'trade_system_assessments_contract_trade_fk',
      );
      expectRefused(
        await insertAssessment(OTHER_WORKSPACE_TRADE_ID, { finding: `'no_trade'` }),
        'trade_system_assessments_contract_trade_fk',
      );
      const id = await insertTrade(CONTRACT_CLOSED);
      expectRefused(
        await insertAssessment(id, { finding: `'no_trade'`, recording_contract: 'NULL' }),
        'null value in column "recording_contract"',
      );
    });

    it('sits beside legacy System evidence on a contract row without replacing it', async () => {
      expect(
        await insertAssessment(CONTRACT_EARLIER_MODEL_ID, {
          ...ASSESSED_MONEY_NET,
          exit_mechanism: `'other_predefined_rule'`,
          rules_in_place_claim: `'yes'`,
        }),
      ).toEqual({ ok: true });
      const [row] = await raw.unsafe(
        `SELECT t.system_status, t.system_resolution_kind, t.strategy_origin, a.finding,
           a.rules_in_place_claim
         FROM trades t JOIN trade_system_assessments a ON a.trade_id = t.id
         WHERE t.id = '${CONTRACT_EARLIER_MODEL_ID}'`,
      );
      // A Q5 "yes" is kept beside a recalled Capture origin and upgrades nothing.
      expect(row).toEqual({
        system_status: 'resolved',
        system_resolution_kind: 'money_custom',
        strategy_origin: 'recalled_after_trade',
        finding: 'assessed',
        rules_in_place_claim: 'yes',
      });
    });

    it('is independent of the Review lifecycle in all four combinations', async () => {
      const neither = await insertTrade(CONTRACT_CLOSED);
      const reviewedOnly = await insertTrade(CONTRACT_CLOSED);
      const assessedOnly = await insertTrade(CONTRACT_CLOSED);
      const both = await insertTrade(CONTRACT_CLOSED);
      await attempt(`UPDATE trades SET ${FINISH} WHERE id IN ('${reviewedOnly}', '${both}')`);
      expect(await insertAssessment(assessedOnly, { finding: `'no_trade'` })).toEqual({ ok: true });
      expect(await insertAssessment(both, ASSESSED_MONEY_NET)).toEqual({ ok: true });
      const rows = await raw.unsafe(
        `SELECT t.id, t.review_status, a.finding FROM trades t
         LEFT JOIN trade_system_assessments a ON a.trade_id = t.id
         WHERE t.id IN ('${neither}', '${reviewedOnly}', '${assessedOnly}', '${both}')
         ORDER BY t.id`,
      );
      expect(rows).toEqual([
        { id: neither, review_status: 'not_reviewed', finding: null },
        { id: reviewedOnly, review_status: 'reviewed', finding: null },
        { id: assessedOnly, review_status: 'not_reviewed', finding: 'no_trade' },
        { id: both, review_status: 'reviewed', finding: 'assessed' },
      ]);
    });
  });
});
