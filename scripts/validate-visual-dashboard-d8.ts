/**
 * D8A read-only validation against the deterministic Visual Dashboard fixture.
 * WRITES NOTHING. It loads the five bulk D8 row shapes and composes the pure
 * Strategy/Psychology/Discipline contract for All/90D/30D.
 */
import postgres from 'postgres';

import { resolveAnalyticsDateBounds, type AnalyticsDatePreset } from '@/lib/analytics/filters';
import {
  composeDashboardInsights,
  type InsightActualTradeInput,
  type InsightEmotionInput,
  type InsightMistakeInput,
  type InsightRuleCheckInput,
  type InsightScope,
  type InsightSystemTradeInput,
} from '@/lib/dashboard/insight-pillars';
import type { OutcomeValue, RuleCheckStatus } from '@/lib/trades/constants';

import {
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_EMAIL,
  VISUAL_FIXTURE_REFERENCE_INSTANT,
  VISUAL_POPULATED_ACCOUNT_NAME,
} from './visual-dashboard-fixture';

interface FixtureAccount {
  readonly id: string;
  readonly name: string;
}

function withinBounds(occurredAt: string, scope: InsightScope): boolean {
  if (scope.dateBounds.kind === 'all') return true;
  const epoch = new Date(occurredAt).getTime();
  return (
    epoch >= new Date(scope.dateBounds.start).getTime() &&
    epoch < new Date(scope.dateBounds.endExclusive).getTime()
  );
}

function insightSummary(value: ReturnType<typeof composeDashboardInsights>) {
  if (value.status !== 'available') return value;
  return {
    strategy: {
      status: value.strategy.status,
      coverage: value.strategy.coverage,
      primaryInsight: value.strategy.primaryInsight,
      secondaryInsight: value.strategy.secondaryInsight,
    },
    psychology: {
      status: value.psychology.status,
      coverage: value.psychology.coverage,
      primaryInsight: value.psychology.primaryInsight,
      secondaryInsight: value.psychology.secondaryInsight,
    },
    discipline: {
      status: value.discipline.status,
      coverage: value.discipline.coverage,
      primaryInsight: value.discipline.primaryInsight,
      secondaryInsight: value.discipline.secondaryInsight,
      supportingMetrics: value.discipline.supportingMetrics,
    },
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('STOP: DATABASE_URL is not set. Run with --env-file=.env.local.');
  }
  const targetEmail = (process.env.VISUAL_TEST_EMAIL ?? VISUAL_FIXTURE_EMAIL).trim().toLowerCase();
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [user] = await sql`select id from users where lower(email) = ${targetEmail} limit 2`;
    if (user === undefined) throw new Error(`STOP: no user for ${targetEmail}.`);
    const memberships = await sql`
      select wm.workspace_id, up.timezone,
             (up.active_trading_account_id is not null
              and ta.workspace_id = wm.workspace_id) as owns_active_account
      from workspace_members wm
      left join user_preferences up on up.user_id = wm.user_id
      left join trading_accounts ta on ta.id = up.active_trading_account_id
      where wm.user_id = ${user.id}
      order by owns_active_account desc nulls last, wm.workspace_id
    `;
    const active = memberships.filter((row) => row.owns_active_account === true);
    const membership = active.length === 1 ? active[0] : memberships[0];
    if (membership === undefined) throw new Error('STOP: workspace cannot be resolved.');
    const workspaceId = membership.workspace_id as string;
    const timezone = membership.timezone as string;
    const accounts = await sql`
      select id, name
      from trading_accounts
      where workspace_id = ${workspaceId}
        and name in (${VISUAL_POPULATED_ACCOUNT_NAME}, ${VISUAL_EMPTY_ACCOUNT_NAME})
    `;
    const byName = new Map(accounts.map((row) => [row.name as string, row as FixtureAccount]));
    const populated = byName.get(VISUAL_POPULATED_ACCOUNT_NAME);
    const empty = byName.get(VISUAL_EMPTY_ACCOUNT_NAME);
    if (populated === undefined || empty === undefined) {
      throw new Error('STOP: visual fixture Accounts are not seeded.');
    }

    async function load(accountId: string) {
      const [actualRows, systemRows, emotionRows, ruleRows, mistakeRows] = await Promise.all([
        sql`
          select t.id, t.actual_r::text, t.trader_outcome, t.exited_at,
                 t.system_r::text, t.system_outcome, t.system_exited_at,
                 t.strategy_id, sv.name as strategy_label,
                 t.setup_id, ssv.name as setup_label, t.confidence
          from trades t
          left join strategy_versions sv on sv.id = t.strategy_version_id
          left join strategy_setup_versions ssv on ssv.id = t.setup_version_id
          where t.workspace_id = ${workspaceId}
            and t.trading_account_id = ${accountId}
            and t.deleted_at is null and t.status = 'closed'
            and t.actual_r is not null and t.trader_outcome is not null and t.exited_at is not null
          order by t.exited_at, t.id
        `,
        sql`
          select t.id, t.system_r::text, t.system_outcome, t.system_exited_at,
                 t.strategy_id, sv.name as strategy_label,
                 t.setup_id, ssv.name as setup_label
          from trades t
          left join strategy_versions sv on sv.id = t.strategy_version_id
          left join strategy_setup_versions ssv on ssv.id = t.setup_version_id
          where t.workspace_id = ${workspaceId}
            and t.trading_account_id = ${accountId}
            and t.deleted_at is null and t.system_status = 'resolved'
            and t.system_r is not null and t.system_outcome is not null
            and t.system_exited_at is not null
          order by t.system_exited_at, t.id
        `,
        sql`
          select te.trade_id, et.key, et.label, et.is_system
          from trade_emotions te
          join emotion_types et on et.id = te.emotion_type_id
          join trades t on t.id = te.trade_id
          where t.workspace_id = ${workspaceId} and t.trading_account_id = ${accountId}
            and t.deleted_at is null and t.status = 'closed'
            and t.actual_r is not null and t.trader_outcome is not null and t.exited_at is not null
          order by t.exited_at, t.id, et.sort_order
        `,
        sql`
          select trc.trade_id, trc.rule_key, trc.title, trc.check_status,
                 trc.is_required, t.exited_at
          from trade_rule_checks trc
          join trades t on t.id = trc.trade_id
          where t.workspace_id = ${workspaceId} and t.trading_account_id = ${accountId}
            and t.deleted_at is null and t.status = 'closed'
            and t.actual_r is not null and t.trader_outcome is not null and t.exited_at is not null
          order by t.exited_at, t.id, trc.sort_order
        `,
        sql`
          select tm.trade_id, tm.mistake_type_id, mt.key, mt.label, mt.is_system
          from trade_mistakes tm
          join mistake_types mt on mt.id = tm.mistake_type_id
          join trades t on t.id = tm.trade_id
          where t.workspace_id = ${workspaceId} and t.trading_account_id = ${accountId}
            and t.deleted_at is null and t.status = 'closed'
            and t.actual_r is not null and t.trader_outcome is not null and t.exited_at is not null
          order by t.exited_at, t.id, mt.sort_order
        `,
      ]);
      return {
        actualTrades: actualRows.map((row): InsightActualTradeInput => ({
          tradeId: row.id as string,
          actualR: row.actual_r as string,
          traderOutcome: row.trader_outcome as OutcomeValue,
          actualExitedAt: (row.exited_at as Date).toISOString(),
          systemR: row.system_r as string | null,
          systemOutcome: row.system_outcome as OutcomeValue | null,
          systemExitedAt: (row.system_exited_at as Date | null)?.toISOString() ?? null,
          strategyId: row.strategy_id as string | null,
          strategyLabel: row.strategy_label as string | null,
          setupId: row.setup_id as string | null,
          setupLabel: row.setup_label as string | null,
          confidence: row.confidence as number | null,
        })),
        systemTrades: systemRows.map((row): InsightSystemTradeInput => ({
          tradeId: row.id as string,
          systemR: row.system_r as string,
          systemOutcome: row.system_outcome as OutcomeValue,
          systemExitedAt: (row.system_exited_at as Date).toISOString(),
          strategyId: row.strategy_id as string | null,
          strategyLabel: row.strategy_label as string | null,
          setupId: row.setup_id as string | null,
          setupLabel: row.setup_label as string | null,
        })),
        emotions: emotionRows.map((row): InsightEmotionInput => ({
          tradeId: row.trade_id as string,
          key: row.key as string,
          label: row.label as string,
          isSystem: row.is_system as boolean,
        })),
        ruleChecks: ruleRows.map((row): InsightRuleCheckInput => ({
          tradeId: row.trade_id as string,
          ruleKey: row.rule_key as string,
          title: row.title as string,
          checkStatus: row.check_status as RuleCheckStatus,
          isRequired: row.is_required as boolean,
          occurredAt: (row.exited_at as Date).toISOString(),
        })),
        mistakes: mistakeRows.map((row): InsightMistakeInput => ({
          tradeId: row.trade_id as string,
          mistakeTypeId: row.mistake_type_id as string,
          key: row.key as string,
          label: row.label as string,
          isSystem: row.is_system as boolean,
        })),
      };
    }

    function compose(
      account: FixtureAccount,
      raw: Awaited<ReturnType<typeof load>>,
      datePreset: AnalyticsDatePreset,
    ) {
      const bounds = resolveAnalyticsDateBounds(
        datePreset,
        timezone,
        VISUAL_FIXTURE_REFERENCE_INSTANT,
      );
      if (!bounds.ok) throw new Error(`STOP: ${datePreset} bounds failed.`);
      const scope: InsightScope = {
        datePreset,
        dateBounds: bounds.bounds,
        accountScope: { kind: 'account', accountId: account.id, source: 'explicit' },
        strategyId: null,
        setupId: null,
        strategyVersionId: null,
      };
      const actualTrades = raw.actualTrades.filter((trade) =>
        withinBounds(trade.actualExitedAt, scope),
      );
      const actualIds = new Set(actualTrades.map((trade) => trade.tradeId));
      return composeDashboardInsights({
        scope,
        actualTrades,
        systemTrades: raw.systemTrades.filter((trade) => withinBounds(trade.systemExitedAt, scope)),
        emotions: raw.emotions.filter((row) => actualIds.has(row.tradeId)),
        ruleChecks: raw.ruleChecks.filter((row) => actualIds.has(row.tradeId)),
        mistakes: raw.mistakes.filter((row) => actualIds.has(row.tradeId)),
      });
    }

    const [populatedRaw, emptyRaw] = await Promise.all([load(populated.id), load(empty.id)]);
    const populatedAll = compose(populated, populatedRaw, 'all');
    const populated90 = compose(populated, populatedRaw, '90d');
    const populated30 = compose(populated, populatedRaw, '30d');
    const emptyAll = compose(empty, emptyRaw, 'all');
    if (
      populatedAll.status !== 'available' ||
      populated90.status !== 'available' ||
      populated30.status !== 'available' ||
      emptyAll.status !== 'available'
    ) {
      throw new Error('STOP: D8 fixture composition returned an integrity error.');
    }
    if (
      emptyAll.strategy.status !== 'no_eligible_trades' ||
      emptyAll.psychology.status !== 'no_eligible_trades' ||
      emptyAll.discipline.status !== 'no_eligible_trades'
    ) {
      throw new Error(`STOP: Empty pillar semantics drifted: ${JSON.stringify(emptyAll)}`);
    }
    const [partial] = await sql`
      select count(*)::int as trade_count, coalesce(sum(exit_count), 0)::int as exit_count
      from (
        select t.id, count(te.id)::int as exit_count
        from trades t join trade_exits te on te.trade_id = t.id
        where t.workspace_id = ${workspaceId} and t.trading_account_id = ${populated.id}
          and t.status = 'closed' and t.deleted_at is null
        group by t.id having count(te.id) > 1
      ) partials
    `;
    if (partial?.trade_count !== 10 || partial.exit_count !== 24) {
      throw new Error(`STOP: partial-close fixture drifted: ${JSON.stringify(partial)}`);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          timezone,
          asOf: VISUAL_FIXTURE_REFERENCE_INSTANT.toISOString(),
          queryArchitecture: {
            dashboardCoreMajorReads: 5,
            riskPerformanceMajorReads: 1,
            insightMajorReads: 5,
            projections: ['actual_trades', 'system_trades', 'emotions', 'rule_checks', 'mistakes'],
            populatedRows: {
              actualTrades: populatedRaw.actualTrades.length,
              systemTrades: populatedRaw.systemTrades.length,
              emotions: populatedRaw.emotions.length,
              ruleChecks: populatedRaw.ruleChecks.length,
              mistakes: populatedRaw.mistakes.length,
            },
            emptyRows: {
              actualTrades: emptyRaw.actualTrades.length,
              systemTrades: emptyRaw.systemTrades.length,
              emotions: emptyRaw.emotions.length,
              ruleChecks: emptyRaw.ruleChecks.length,
              mistakes: emptyRaw.mistakes.length,
            },
          },
          empty: insightSummary(emptyAll),
          populated: {
            all: insightSummary(populatedAll),
            '90d': insightSummary(populated90),
            '30d': insightSummary(populated30),
          },
          partialClose: {
            tradeCount: partial.trade_count,
            exitLegCount: partial.exit_count,
            actualTradeSamples: populatedRaw.actualTrades.length,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
