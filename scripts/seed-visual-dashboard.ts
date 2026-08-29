import { createHash } from 'node:crypto';

import postgres from 'postgres';

import type {
  ComparisonMetricRecord,
  SystemMetricRecord,
  TraderMetricRecord,
} from '@/lib/analytics/metrics';
import {
  composeDashboardPageData,
  type DashboardRecentTradeRecord,
} from '@/lib/dashboard/page-data';
import type {
  OutcomeValue,
  SystemStatus,
  TradeDirection,
  TradeStatus,
} from '@/lib/trades/constants';

import {
  assertVisualSeedSafety,
  buildVisualTradeBlueprints,
  legacyVisualAccountIdentity,
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_EMAIL,
  VISUAL_FIXTURE_REFERENCE_INSTANT,
  VISUAL_POPULATED_ACCOUNT_NAME,
  visualAccountIdentity,
  visualTradeChildIdentity,
  type VisualTradeBlueprint,
} from './visual-dashboard-fixture';

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, candidate) => (typeof candidate === 'bigint' ? candidate.toString() : candidate),
    2,
  );
}

function identityDigest(value: unknown): string {
  return createHash('sha256').update(safeJson(value)).digest('hex');
}

function ruleStatus(index: number, ruleIndex: number): string {
  const value = index + ruleIndex * 3;
  if (value % 17 === 0) return 'not_checked';
  if (value % 13 === 0) return 'not_applicable';
  if (value % 9 === 0) return 'violated';
  return 'followed';
}

function accountScope(accountId: string, timezone: string) {
  return {
    datePreset: 'all' as const,
    dateBounds: { kind: 'all' as const, start: null, endExclusive: null },
    accountScope: { kind: 'account' as const, accountId, source: 'explicit' as const },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    timezone,
  };
}

function filters(accountId: string) {
  return {
    datePreset: 'all' as const,
    customDateRange: null,
    accountScope: { kind: 'account' as const, accountId },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    unitMode: 'r' as const,
    dimensions: {
      symbol: null,
      side: null,
      session: null,
      timeframe: null,
      ruleAdherence: null,
      mistake: null,
      emotion: null,
    },
  };
}

function metricValue(metric: { readonly status: string; readonly value?: unknown }) {
  return metric.status === 'available' ? metric.value : metric;
}

async function main(): Promise<void> {
  const target = assertVisualSeedSafety(process.env);
  const targetEmail = (process.env.VISUAL_TEST_EMAIL ?? VISUAL_FIXTURE_EMAIL).trim().toLowerCase();
  console.log(
    safeJson({
      event: 'VISUAL_FIXTURE_TARGET',
      environment: target.environment,
      database: target.database,
      host: target.host,
      port: target.port,
      user: targetEmail,
      referenceInstant: VISUAL_FIXTURE_REFERENCE_INSTANT.toISOString(),
    }),
  );

  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    const users = await sql`
      select id, email
      from users
      where lower(email) = ${targetEmail}
    `;
    if (users.length === 0)
      throw new Error(`STOP: target development user ${targetEmail} was not found.`);
    if (users.length !== 1)
      throw new Error(`STOP: target email ${targetEmail} resolved ambiguously.`);
    const user = users[0]!;

    const memberships = await sql`
      select wm.workspace_id, wm.role, up.timezone, up.active_trading_account_id,
             (ta.workspace_id = wm.workspace_id) as owns_active_account
      from workspace_members wm
      left join user_preferences up on up.user_id = wm.user_id
      left join trading_accounts ta on ta.id = up.active_trading_account_id
      where wm.user_id = ${user.id}
      order by owns_active_account desc nulls last, wm.workspace_id
    `;
    const activeMemberships = memberships.filter((row) => row.owns_active_account === true);
    const membership =
      activeMemberships.length === 1
        ? activeMemberships[0]
        : memberships.length === 1
          ? memberships[0]
          : undefined;
    if (!membership)
      throw new Error('STOP: target user workspace cannot be resolved unambiguously.');
    if (typeof membership.timezone !== 'string' || membership.timezone.length === 0) {
      throw new Error('STOP: target user has no persisted analytics timezone.');
    }
    const workspaceId = membership.workspace_id as string;
    const timezone = membership.timezone as string;

    const [framework] = await sql`
      select s.id as strategy_id, sv.id as version_id, sv.name, sv.locked_at
      from strategies s
      join strategy_versions sv on sv.id = s.current_version_id
      where s.workspace_id = ${workspaceId}
        and not s.is_archived
        and lower(sv.name) = lower('Elliott Wave')
      order by s.created_at
      limit 2
    `;
    if (!framework) throw new Error('STOP: a usable existing Elliott Wave strategy was not found.');
    if (framework.locked_at === null) {
      throw new Error(
        'STOP: the existing strategy version is not locked; the fixture will not mutate it.',
      );
    }
    const setupRows = await sql`
      select su.id, ssv.id as version_id, ssv.name
      from setups su
      join strategy_setup_versions ssv
        on ssv.setup_id = su.id and ssv.strategy_version_id = ${framework.version_id}
      where su.workspace_id = ${workspaceId}
        and su.strategy_id = ${framework.strategy_id}
        and not su.is_archived
      order by ssv.sort_order, ssv.name
    `;
    if (setupRows.length < 3)
      throw new Error('STOP: the existing strategy has fewer than three usable Setup snapshots.');
    const ruleRows = await sql`
      select id, strategy_version_id, rule_key, title, category,
             is_required, is_pre_trade_check, sort_order
      from strategy_rules
      where workspace_id = ${workspaceId}
        and strategy_version_id = ${framework.version_id}
      order by sort_order, id
    `;
    const taxonomyKeys = ['early_exit', 'chased_entry', 'revenge_trade'];
    const mistakeTypes = await sql`
      select id, key, severity, default_weight
      from mistake_types
      where is_system and not is_archived and key in ${sql(taxonomyKeys)}
    `;
    if (mistakeTypes.length !== taxonomyKeys.length) {
      throw new Error('STOP: canonical mistake taxonomy is incomplete.');
    }
    const emotionTypes = await sql`
      select id, key
      from emotion_types
      where is_system and not is_archived
    `;
    const emotionByKey = new Map(emotionTypes.map((row) => [row.key as string, row.id as string]));
    for (const key of ['calm', 'focused', 'fearful', 'fomo', 'revenge']) {
      if (!emotionByKey.has(key)) throw new Error(`STOP: canonical emotion ${key} is missing.`);
    }

    const identities = visualAccountIdentity({ ownerIdentity: targetEmail, workspaceId });
    const legacyIdentities = legacyVisualAccountIdentity(targetEmail);
    let emptyAccountId = identities.emptyId;
    let populatedAccountId = identities.populatedId;
    let unrelatedBefore = '';
    let unrelatedAfter = '';
    let tradeBlueprints: readonly VisualTradeBlueprint[] = [];
    let migrationBefore = '';
    let migrationAfter = '';
    let deterministicIdentityDigest = '';
    let deterministicIdentityCounts: Readonly<Record<string, number>> = {};

    await sql.begin(async (tx) => {
      const latestMigration = await tx`
        select id, hash, created_at
        from drizzle.__drizzle_migrations
        order by id desc limit 1
      `;
      migrationBefore = safeJson(latestMigration[0] ?? null);

      const deterministicCollisions = await tx`
        select id, workspace_id, name, mutation_key
        from trading_accounts
        where id in ${tx([identities.emptyId, identities.populatedId])}
      `;
      for (const account of deterministicCollisions) {
        const expectedMutationKey =
          account.id === identities.emptyId
            ? identities.emptyMutationKey
            : identities.populatedMutationKey;
        if (account.workspace_id !== workspaceId || account.mutation_key !== expectedMutationKey) {
          throw new Error(
            'STOP: deterministic fixture Account identity is already owned by non-fixture data.',
          );
        }
      }

      const namedAccounts = await tx`
        select id, name, mutation_key
        from trading_accounts
        where workspace_id = ${workspaceId}
          and name in ${tx([VISUAL_EMPTY_ACCOUNT_NAME, VISUAL_POPULATED_ACCOUNT_NAME])}
        order by name, id
        for update
      `;
      for (const name of [VISUAL_EMPTY_ACCOUNT_NAME, VISUAL_POPULATED_ACCOUNT_NAME]) {
        const matches = namedAccounts.filter((row) => row.name === name);
        if (matches.length > 1) {
          throw new Error(`STOP: more than one Account is named ${name}; ownership is ambiguous.`);
        }
        const existing = matches[0];
        const expectedMutationKey =
          name === VISUAL_EMPTY_ACCOUNT_NAME
            ? identities.emptyMutationKey
            : identities.populatedMutationKey;
        const legacyMutationKey =
          name === VISUAL_EMPTY_ACCOUNT_NAME
            ? legacyIdentities.emptyMutationKey
            : legacyIdentities.populatedMutationKey;
        if (
          existing &&
          existing.mutation_key !== expectedMutationKey &&
          existing.mutation_key !== legacyMutationKey
        ) {
          throw new Error(
            `STOP: ${name} exists without the deterministic fixture ownership marker.`,
          );
        }
      }
      emptyAccountId =
        (namedAccounts.find((row) => row.name === VISUAL_EMPTY_ACCOUNT_NAME)?.id as
          string | undefined) ?? identities.emptyId;
      populatedAccountId =
        (namedAccounts.find((row) => row.name === VISUAL_POPULATED_ACCOUNT_NAME)?.id as
          string | undefined) ?? identities.populatedId;

      const unrelated = await tx`
        select ta.id, ta.name, ta.updated_at,
               count(t.id)::int as trade_count
        from trading_accounts ta
        left join trades t on t.trading_account_id = ta.id
        where ta.workspace_id = ${workspaceId}
          and ta.id not in ${tx([emptyAccountId, populatedAccountId])}
        group by ta.id, ta.name, ta.updated_at
        order by ta.id
      `;
      unrelatedBefore = safeJson(unrelated);

      const accountRows = [
        {
          id: emptyAccountId,
          workspace_id: workspaceId,
          name: VISUAL_EMPTY_ACCOUNT_NAME,
          account_mode: 'live',
          base_currency: 'USD',
          starting_balance: '10000.0000000000',
          timezone,
          is_archived: false,
          mutation_key: identities.emptyMutationKey,
        },
        {
          id: populatedAccountId,
          workspace_id: workspaceId,
          name: VISUAL_POPULATED_ACCOUNT_NAME,
          account_mode: 'live',
          base_currency: 'USD',
          starting_balance: '10000.0000000000',
          timezone,
          is_archived: false,
          mutation_key: identities.populatedMutationKey,
        },
      ];
      for (const account of accountRows) {
        await tx`
          insert into trading_accounts ${tx(account)}
          on conflict (id) do update set
            name = excluded.name,
            account_mode = excluded.account_mode,
            base_currency = excluded.base_currency,
            starting_balance = excluded.starting_balance,
            timezone = excluded.timezone,
            is_archived = false,
            mutation_key = excluded.mutation_key,
            updated_at = now()
        `;
      }

      tradeBlueprints = buildVisualTradeBlueprints({
        populatedAccountId,
        framework: {
          strategyId: framework.strategy_id as string,
          strategyVersionId: framework.version_id as string,
          setups: setupRows.slice(0, 3).map((row) => ({
            id: row.id as string,
            versionId: row.version_id as string,
            name: row.name as string,
          })),
        },
      });

      const generatedTradeIds = tradeBlueprints.map((trade) => trade.id);
      const generatedTradeMutationKeys = tradeBlueprints.map((trade) => trade.mutationKey);
      const generatedExitIds = tradeBlueprints.flatMap((trade) =>
        trade.exits.map((exit) => exit.id),
      );
      const generatedExitMutationKeys = tradeBlueprints.flatMap((trade) =>
        trade.exits.map((exit) => exit.mutationKey),
      );
      const generatedRuleCheckIds = tradeBlueprints.flatMap((trade) =>
        trade.strategyVersionId === null
          ? []
          : ruleRows.map((rule) =>
              visualTradeChildIdentity(trade.id, 'rule-check', rule.rule_key as string),
            ),
      );
      const foreignTradeCollisions = await tx`
        select id
        from trades
        where (id in ${tx(generatedTradeIds)}
               or (workspace_id = ${workspaceId}
                   and mutation_key in ${tx(generatedTradeMutationKeys)}))
          and not (workspace_id = ${workspaceId}
                   and trading_account_id in ${tx([emptyAccountId, populatedAccountId])})
      `;
      const foreignExitCollisions = await tx`
        select te.id
        from trade_exits te
        join trades t on t.id = te.trade_id
        where (te.id in ${tx(generatedExitIds)}
               or (te.workspace_id = ${workspaceId}
                   and te.mutation_key in ${tx(generatedExitMutationKeys)}))
          and not (t.workspace_id = ${workspaceId}
                   and t.trading_account_id in ${tx([emptyAccountId, populatedAccountId])})
      `;
      const foreignRuleCheckCollisions =
        generatedRuleCheckIds.length === 0
          ? []
          : await tx`
              select trc.id
              from trade_rule_checks trc
              join trades t on t.id = trc.trade_id
              where trc.id in ${tx(generatedRuleCheckIds)}
                and not (t.workspace_id = ${workspaceId}
                         and t.trading_account_id in ${tx([emptyAccountId, populatedAccountId])})
            `;
      if (
        foreignTradeCollisions.length > 0 ||
        foreignExitCollisions.length > 0 ||
        foreignRuleCheckCollisions.length > 0
      ) {
        throw new Error(
          'STOP: a generated fixture Trade/Exit/rule-check identity is owned by unrelated data.',
        );
      }

      await tx`
        delete from trades t
        using trading_accounts ta
        where t.trading_account_id = ta.id
          and t.workspace_id = ${workspaceId}
          and ta.workspace_id = ${workspaceId}
          and ta.id in ${tx([emptyAccountId, populatedAccountId])}
          and ta.mutation_key in ${tx([identities.emptyMutationKey, identities.populatedMutationKey])}
      `;

      const tradeRows = tradeBlueprints.map((trade) => ({
        id: trade.id,
        workspace_id: workspaceId,
        mutation_key: trade.mutationKey,
        trading_account_id: trade.tradingAccountId,
        strategy_id: trade.strategyId,
        strategy_version_id: trade.strategyVersionId,
        setup_id: trade.setupId,
        setup_version_id: trade.setupVersionId,
        strategy_assigned_at: trade.strategyAssignedAt,
        setup_assigned_at: trade.setupAssignedAt,
        symbol: trade.symbol,
        direction: trade.direction,
        timeframe: trade.timeframe,
        session: trade.session,
        confirmation_notes: trade.confirmationNotes,
        confidence: trade.confidence,
        notes: trade.notes,
        review_notes: trade.reviewNotes,
        emotions_recorded_at: trade.emotionsRecordedAt,
        planned_risk_minor: trade.plannedRiskMinor.toString(),
        planned_reward_minor: trade.plannedRewardMinor.toString(),
        planned_r: trade.plannedR,
        actual_result_mode: trade.actualResultMode,
        actual_initial_risk_minor: trade.actualInitialRiskMinor?.toString() ?? null,
        actual_position_size: trade.actualResultMode === null ? null : '1.0000000000',
        gross_pnl_minor: trade.grossPnlMinor?.toString() ?? null,
        commission_minor: trade.commissionMinor.toString(),
        fees_minor: trade.feesMinor.toString(),
        swap_minor: trade.swapMinor.toString(),
        net_pnl_minor: trade.netPnlMinor?.toString() ?? null,
        entered_at: trade.enteredAt,
        exited_at: trade.exitedAt,
        system_status: trade.systemStatus,
        system_resolution_kind: trade.systemResolutionKind,
        system_gross_r_input: trade.systemGrossRInput,
        system_exited_at: trade.systemExitedAt,
        system_exit_reason: trade.systemExitReason,
        system_cost_r: trade.systemCostR,
        system_resolved_at: trade.systemResolvedAt,
        actual_r: trade.actualR,
        system_r: trade.systemR,
        trader_outcome: trade.traderOutcome,
        system_outcome: trade.systemOutcome,
        calc_version: trade.calcVersion,
        status: trade.status,
        followed_plan: trade.followedPlan,
        created_at: trade.createdAt,
        updated_at: trade.updatedAt,
      }));
      await tx`insert into trades ${tx(tradeRows)}`;

      const exitRows = tradeBlueprints.flatMap((trade) =>
        trade.exits.map((exit) => ({
          id: exit.id,
          workspace_id: workspaceId,
          trade_id: trade.id,
          mutation_key: exit.mutationKey,
          sequence: exit.sequence,
          closed_bps: exit.closedBps,
          realized_pnl_minor: exit.realizedPnlMinor.toString(),
          exit_reason: exit.exitReason,
          exited_at: exit.exitedAt,
          created_at: exit.exitedAt,
          updated_at: exit.exitedAt,
        })),
      );
      await tx`insert into trade_exits ${tx(exitRows)}`;

      const checkRows = tradeBlueprints.flatMap((trade) =>
        trade.strategyVersionId === null
          ? []
          : ruleRows.map((rule, ruleIndex) => ({
              id: visualTradeChildIdentity(trade.id, 'rule-check', rule.rule_key as string),
              workspace_id: workspaceId,
              trade_id: trade.id,
              strategy_rule_id: rule.id,
              strategy_version_id: rule.strategy_version_id,
              rule_key: rule.rule_key,
              check_status: ruleStatus(trade.fixtureIndex, ruleIndex),
              title: rule.title,
              category: rule.category,
              is_required: rule.is_required,
              is_pre_trade_check: rule.is_pre_trade_check,
              sort_order: rule.sort_order,
              created_at: trade.createdAt,
              updated_at: trade.updatedAt,
            })),
      );
      if (checkRows.length > 0) await tx`insert into trade_rule_checks ${tx(checkRows)}`;

      const mistakeByKey = new Map(mistakeTypes.map((row) => [row.key as string, row]));
      const mistakeRows = tradeBlueprints.flatMap((trade) =>
        trade.mistakeKeys.map((key) => {
          const mistake = mistakeByKey.get(key);
          if (!mistake) throw new Error(`STOP: canonical mistake ${key} is missing.`);
          return {
            trade_id: trade.id,
            mistake_type_id: mistake.id,
            workspace_id: workspaceId,
            note:
              key === 'chased_entry'
                ? 'FOMO/chased entry context for visual review.'
                : `Deterministic ${key} review context.`,
            severity_at_time: mistake.severity,
            weight_at_time: mistake.default_weight,
            created_at: trade.updatedAt,
            updated_at: trade.updatedAt,
          };
        }),
      );
      if (mistakeRows.length > 0) await tx`insert into trade_mistakes ${tx(mistakeRows)}`;

      const emotionRows = tradeBlueprints.flatMap((trade) =>
        trade.emotionKeys.map((key) => ({
          trade_id: trade.id,
          emotion_type_id: emotionByKey.get(key) as string,
          workspace_id: workspaceId,
          created_at: trade.updatedAt,
        })),
      );
      if (emotionRows.length > 0) await tx`insert into trade_emotions ${tx(emotionRows)}`;

      const identityManifest = {
        accountIds: [emptyAccountId, populatedAccountId].sort(),
        accountMutationKeys: [identities.emptyMutationKey, identities.populatedMutationKey].sort(),
        tradeIds: generatedTradeIds.sort(),
        tradeMutationKeys: generatedTradeMutationKeys.sort(),
        exitIds: generatedExitIds.sort(),
        exitMutationKeys: generatedExitMutationKeys.sort(),
        ruleCheckIds: generatedRuleCheckIds.sort(),
        mistakeCompositeKeys: mistakeRows
          .map((row) => `${row.trade_id}:${row.mistake_type_id}`)
          .sort(),
        emotionCompositeKeys: emotionRows
          .map((row) => `${row.trade_id}:${row.emotion_type_id}`)
          .sort(),
      };
      deterministicIdentityDigest = identityDigest(identityManifest);
      deterministicIdentityCounts = Object.fromEntries(
        Object.entries(identityManifest).map(([kind, values]) => [kind, values.length]),
      );

      const unrelatedNow = await tx`
        select ta.id, ta.name, ta.updated_at,
               count(t.id)::int as trade_count
        from trading_accounts ta
        left join trades t on t.trading_account_id = ta.id
        where ta.workspace_id = ${workspaceId}
          and ta.id not in ${tx([emptyAccountId, populatedAccountId])}
        group by ta.id, ta.name, ta.updated_at
        order by ta.id
      `;
      unrelatedAfter = safeJson(unrelatedNow);
      if (unrelatedBefore !== unrelatedAfter) {
        throw new Error(
          'STOP: unrelated Account fingerprint changed inside the fixture transaction.',
        );
      }

      const latestMigrationAfter = await tx`
        select id, hash, created_at
        from drizzle.__drizzle_migrations
        order by id desc limit 1
      `;
      migrationAfter = safeJson(latestMigrationAfter[0] ?? null);
      if (migrationBefore !== migrationAfter)
        throw new Error('STOP: migration journal changed during seed.');
    });

    const accountRows = await sql`
      select id, name, account_mode, base_currency, starting_balance, timezone
      from trading_accounts
      where id in ${sql([emptyAccountId, populatedAccountId])}
      order by name
    `;
    const accountById = new Map(accountRows.map((row) => [row.id as string, row]));
    const attentionRows = await sql`
      select
        count(*) filter (where status = 'open')::int as open_trades,
        count(*) filter (where system_status = 'pending')::int as pending_system_outcomes,
        count(*) filter (where strategy_id is null)::int as unclassified_trades,
        count(*) filter (where status = 'closed' and review_notes is null)::int as reviews_pending,
        count(*) filter (where status = 'planned')::int as needs_execution_details
      from trades
      where workspace_id = ${workspaceId} and deleted_at is null
    `;
    const fixtureAttentionRows = await sql`
      select
        count(*) filter (where status = 'open')::int as open_trades,
        count(*) filter (where system_status = 'pending')::int as pending_system_outcomes,
        count(*) filter (where strategy_id is null)::int as unclassified_trades,
        count(*) filter (where status = 'closed' and review_notes is null)::int as reviews_pending,
        count(*) filter (where status = 'planned')::int as needs_execution_details
      from trades
      where workspace_id = ${workspaceId}
        and trading_account_id = ${populatedAccountId}
        and deleted_at is null
    `;

    const loadPage = async (accountId: string) => {
      const traderRaw = await sql`
        select t.id as trade_id, t.status, t.deleted_at, t.actual_r, t.trader_outcome,
               t.exited_at, t.net_pnl_minor::text, ta.base_currency
        from trades t
        join trading_accounts ta on ta.id = t.trading_account_id
        where t.workspace_id = ${workspaceId}
          and t.trading_account_id = ${accountId}
          and t.status = 'closed'
          and t.deleted_at is null
          and t.actual_r is not null
          and t.trader_outcome is not null
          and t.exited_at is not null
      `;
      const systemRaw = await sql`
        select id as trade_id, system_status, deleted_at, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId}
          and trading_account_id = ${accountId}
          and system_status = 'resolved'
          and deleted_at is null
          and system_r is not null
          and system_outcome is not null
          and system_exited_at is not null
      `;
      const comparisonRaw = await sql`
        select id as trade_id, status, deleted_at, actual_r, trader_outcome, exited_at,
               system_status, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId}
          and trading_account_id = ${accountId}
          and status = 'closed'
          and system_status = 'resolved'
          and deleted_at is null
      `;
      const recentRaw = await sql`
        select t.id as trade_id,
               coalesce(t.exited_at, t.entered_at, t.created_at) as occurred_at,
               t.symbol, t.direction, ta.name as trading_account_name, t.status,
               t.trader_outcome, t.actual_r, t.exited_at as actual_exited_at,
               t.system_status, t.system_outcome, t.system_r, t.system_exited_at,
               sv.name as strategy_name, ssv.name as setup_name
        from trades t
        join trading_accounts ta on ta.id = t.trading_account_id
        left join strategy_versions sv on sv.id = t.strategy_version_id
        left join strategy_setup_versions ssv on ssv.id = t.setup_version_id
        where t.workspace_id = ${workspaceId}
          and t.trading_account_id = ${accountId}
          and t.deleted_at is null
        order by coalesce(t.exited_at, t.entered_at, t.created_at) desc, t.id desc
        limit 10
      `;
      const trader: TraderMetricRecord[] = traderRaw.map((row) => ({
        tradeId: row.trade_id as string,
        status: row.status as TradeStatus,
        deletedAt: null,
        actualR: row.actual_r as string,
        traderOutcome: row.trader_outcome as OutcomeValue,
        exitedAt: (row.exited_at as Date).toISOString(),
        netPnlMinor: row.net_pnl_minor as string,
        baseCurrency: row.base_currency as string,
      }));
      const system: SystemMetricRecord[] = systemRaw.map((row) => ({
        tradeId: row.trade_id as string,
        systemStatus: row.system_status as SystemStatus,
        deletedAt: null,
        systemR: row.system_r as string,
        systemOutcome: row.system_outcome as OutcomeValue,
        systemExitedAt: (row.system_exited_at as Date).toISOString(),
      }));
      const comparison: ComparisonMetricRecord[] = comparisonRaw.map((row) => ({
        tradeId: row.trade_id as string,
        status: row.status as TradeStatus,
        deletedAt: null,
        actualR: row.actual_r as string,
        traderOutcome: row.trader_outcome as OutcomeValue,
        actualExitedAt: (row.exited_at as Date).toISOString(),
        systemStatus: row.system_status as SystemStatus,
        systemR: row.system_r as string,
        systemOutcome: row.system_outcome as OutcomeValue,
        systemExitedAt: (row.system_exited_at as Date).toISOString(),
      }));
      const recentTrades: DashboardRecentTradeRecord[] = recentRaw.map((row) => ({
        tradeId: row.trade_id as string,
        occurredAt: (row.occurred_at as Date).toISOString(),
        symbol: row.symbol as string,
        direction: row.direction as TradeDirection,
        tradingAccountName: row.trading_account_name as string,
        status: row.status as TradeStatus,
        traderOutcome: row.trader_outcome as OutcomeValue | null,
        actualR: row.actual_r as string | null,
        actualExitedAt:
          row.actual_exited_at === null ? null : (row.actual_exited_at as Date).toISOString(),
        systemStatus: row.system_status as SystemStatus,
        systemOutcome: row.system_outcome as OutcomeValue | null,
        systemR: row.system_r as string | null,
        systemExitedAt:
          row.system_exited_at === null ? null : (row.system_exited_at as Date).toISOString(),
        strategyName: row.strategy_name as string | null,
        setupName: row.setup_name as string | null,
      }));
      const account = accountById.get(accountId)!;
      return composeDashboardPageData({
        scope: accountScope(accountId, timezone),
        filters: filters(accountId),
        account: {
          kind: 'account',
          source: 'explicit',
          account: {
            id: accountId,
            name: account.name as string,
            accountMode: account.account_mode as 'live',
            baseCurrency: account.base_currency as string,
            startingBalance: account.starting_balance as string,
          },
        },
        trader,
        system,
        comparison,
        attention: {
          openTrades: attentionRows[0]!.open_trades as number,
          pendingSystemOutcomes: attentionRows[0]!.pending_system_outcomes as number,
          unclassifiedTrades: attentionRows[0]!.unclassified_trades as number,
          reviewsPending: attentionRows[0]!.reviews_pending as number,
          needsExecutionDetails: attentionRows[0]!.needs_execution_details as number,
        },
        recentTrades,
      });
    };

    const emptyPage = await loadPage(emptyAccountId);
    const populatedPage = await loadPage(populatedAccountId);
    const counts = await sql`
      select count(*)::int as trades,
             count(*) filter (where status = 'closed')::int as closed_actual,
             count(*) filter (where status = 'open')::int as open_trades,
             count(*) filter (where status = 'planned')::int as planned_trades,
             min(created_at) as first_created_at,
             max(coalesce(exited_at, entered_at, created_at)) as last_occurred_at
      from trades
      where workspace_id = ${workspaceId} and trading_account_id = ${populatedAccountId}
    `;
    const exitCounts = await sql`
      select coalesce(sum(leg_count), 0)::int as exits,
             count(*) filter (where leg_count > 1)::int as partial_close_trades
      from (
        select t.id, count(te.id)::int as leg_count
        from trades t
        left join trade_exits te on te.trade_id = t.id
        where t.workspace_id = ${workspaceId} and t.trading_account_id = ${populatedAccountId}
        group by t.id
      ) legs
    `;
    const populations = await sql`
      select
        count(*) filter (where trader_ok and not system_ok)::int as population_a,
        count(*) filter (where system_ok and not trader_ok)::int as population_b,
        count(*) filter (where trader_ok and system_ok)::int as population_c
      from (
        select
          (status = 'closed' and actual_r is not null and trader_outcome is not null and exited_at is not null) as trader_ok,
          (system_status = 'resolved' and system_r is not null and system_outcome is not null and system_exited_at is not null) as system_ok
        from trades
        where workspace_id = ${workspaceId}
          and trading_account_id = ${populatedAccountId}
          and deleted_at is null
      ) eligibility
    `;
    const contexts = await sql`
      select array_agg(distinct symbol order by symbol) as symbols,
             array_agg(distinct timeframe order by timeframe) as timeframes,
             array_agg(distinct session order by session) as sessions
      from trades
      where workspace_id = ${workspaceId} and trading_account_id = ${populatedAccountId}
    `;
    const recentGapCounts = tradeBlueprints.slice(0, 64).reduce(
      (summary, trade) => {
        const comparison = Number(trade.actualR) - Number(trade.systemR);
        if (Math.abs(comparison) < 1e-9) summary.perfect += 1;
        else if (comparison < 0) summary.leakage += 1;
        else summary.outperformance += 1;
        return summary;
      },
      { perfect: 0, leakage: 0, outperformance: 0 },
    );
    const report = {
      event: 'VISUAL_FIXTURE_COMPLETE',
      environment: target.environment,
      database: { host: target.host, port: target.port, name: target.database },
      targetUser: { email: targetEmail, userId: user.id, workspaceId, timezone },
      accounts: {
        empty: {
          id: emptyAccountId,
          name: VISUAL_EMPTY_ACCOUNT_NAME,
          traderCount: emptyPage.coverage.traderTradeCount,
          systemCount: emptyPage.coverage.systemTradeCount,
          pairedCount: emptyPage.coverage.pairedTradeCount,
          netPnl: emptyPage.basic.netPnl,
        },
        populated: {
          id: populatedAccountId,
          name: VISUAL_POPULATED_ACCOUNT_NAME,
          ...counts[0],
          ...exitCounts[0],
          dateRange: {
            first: (counts[0]!.first_created_at as Date).toISOString(),
            last: (counts[0]!.last_occurred_at as Date).toISOString(),
          },
        },
      },
      framework: {
        strategy: framework.name,
        strategyId: framework.strategy_id,
        strategyVersionId: framework.version_id,
        setups: setupRows
          .slice(0, 3)
          .map((row) => ({ id: row.id, versionId: row.version_id, name: row.name })),
        symbols: contexts[0]!.symbols,
        timeframes: contexts[0]!.timeframes,
        sessions: contexts[0]!.sessions,
      },
      populations: populations[0],
      basic: {
        netPnl: populatedPage.basic.netPnl,
        tradeWin: populatedPage.basic.tradeWin,
        profitFactor: populatedPage.basic.profitFactor,
        dayWinRate: populatedPage.basic.dayWinRate,
        averageWinLoss: populatedPage.basic.averageWinLoss,
      },
      system: {
        count: populatedPage.system.sampleCount,
        outcomes: populatedPage.system.outcomeCounts,
        totalR: metricValue(populatedPage.system.totalR),
        winRate: metricValue(populatedPage.system.winRate),
        averageR: metricValue(populatedPage.system.averageR),
        expectancyR: metricValue(populatedPage.system.expectancyR),
        profitFactor: metricValue(populatedPage.system.profitFactor),
        maximumDrawdownR: metricValue(populatedPage.system.maximumDrawdownR),
      },
      trader: {
        count: populatedPage.trader.sampleCount,
        outcomes: populatedPage.trader.outcomeCounts,
        totalR: metricValue(populatedPage.trader.totalR),
        winRate: metricValue(populatedPage.trader.winRate),
        averageR: metricValue(populatedPage.trader.averageR),
        expectancyR: metricValue(populatedPage.trader.expectancyR),
        profitFactor: metricValue(populatedPage.trader.profitFactor),
        maximumDrawdownR: metricValue(populatedPage.trader.maximumDrawdownR),
      },
      comparison: populatedPage.comparison,
      gapScenarios: recentGapCounts,
      attention: { fixtureAccount: fixtureAttentionRows[0], workspaceDashboard: attentionRows[0] },
      moneyCompleteness: {
        eligibleActualCount: populatedPage.coverage.traderTradeCount,
        authoritativeMoneyCount: populatedPage.coverage.monetaryResultCount,
        state: populatedPage.basic.netPnl,
        currency: 'USD',
      },
      recentTrades: populatedPage.recentTrades.items,
      idempotency: {
        strategy:
          'transactionally hard-delete/rebuild Trades only under the two exact visual fixture Accounts; child rows cascade; Accounts upsert by deterministic identity/exact marker',
        unrelatedAccountFingerprintUnchanged: unrelatedBefore === unrelatedAfter,
        deterministicIdentityDigest,
        deterministicIdentityCounts,
        namespace:
          'visual-dashboard v2 -> owner/workspace -> Account -> Trade -> child type -> stable child identity',
      },
      migrationIntegrity: {
        unchanged: migrationBefore === migrationAfter,
        latest: JSON.parse(migrationAfter),
      },
    };
    console.log(safeJson(report));
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Visual fixture seed failed.');
  process.exitCode = 1;
});
