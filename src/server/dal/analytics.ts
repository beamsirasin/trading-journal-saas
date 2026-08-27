import 'server-only';

import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  parseAnalyticsFilters,
  resolveAnalyticsDateBounds,
  type AnalyticsDateBounds,
  type AnalyticsFilterInput,
  type AnalyticsFilters,
} from '@/lib/analytics/filters';
import type {
  CalendarActualRecord,
  CalendarPairedRecord,
  CalendarSystemRecord,
} from '@/lib/dashboard/calendar';
import type { DayReviewRecord } from '@/lib/dashboard/day-review';
import type {
  DashboardAccountContext,
  DashboardRecentTradeRecord,
} from '@/lib/dashboard/page-data';
import type { SetupConditionCheckStatus } from '@/lib/setup-conditions/snapshots';
import { systemClock } from '@/lib/time';
import type {
  OutcomeValue,
  RuleCheckStatus,
  SystemStatus,
  TradeDirection,
  TradeStatus,
} from '@/lib/trades/constants';
import type { AccountMode } from '@/lib/trading-accounts/constants';
import {
  getActiveTradingAccountForResolvedContext,
  getActiveWorkspaceContext,
  getUserPreferencesForResolvedUser,
} from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import {
  emotionTypes,
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
} from '@/server/db/schema';

import { entryContextAnalyticsEligible } from './trade-recording-model';
import {
  occurredAtExpr,
  selectWorkspaceTradeAttentionCounts,
  type TradeAttentionCounts,
} from './trades';

export type AnalyticsFilterErrorCode =
  'invalid_filters' | 'invalid_timezone' | 'no_active_trading_account';

export type AnalyticsReadResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: AnalyticsFilterErrorCode };

export type ResolvedAnalyticsAccountScope =
  | { readonly kind: 'all' }
  | {
      readonly kind: 'account';
      readonly accountId: string;
      readonly source: 'active' | 'explicit';
    };

export interface ResolvedAnalyticsFilters {
  readonly datePreset: AnalyticsFilters['datePreset'];
  readonly dateBounds: AnalyticsDateBounds;
  readonly timezone: string;
  readonly accountScope: ResolvedAnalyticsAccountScope;
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

interface AnalyticsQueryContext {
  readonly workspaceId: string;
  readonly filters: ResolvedAnalyticsFilters;
  readonly account: DashboardAccountContext;
}

export interface AnalyticsReadOptions {
  /** Trusted server/test clock injection; never accepted from a query string. */
  readonly referenceInstant?: Date;
}

/**
 * Authenticated normalization boundary for every analytics projection. It
 * resolves the active account and persisted user timezone server-side, then
 * verifies every explicit identity and dependency inside the active
 * workspace. Invalid and foreign IDs share the same closed result.
 */
async function resolveAnalyticsQueryContext(
  input: unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<AnalyticsQueryContext>> {
  const parsed = parseAnalyticsFilters(input);
  if (!parsed.ok) return parsed;

  const { userId, workspaceId } = await getActiveWorkspaceContext();
  const preferences = await getUserPreferencesForResolvedUser(userId);
  const db = getDb();
  const filters = parsed.filters;

  let accountScope: ResolvedAnalyticsAccountScope;
  let account: DashboardAccountContext;
  if (filters.accountScope.kind === 'all') {
    accountScope = { kind: 'all' };
    account = { kind: 'all' };
  } else if (filters.accountScope.kind === 'active') {
    const active = await getActiveTradingAccountForResolvedContext(userId, workspaceId);
    if (active === null) return { ok: false, code: 'no_active_trading_account' };
    accountScope = { kind: 'account', accountId: active.id, source: 'active' };
    account = { kind: 'account', source: 'active', account: active };
  } else {
    const accountRow = await db.query.tradingAccounts.findFirst({
      columns: {
        id: true,
        name: true,
        accountMode: true,
        baseCurrency: true,
        startingBalance: true,
      },
      where: and(
        eq(tradingAccounts.id, filters.accountScope.accountId),
        eq(tradingAccounts.workspaceId, workspaceId),
      ),
    });
    if (accountRow === undefined) return { ok: false, code: 'invalid_filters' };
    accountScope = { kind: 'account', accountId: accountRow.id, source: 'explicit' };
    account = {
      kind: 'account',
      source: 'explicit',
      account: {
        id: accountRow.id,
        name: accountRow.name,
        accountMode: accountRow.accountMode as AccountMode,
        baseCurrency: accountRow.baseCurrency,
        startingBalance: accountRow.startingBalance,
      },
    };
  }

  const [strategy, setup, version] = await Promise.all([
    filters.strategyId === null
      ? null
      : db.query.strategies.findFirst({
          columns: { id: true },
          where: and(
            eq(strategies.id, filters.strategyId),
            eq(strategies.workspaceId, workspaceId),
          ),
        }),
    filters.setupId === null
      ? null
      : db.query.setups.findFirst({
          columns: { id: true, strategyId: true },
          where: and(eq(setups.id, filters.setupId), eq(setups.workspaceId, workspaceId)),
        }),
    filters.strategyVersionId === null
      ? null
      : db.query.strategyVersions.findFirst({
          columns: { id: true, strategyId: true },
          where: and(
            eq(strategyVersions.id, filters.strategyVersionId),
            eq(strategyVersions.workspaceId, workspaceId),
          ),
        }),
  ]);

  if (
    (filters.strategyId !== null && strategy === undefined) ||
    (filters.setupId !== null && setup === undefined) ||
    (filters.strategyVersionId !== null && version === undefined) ||
    (filters.strategyId !== null && setup !== null && setup?.strategyId !== filters.strategyId) ||
    (filters.strategyId !== null &&
      version !== null &&
      version?.strategyId !== filters.strategyId) ||
    (setup !== null && version !== null && setup?.strategyId !== version?.strategyId)
  ) {
    return { ok: false, code: 'invalid_filters' };
  }

  const dateResult = resolveAnalyticsDateBounds(
    filters.datePreset,
    preferences.timezone,
    options.referenceInstant ?? systemClock.now(),
  );
  if (!dateResult.ok) return { ok: false, code: 'invalid_timezone' };

  return {
    ok: true,
    data: {
      workspaceId,
      account,
      filters: {
        datePreset: filters.datePreset,
        dateBounds: dateResult.bounds,
        timezone: preferences.timezone,
        accountScope,
        strategyId: filters.strategyId,
        setupId: filters.setupId,
        strategyVersionId: filters.strategyVersionId,
      },
    },
  };
}

export async function normalizeAnalyticsFilters(
  input: unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<ResolvedAnalyticsFilters>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  return context.ok ? { ok: true, data: context.data.filters } : context;
}

function frameworkConditions(context: AnalyticsQueryContext): SQL[] {
  const conditions: SQL[] = [eq(trades.workspaceId, context.workspaceId)];
  const { filters } = context;
  if (filters.accountScope.kind === 'account') {
    conditions.push(eq(trades.tradingAccountId, filters.accountScope.accountId));
  }
  if (filters.strategyId !== null) conditions.push(eq(trades.strategyId, filters.strategyId));
  if (filters.setupId !== null) conditions.push(eq(trades.setupId, filters.setupId));
  if (filters.strategyVersionId !== null) {
    conditions.push(eq(trades.strategyVersionId, filters.strategyVersionId));
  }
  return conditions;
}

function dateConditions(
  column: typeof trades.exitedAt | typeof trades.systemExitedAt,
  bounds: AnalyticsDateBounds,
): SQL[] {
  if (bounds.kind === 'all') return [];
  return [gte(column, new Date(bounds.start)), lt(column, new Date(bounds.endExclusive))];
}

export interface AnalyticsAccountOption {
  readonly tradingAccountId: string;
  readonly name: string;
  readonly isArchived: boolean;
}

export interface AnalyticsStrategyOption {
  readonly strategyId: string;
  readonly label: string;
  readonly isArchived: boolean;
}

export interface AnalyticsSetupOption {
  readonly setupId: string;
  readonly strategyId: string;
  readonly label: string;
  readonly isArchived: boolean;
}

export interface AnalyticsStrategyVersionOption {
  readonly strategyVersionId: string;
  readonly strategyId: string;
  readonly versionNumber: number;
  readonly strategyName: string;
}

export interface AnalyticsFilterOptions {
  readonly accounts: readonly AnalyticsAccountOption[];
  readonly strategies: readonly AnalyticsStrategyOption[];
  readonly setups: readonly AnalyticsSetupOption[];
  readonly strategyVersions: readonly AnalyticsStrategyVersionOption[];
}

/**
 * Historical selector labels are presentation hints, not historical truth:
 * use the current snapshot where it exists, otherwise the newest pinned
 * snapshot among nondeleted Trades. Every option is still keyed and filtered
 * by immutable identity. Existing Trade list/detail labels remain pinned per
 * Trade and do not use this policy.
 */
export async function getAnalyticsFilterOptions(): Promise<AnalyticsFilterOptions> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const db = getDb();
  const currentStrategyVersion = alias(strategyVersions, 'analytics_current_strategy_version');
  const pinnedStrategyVersion = alias(strategyVersions, 'analytics_pinned_strategy_version');
  const currentSetupSnapshot = alias(strategySetupVersions, 'analytics_current_setup_snapshot');
  const pinnedSetupSnapshot = alias(strategySetupVersions, 'analytics_pinned_setup_snapshot');

  const [accountRows, strategyRows, setupRows, versionRows] = await Promise.all([
    db
      .selectDistinctOn([trades.tradingAccountId], {
        tradingAccountId: tradingAccounts.id,
        name: tradingAccounts.name,
        isArchived: tradingAccounts.isArchived,
      })
      .from(trades)
      .innerJoin(tradingAccounts, eq(tradingAccounts.id, trades.tradingAccountId))
      .where(and(eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)))
      .orderBy(trades.tradingAccountId),
    db
      .selectDistinctOn([trades.strategyId], {
        strategyId: strategies.id,
        currentLabel: currentStrategyVersion.name,
        pinnedLabel: pinnedStrategyVersion.name,
        isArchived: strategies.isArchived,
      })
      .from(trades)
      .innerJoin(strategies, eq(strategies.id, trades.strategyId))
      .innerJoin(pinnedStrategyVersion, eq(pinnedStrategyVersion.id, trades.strategyVersionId))
      .leftJoin(currentStrategyVersion, eq(currentStrategyVersion.id, strategies.currentVersionId))
      .where(and(eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)))
      .orderBy(trades.strategyId, desc(pinnedStrategyVersion.versionNumber)),
    db
      .selectDistinctOn([trades.setupId], {
        setupId: setups.id,
        strategyId: setups.strategyId,
        currentLabel: currentSetupSnapshot.name,
        pinnedLabel: pinnedSetupSnapshot.name,
        isArchived: setups.isArchived,
      })
      .from(trades)
      .innerJoin(setups, eq(setups.id, trades.setupId))
      .innerJoin(strategies, eq(strategies.id, trades.strategyId))
      .innerJoin(pinnedSetupSnapshot, eq(pinnedSetupSnapshot.id, trades.setupVersionId))
      .innerJoin(pinnedStrategyVersion, eq(pinnedStrategyVersion.id, trades.strategyVersionId))
      .leftJoin(
        currentSetupSnapshot,
        and(
          eq(currentSetupSnapshot.setupId, setups.id),
          eq(currentSetupSnapshot.strategyVersionId, strategies.currentVersionId),
        ),
      )
      .where(and(eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)))
      .orderBy(trades.setupId, desc(pinnedStrategyVersion.versionNumber)),
    db
      .selectDistinctOn([trades.strategyVersionId], {
        strategyVersionId: pinnedStrategyVersion.id,
        strategyId: pinnedStrategyVersion.strategyId,
        versionNumber: pinnedStrategyVersion.versionNumber,
        strategyName: pinnedStrategyVersion.name,
      })
      .from(trades)
      .innerJoin(pinnedStrategyVersion, eq(pinnedStrategyVersion.id, trades.strategyVersionId))
      .where(and(eq(trades.workspaceId, workspaceId), isNull(trades.deletedAt)))
      .orderBy(trades.strategyVersionId),
  ]);

  return {
    accounts: accountRows.sort((a, b) => a.name.localeCompare(b.name)),
    strategies: strategyRows
      .map((row) => ({
        strategyId: row.strategyId,
        label: row.currentLabel ?? row.pinnedLabel,
        isArchived: row.isArchived,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    setups: setupRows
      .map((row) => ({
        setupId: row.setupId,
        strategyId: row.strategyId,
        label: row.currentLabel ?? row.pinnedLabel,
        isArchived: row.isArchived,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    strategyVersions: versionRows.sort(
      (a, b) => a.strategyName.localeCompare(b.strategyName) || a.versionNumber - b.versionNumber,
    ),
  };
}

export interface TraderAnalyticsRecord {
  readonly tradeId: string;
  readonly status: TradeStatus;
  readonly deletedAt: null;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
  readonly exitedAt: string;
  readonly tradingAccountId: string;
  /** Authoritative Actual money result; null is legitimate for Price-mode Trades. */
  readonly netPnlMinor: string | null;
  readonly baseCurrency: string;
  /** Phase 14B: `null` for an unclassified Trade — Trader eligibility never depends on classification (CLAUDE.md §1/§6). */
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly setupId: string | null;
  /**
   * Phase 15D — Context breakdowns (Symbol/Direction/Session/Timeframe).
   * Added to this ALREADY-fetched, already-eligible query rather than a new
   * one (brief §42/§43: reuse the canonical Trader-eligible read, avoid a
   * second query for the same population). `symbol`/`direction` are always
   * present (`NOT NULL` core Trade fields); `session`/`timeframe` are the
   * existing optional Plan fields and may be `null` — Trader-only, per the
   * Phase 15 doc's documented decision to defer System-side context.
   */
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly session: string | null;
  readonly timeframe: string | null;
}

async function selectTraderAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly TraderAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      status: trades.status,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
      exitedAt: trades.exitedAt,
      tradingAccountId: trades.tradingAccountId,
      netPnlMinor: trades.netPnlMinor,
      baseCurrency: tradingAccounts.baseCurrency,
      strategyId: trades.strategyId,
      strategyVersionId: trades.strategyVersionId,
      setupId: trades.setupId,
      symbol: trades.symbol,
      direction: trades.direction,
      session: trades.session,
      timeframe: trades.timeframe,
    })
    .from(trades)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, trades.tradingAccountId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    status: row.status as TradeStatus,
    deletedAt: null,
    actualR: row.actualR as string,
    traderOutcome: row.traderOutcome as OutcomeValue,
    exitedAt: (row.exitedAt as Date).toISOString(),
    netPnlMinor: row.netPnlMinor?.toString() ?? null,
    direction: row.direction as TradeDirection,
  }));
}

export async function getTraderAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly TraderAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectTraderAnalyticsRecords(context.data) };
}

export interface SystemAnalyticsRecord {
  readonly tradeId: string;
  readonly systemStatus: SystemStatus;
  readonly deletedAt: null;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
  readonly systemExitedAt: string;
  readonly tradingAccountId: string;
  /** Phase 14B: `null` for an unclassified Trade — System eligibility never depends on classification. */
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly setupId: string | null;
}

async function selectSystemAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly SystemAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      systemStatus: trades.systemStatus,
      systemR: trades.systemR,
      systemOutcome: trades.systemOutcome,
      systemExitedAt: trades.systemExitedAt,
      tradingAccountId: trades.tradingAccountId,
      strategyId: trades.strategyId,
      strategyVersionId: trades.strategyVersionId,
      setupId: trades.setupId,
    })
    .from(trades)
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        ...dateConditions(trades.systemExitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.systemExitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    systemStatus: row.systemStatus as SystemStatus,
    deletedAt: null,
    systemR: row.systemR as string,
    systemOutcome: row.systemOutcome as OutcomeValue,
    systemExitedAt: (row.systemExitedAt as Date).toISOString(),
  }));
}

export async function getSystemAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly SystemAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectSystemAnalyticsRecords(context.data) };
}

/**
 * A compact "how many System outcomes are still pending" disclosure (Phase
 * 14C §19) — never a member of `SystemAnalyticsRecord`/the eligible
 * population itself (pending Trades stay structurally excluded from every
 * System formula, unchanged). Deliberately account/framework-scoped like
 * every other analytics query, but NEVER date-bounded: a pending Trade has
 * no `system_exited_at` to bucket by (CLAUDE.md §7, Phase 13 §15's "no
 * generic date axis"), so this count answers "how many, right now, within
 * this Account/Strategy/Setup scope" — not "how many within this date
 * range," and must never be presented as if it were.
 */
async function selectSystemPendingCount(context: AnalyticsQueryContext): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trades)
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'pending'),
      ),
    );
  return row?.count ?? 0;
}

export async function getSystemPendingCount(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<number>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectSystemPendingCount(context.data) };
}

export interface PairedAnalyticsRecord {
  readonly tradeId: string;
  readonly status: 'closed';
  readonly deletedAt: null;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
  readonly systemR: string;
  readonly systemStatus: 'resolved';
  readonly systemOutcome: OutcomeValue;
  readonly actualExitedAt: string;
  /** Metadata only: bounded Population-C filtering is anchored exclusively to `actualExitedAt`. */
  readonly systemExitedAt: string;
  readonly tradingAccountId: string;
  /** Phase 14B: `null` for an unclassified Trade — pairing/Execution Gap never depends on classification. */
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly setupId: string | null;
}

async function selectPairedAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly PairedAnalyticsRecord[]> {
  const db = getDb();
  const conditions = [
    ...frameworkConditions(context),
    isNull(trades.deletedAt),
    eq(trades.status, 'closed'),
    isNotNull(trades.actualR),
    isNotNull(trades.traderOutcome),
    isNotNull(trades.exitedAt),
    eq(trades.systemStatus, 'resolved'),
    isNotNull(trades.systemR),
    isNotNull(trades.systemOutcome),
    isNotNull(trades.systemExitedAt),
  ];
  // Population C is an execution-diagnosis population. A bounded range is
  // therefore anchored to when the Trader's Actual execution completed.
  // `system_exited_at` remains required for System-axis completeness and is
  // returned as metadata, but it is deliberately NOT a second range gate.
  conditions.push(...dateConditions(trades.exitedAt, context.filters.dateBounds));

  const rows = await db
    .select({
      tradeId: trades.id,
      status: trades.status,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
      systemStatus: trades.systemStatus,
      systemR: trades.systemR,
      systemOutcome: trades.systemOutcome,
      actualExitedAt: trades.exitedAt,
      systemExitedAt: trades.systemExitedAt,
      tradingAccountId: trades.tradingAccountId,
      strategyId: trades.strategyId,
      strategyVersionId: trades.strategyVersionId,
      setupId: trades.setupId,
    })
    .from(trades)
    .where(and(...conditions))
    .orderBy(asc(trades.exitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    status: 'closed' as const,
    deletedAt: null,
    actualR: row.actualR as string,
    traderOutcome: row.traderOutcome as OutcomeValue,
    systemStatus: 'resolved' as const,
    systemR: row.systemR as string,
    systemOutcome: row.systemOutcome as OutcomeValue,
    actualExitedAt: (row.actualExitedAt as Date).toISOString(),
    systemExitedAt: (row.systemExitedAt as Date).toISOString(),
  }));
}

export async function getPairedAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly PairedAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectPairedAnalyticsRecords(context.data) };
}

/**
 * D2 Recent Trades is a narrow Dashboard projection, not the rich Journal
 * list. It follows Dashboard account/framework filters and a documented
 * lifecycle `occurred_at` range so unresolved Trades remain representable.
 */
async function selectDashboardRecentTrades(
  context: AnalyticsQueryContext,
): Promise<readonly DashboardRecentTradeRecord[]> {
  const db = getDb();
  const conditions = [...frameworkConditions(context), isNull(trades.deletedAt)];
  if (context.filters.dateBounds.kind === 'bounded') {
    conditions.push(
      sql`${occurredAtExpr} >= ${context.filters.dateBounds.start}::timestamptz`,
      sql`${occurredAtExpr} < ${context.filters.dateBounds.endExclusive}::timestamptz`,
    );
  }

  const rows = await db
    .select({
      tradeId: trades.id,
      occurredAt: occurredAtExpr,
      symbol: trades.symbol,
      direction: trades.direction,
      tradingAccountName: tradingAccounts.name,
      status: trades.status,
      traderOutcome: trades.traderOutcome,
      actualR: trades.actualR,
      actualExitedAt: trades.exitedAt,
      systemStatus: trades.systemStatus,
      systemOutcome: trades.systemOutcome,
      systemR: trades.systemR,
      systemExitedAt: trades.systemExitedAt,
      strategyName: strategyVersions.name,
      setupName: strategySetupVersions.name,
    })
    .from(trades)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, trades.tradingAccountId))
    .leftJoin(strategyVersions, eq(strategyVersions.id, trades.strategyVersionId))
    .leftJoin(strategySetupVersions, eq(strategySetupVersions.id, trades.setupVersionId))
    .where(and(...conditions))
    .orderBy(desc(occurredAtExpr), desc(trades.id))
    .limit(5);

  return rows.map((row) => ({
    ...row,
    occurredAt: new Date(row.occurredAt).toISOString(),
    direction: row.direction as TradeDirection,
    status: row.status as TradeStatus,
    traderOutcome: row.traderOutcome as OutcomeValue | null,
    actualExitedAt: row.actualExitedAt?.toISOString() ?? null,
    systemStatus: row.systemStatus as SystemStatus,
    systemOutcome: row.systemOutcome as OutcomeValue | null,
    systemExitedAt: row.systemExitedAt?.toISOString() ?? null,
  }));
}

export interface RuleAnalyticsRecord {
  readonly tradeId: string;
  readonly ruleKey: string;
  readonly checkStatus: RuleCheckStatus;
  readonly category: string;
  readonly isRequired: boolean;
  readonly isPreTradeCheck: boolean;
  readonly scope: 'strategy' | 'setup';
  readonly tradingAccountId: string;
  /**
   * `strategyId`/`strategyVersionId` are structurally guaranteed non-null in
   * practice — `trade_rule_checks` can only exist via the composite FK into
   * `trades(id, strategy_version_id)` — but typed nullable here for
   * consistency with every other analytics record and because nothing
   * downstream in `src/lib/analytics/` reads these fields. `setupId` CAN be
   * genuinely null (a Strategy-level Rule check on a Trade with no Setup).
   */
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly setupId: string | null;
  readonly exitedAt: string;
}

async function selectRuleAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly RuleAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: tradeRuleChecks.tradeId,
      ruleKey: tradeRuleChecks.ruleKey,
      checkStatus: tradeRuleChecks.checkStatus,
      category: tradeRuleChecks.category,
      isRequired: tradeRuleChecks.isRequired,
      isPreTradeCheck: tradeRuleChecks.isPreTradeCheck,
      setupVersionId: strategyRules.setupVersionId,
      tradingAccountId: trades.tradingAccountId,
      strategyId: trades.strategyId,
      strategyVersionId: trades.strategyVersionId,
      setupId: trades.setupId,
      exitedAt: trades.exitedAt,
    })
    .from(tradeRuleChecks)
    .innerJoin(trades, eq(trades.id, tradeRuleChecks.tradeId))
    .innerJoin(strategyRules, eq(strategyRules.id, tradeRuleChecks.strategyRuleId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.exitedAt),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id), asc(tradeRuleChecks.sortOrder));

  return rows.map(({ setupVersionId, ...row }) => ({
    ...row,
    checkStatus: row.checkStatus as RuleCheckStatus,
    scope: setupVersionId === null ? 'strategy' : 'setup',
    exitedAt: (row.exitedAt as Date).toISOString(),
  }));
}

export async function getRuleAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly RuleAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectRuleAnalyticsRecords(context.data) };
}

export interface MistakeAnalyticsRecord {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
  readonly tradingAccountId: string;
  /** Phase 14B: `null` for an unclassified Trade — `trade_mistakes` has no dependency on Strategy/Setup classification at all. */
  readonly strategyId: string | null;
  readonly strategyVersionId: string | null;
  readonly setupId: string | null;
  readonly exitedAt: string;
}

async function selectMistakeAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly MistakeAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: tradeMistakes.tradeId,
      mistakeTypeId: tradeMistakes.mistakeTypeId,
      key: mistakeTypes.key,
      label: mistakeTypes.label,
      tradingAccountId: trades.tradingAccountId,
      strategyId: trades.strategyId,
      strategyVersionId: trades.strategyVersionId,
      setupId: trades.setupId,
      exitedAt: trades.exitedAt,
    })
    .from(tradeMistakes)
    .innerJoin(trades, eq(trades.id, tradeMistakes.tradeId))
    .innerJoin(mistakeTypes, eq(mistakeTypes.id, tradeMistakes.mistakeTypeId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.exitedAt),
        eq(mistakeTypes.isSystem, true),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id), asc(mistakeTypes.sortOrder));

  return rows.map((row) => ({ ...row, exitedAt: (row.exitedAt as Date).toISOString() }));
}

export async function getMistakeAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly MistakeAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectMistakeAnalyticsRecords(context.data) };
}

// ---------------------------------------------------------------------------
// Phase 13H — Journal V2 analytics (Setup Adherence, Condition, Confidence,
// Emotion). Each dimension is fetched TWICE — once against Trader eligibility
// (closed, nondeleted, `actual_r`/`trader_outcome`/`exited_at` all present,
// dated by `exited_at`) and once against System eligibility (`system_status
// = 'resolved'`, nondeleted, `system_r`/`system_outcome`/`system_exited_at`
// all present, dated by `system_exited_at`) — mirroring exactly how
// `selectTraderAnalyticsRecords`/`selectSystemAnalyticsRecords` are two
// independent queries, never one shared predicate. A Trade can appear in
// neither, either, or both result sets: a still-open Trade with a resolved
// System side appears only in the System-side rows; a closed Trade with a
// still-pending System side appears only in the Trader-side rows. Nothing
// here ever intersects the two populations — that intersection exists only
// for the paired Execution Gap (`selectPairedAnalyticsRecords`, unrelated to
// this section).
// ---------------------------------------------------------------------------

export interface SetupAdherenceAnalyticsRecord {
  readonly tradeId: string;
  readonly metCount: number;
  readonly totalCount: number;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
}

/**
 * One row per Trade that has its own recorded, applicable Setup Condition
 * snapshot (inner join — a Trade with zero `trade_setup_condition_checks`
 * rows, "not recorded" or "not configured", is structurally excluded, never
 * coerced to `totalCount: 0`).
 */
async function selectSetupAdherenceAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly SetupAdherenceAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
      metCount: sql<number>`count(*) filter (where ${tradeSetupConditionChecks.checkStatus} = 'met')::int`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(trades)
    .innerJoin(tradeSetupConditionChecks, eq(tradeSetupConditionChecks.tradeId, trades.id))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .groupBy(trades.id)
    .orderBy(asc(trades.exitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    actualR: row.actualR as string,
    traderOutcome: row.traderOutcome as OutcomeValue,
  }));
}

export async function getSetupAdherenceAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly SetupAdherenceAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectSetupAdherenceAnalyticsRecords(context.data) };
}

export interface SetupAdherenceSystemAnalyticsRecord {
  readonly tradeId: string;
  readonly metCount: number;
  readonly totalCount: number;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
}

/** System-eligible mirror of {@link selectSetupAdherenceAnalyticsRecords} — independent population, independent `system_exited_at` date axis. */
async function selectSetupAdherenceSystemAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly SetupAdherenceSystemAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      systemR: trades.systemR,
      systemOutcome: trades.systemOutcome,
      metCount: sql<number>`count(*) filter (where ${tradeSetupConditionChecks.checkStatus} = 'met')::int`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(trades)
    .innerJoin(tradeSetupConditionChecks, eq(tradeSetupConditionChecks.tradeId, trades.id))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.systemExitedAt, context.filters.dateBounds),
      ),
    )
    .groupBy(trades.id)
    .orderBy(asc(trades.systemExitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    systemR: row.systemR as string,
    systemOutcome: row.systemOutcome as OutcomeValue,
  }));
}

export async function getSetupAdherenceSystemAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly SetupAdherenceSystemAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectSetupAdherenceSystemAnalyticsRecords(context.data) };
}

export interface ConditionAnalyticsRecord {
  readonly tradeId: string;
  readonly setupId: string;
  readonly conditionKey: string;
  readonly label: string;
  readonly checkStatus: SetupConditionCheckStatus;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
  readonly exitedAt: string;
}

/**
 * One row per (Trade, Condition) snapshot — a multi-Condition Trade
 * naturally produces multiple rows, exactly like `getRuleAnalyticsRecords`.
 * Grouping identity is `setupId + conditionKey` (§11) — `setupId` is the
 * stable `setups.id` FK on the Trade, never a Setup Version id, so the same
 * logical Condition groups correctly across Setup Version copy-on-write.
 */
async function selectConditionAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly ConditionAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: tradeSetupConditionChecks.tradeId,
      // Structurally guaranteed non-null: a `trade_setup_condition_checks`
      // row can only exist via the composite FK into `trades(id,
      // setup_version_id)`, which requires a non-null `setup_id` (Phase 14B
      // pairing check). `sql<string>` preserves that guarantee's TYPE here
      // even though the underlying `trades.setup_id` column is nullable
      // since Phase 14B — never a runtime cast, purely a type narrowing this
      // join already proves.
      setupId: sql<string>`${trades.setupId}`,
      conditionKey: tradeSetupConditionChecks.conditionKey,
      label: tradeSetupConditionChecks.label,
      checkStatus: tradeSetupConditionChecks.checkStatus,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
      exitedAt: trades.exitedAt,
    })
    .from(tradeSetupConditionChecks)
    .innerJoin(trades, eq(trades.id, tradeSetupConditionChecks.tradeId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    checkStatus: row.checkStatus as SetupConditionCheckStatus,
    actualR: row.actualR as string,
    traderOutcome: row.traderOutcome as OutcomeValue,
    exitedAt: (row.exitedAt as Date).toISOString(),
  }));
}

export async function getConditionAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly ConditionAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectConditionAnalyticsRecords(context.data) };
}

export interface ConditionSystemAnalyticsRecord {
  readonly tradeId: string;
  readonly setupId: string;
  readonly conditionKey: string;
  readonly label: string;
  readonly checkStatus: SetupConditionCheckStatus;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
  readonly systemExitedAt: string;
}

/**
 * System-eligible mirror of {@link selectConditionAnalyticsRecords}. Does
 * NOT require the same Trade to also have an Actual result — a still-open
 * Trade with a resolved System side contributes here even though it is
 * absent from the Trader-side rows.
 */
async function selectConditionSystemAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly ConditionSystemAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: tradeSetupConditionChecks.tradeId,
      // See the identical comment in `selectConditionAnalyticsRecords`.
      setupId: sql<string>`${trades.setupId}`,
      conditionKey: tradeSetupConditionChecks.conditionKey,
      label: tradeSetupConditionChecks.label,
      checkStatus: tradeSetupConditionChecks.checkStatus,
      systemR: trades.systemR,
      systemOutcome: trades.systemOutcome,
      systemExitedAt: trades.systemExitedAt,
    })
    .from(tradeSetupConditionChecks)
    .innerJoin(trades, eq(trades.id, tradeSetupConditionChecks.tradeId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.systemExitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.systemExitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    checkStatus: row.checkStatus as SetupConditionCheckStatus,
    systemR: row.systemR as string,
    systemOutcome: row.systemOutcome as OutcomeValue,
    systemExitedAt: (row.systemExitedAt as Date).toISOString(),
  }));
}

export async function getConditionSystemAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly ConditionSystemAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectConditionSystemAnalyticsRecords(context.data) };
}

export interface ConfidenceAnalyticsRecord {
  readonly tradeId: string;
  readonly confidence: number;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
}

/** Only Trades where Confidence was explicitly recorded (`IS NOT NULL`) — `0` is a real recorded value, never conflated with "not recorded". */
async function selectConfidenceAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly ConfidenceAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      confidence: trades.confidence,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
    })
    .from(trades)
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        isNotNull(trades.confidence),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    confidence: row.confidence as number,
    actualR: row.actualR as string,
    traderOutcome: row.traderOutcome as OutcomeValue,
  }));
}

export async function getConfidenceAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly ConfidenceAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectConfidenceAnalyticsRecords(context.data) };
}

export interface ConfidenceSystemAnalyticsRecord {
  readonly tradeId: string;
  readonly confidence: number;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
}

/** System-eligible mirror of {@link selectConfidenceAnalyticsRecords} — independent population, independent `system_exited_at` date axis. */
async function selectConfidenceSystemAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly ConfidenceSystemAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      confidence: trades.confidence,
      systemR: trades.systemR,
      systemOutcome: trades.systemOutcome,
    })
    .from(trades)
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        isNotNull(trades.confidence),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.systemExitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.systemExitedAt), asc(trades.id));

  return rows.map((row) => ({
    ...row,
    confidence: row.confidence as number,
    systemR: row.systemR as string,
    systemOutcome: row.systemOutcome as OutcomeValue,
  }));
}

export async function getConfidenceSystemAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly ConfidenceSystemAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectConfidenceSystemAnalyticsRecords(context.data) };
}

export interface EmotionAnalyticsRecord {
  readonly tradeId: string;
  readonly key: string;
  readonly label: string;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
}

/**
 * One row per (Trade, Emotion) link — a multi-Emotion Trade naturally
 * produces multiple rows, so it belongs to every one of its Emotion groups
 * (§16). A Trade with `emotions_recorded_at IS NULL` (never recorded) or a
 * recorded-zero selection (zero links) is structurally absent from this
 * result — the inner join on `trade_emotions` excludes both, never
 * fabricating a "None" group.
 */
async function selectEmotionAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly EmotionAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: tradeEmotions.tradeId,
      key: emotionTypes.key,
      label: emotionTypes.label,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
    })
    .from(tradeEmotions)
    .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
    .innerJoin(trades, eq(trades.id, tradeEmotions.tradeId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.exitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id), asc(emotionTypes.sortOrder));

  return rows.map((row) => ({
    ...row,
    actualR: row.actualR as string,
    traderOutcome: row.traderOutcome as OutcomeValue,
  }));
}

export async function getEmotionAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly EmotionAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectEmotionAnalyticsRecords(context.data) };
}

export interface EmotionSystemAnalyticsRecord {
  readonly tradeId: string;
  readonly key: string;
  readonly label: string;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
}

/**
 * System-eligible mirror of {@link selectEmotionAnalyticsRecords}. Emotions
 * are captured at entry, independent of how either axis later resolves — a
 * still-open Trade whose System side is resolved still carries its recorded
 * Emotion links, so it contributes here even though it is absent from the
 * Trader-side rows.
 */
async function selectEmotionSystemAnalyticsRecords(
  context: AnalyticsQueryContext,
): Promise<readonly EmotionSystemAnalyticsRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      tradeId: tradeEmotions.tradeId,
      key: emotionTypes.key,
      label: emotionTypes.label,
      systemR: trades.systemR,
      systemOutcome: trades.systemOutcome,
    })
    .from(tradeEmotions)
    .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
    .innerJoin(trades, eq(trades.id, tradeEmotions.tradeId))
    .where(
      and(
        ...frameworkConditions(context),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        entryContextAnalyticsEligible(),
        ...dateConditions(trades.systemExitedAt, context.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.systemExitedAt), asc(trades.id), asc(emotionTypes.sortOrder));

  return rows.map((row) => ({
    ...row,
    systemR: row.systemR as string,
    systemOutcome: row.systemOutcome as OutcomeValue,
  }));
}

export async function getEmotionSystemAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly EmotionSystemAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  return { ok: true, data: await selectEmotionSystemAnalyticsRecords(context.data) };
}

export interface AnalyticsRawPopulations {
  readonly filters: ResolvedAnalyticsFilters;
  readonly trader: readonly TraderAnalyticsRecord[];
  readonly system: readonly SystemAnalyticsRecord[];
  /** Phase 14C §19 — account/framework-scoped, deliberately NOT date-bounded. See `selectSystemPendingCount`. */
  readonly systemPendingCount: number;
  readonly paired: readonly PairedAnalyticsRecord[];
  readonly rules: readonly RuleAnalyticsRecord[];
  readonly mistakes: readonly MistakeAnalyticsRecord[];
  readonly setupAdherence: readonly SetupAdherenceAnalyticsRecord[];
  readonly setupAdherenceSystem: readonly SetupAdherenceSystemAnalyticsRecord[];
  readonly conditions: readonly ConditionAnalyticsRecord[];
  readonly conditionsSystem: readonly ConditionSystemAnalyticsRecord[];
  readonly confidence: readonly ConfidenceAnalyticsRecord[];
  readonly confidenceSystem: readonly ConfidenceSystemAnalyticsRecord[];
  readonly emotions: readonly EmotionAnalyticsRecord[];
  readonly emotionsSystem: readonly EmotionSystemAnalyticsRecord[];
}

/**
 * Resolves authenticated scope once, then runs every independent fixed-
 * shape projection in parallel. Existing individual reads remain available
 * for focused callers and retain identical SQL semantics.
 */
export async function getAnalyticsRawPopulations(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<AnalyticsRawPopulations>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const [
    trader,
    system,
    systemPendingCount,
    paired,
    rules,
    mistakes,
    setupAdherence,
    setupAdherenceSystem,
    conditions,
    conditionsSystem,
    confidence,
    confidenceSystem,
    emotions,
    emotionsSystem,
  ] = await Promise.all([
    selectTraderAnalyticsRecords(context.data),
    selectSystemAnalyticsRecords(context.data),
    selectSystemPendingCount(context.data),
    selectPairedAnalyticsRecords(context.data),
    selectRuleAnalyticsRecords(context.data),
    selectMistakeAnalyticsRecords(context.data),
    selectSetupAdherenceAnalyticsRecords(context.data),
    selectSetupAdherenceSystemAnalyticsRecords(context.data),
    selectConditionAnalyticsRecords(context.data),
    selectConditionSystemAnalyticsRecords(context.data),
    selectConfidenceAnalyticsRecords(context.data),
    selectConfidenceSystemAnalyticsRecords(context.data),
    selectEmotionAnalyticsRecords(context.data),
    selectEmotionSystemAnalyticsRecords(context.data),
  ]);
  return {
    ok: true,
    data: {
      filters: context.data.filters,
      trader,
      system,
      systemPendingCount,
      paired,
      rules,
      mistakes,
      setupAdherence,
      setupAdherenceSystem,
      conditions,
      conditionsSystem,
      confidence,
      confidenceSystem,
      emotions,
      emotionsSystem,
    },
  };
}

export const DASHBOARD_MAJOR_PROJECTIONS = [
  'trader',
  'system',
  'paired',
  'attention',
  'recent_trades',
] as const;
export const DASHBOARD_MAJOR_PROJECTION_COUNT = DASHBOARD_MAJOR_PROJECTIONS.length;

export interface DashboardRawData {
  readonly filters: ResolvedAnalyticsFilters;
  readonly account: DashboardAccountContext;
  readonly trader: readonly TraderAnalyticsRecord[];
  readonly system: readonly SystemAnalyticsRecord[];
  readonly paired: readonly PairedAnalyticsRecord[];
  readonly attention: TradeAttentionCounts;
  readonly recentTrades: readonly DashboardRecentTradeRecord[];
}

/**
 * D2's single route-level Dashboard read boundary. Scope and authorization
 * resolve once, then exactly five major projections run in parallel. Deep
 * Analytics rule/mistake/setup/condition/confidence/emotion reads are absent.
 */
export async function getDashboardRawData(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<DashboardRawData>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const [trader, system, paired, attention, recentTrades] = await Promise.all([
    selectTraderAnalyticsRecords(context.data),
    selectSystemAnalyticsRecords(context.data),
    selectPairedAnalyticsRecords(context.data),
    selectWorkspaceTradeAttentionCounts(context.data.workspaceId),
    selectDashboardRecentTrades(context.data),
  ]);
  return {
    ok: true,
    data: {
      filters: context.data.filters,
      account: context.data.account,
      trader,
      system,
      paired,
      attention,
      recentTrades,
    },
  };
}

// ---------------------------------------------------------------------------
// D6A — Calendar and Day Review projections
// ---------------------------------------------------------------------------

/**
 * The Calendar lives inside the ANALYTICS boundary rather than beside it.
 *
 * Everything below reuses `resolveAnalyticsQueryContext`,
 * `frameworkConditions` and the frozen date axes unchanged, which is what
 * makes a Calendar month obey the same Account/Strategy/Setup/Version scope
 * and the same authorization as every other Dashboard figure. A separate
 * calendar DAL would have had to restate all of that, and the first time the
 * two restatements drifted the Calendar would quietly show Trades the KPI row
 * above it had excluded.
 *
 * The Phase 14D `trade-calendar.ts` reads stay exactly as they are: they serve
 * the Journal page's own workspace-wide calendar and are not Dashboard-scoped.
 */

/**
 * MONTH ∩ DASHBOARD RANGE, and the intersection is deliberate.
 *
 * A Calendar showing August in full while the Dashboard is scoped to the last
 * 30 days would put Trades on screen that every other number on the page has
 * excluded — the reader would add up the squares and fail to reach the KPI
 * total, with nothing on screen explaining why. So the month is intersected
 * with the active range, and a month entirely outside it is legitimately
 * empty rather than silently unfiltered.
 *
 * `null` means the two windows do not overlap at all.
 */
function intersectWithDateBounds(
  range: { readonly start: Date; readonly end: Date },
  bounds: AnalyticsDateBounds,
): { readonly start: Date; readonly end: Date } | null {
  if (bounds.kind === 'all') return range;
  const filterStart = new Date(bounds.start);
  const filterEnd = new Date(bounds.endExclusive);
  const start = range.start > filterStart ? range.start : filterStart;
  const end = range.end < filterEnd ? range.end : filterEnd;
  return start < end ? { start, end } : null;
}

export type CalendarProjectionMode = 'actual' | 'system' | 'gap';

export interface CalendarProjectionRecords {
  readonly mode: CalendarProjectionMode;
  /** The window actually queried after intersecting the month with the Dashboard range; `null` when they do not overlap. */
  readonly effectiveRange: { readonly start: string; readonly end: string } | null;
  readonly actual: readonly CalendarActualRecord[];
  readonly system: readonly CalendarSystemRecord[];
  readonly paired: readonly CalendarPairedRecord[];
}

export interface CalendarProjectionParams {
  readonly mode: CalendarProjectionMode;
  readonly monthRange: { readonly start: Date; readonly end: Date };
}

/**
 * ONE bounded read for the requested mode — never one per day, never one per
 * cell. A month's eligible rows are inherently few, so the day buckets are
 * composed in memory by `src/lib/dashboard/calendar.ts` with the same
 * decimal-safe primitives every other R aggregate uses, rather than by a raw
 * SQL `date_trunc` that would bucket on the server's day boundary instead of
 * the user's.
 *
 * Only the requested mode is fetched. Loading all three populations to render
 * one would triple the cost of a view that shows one at a time.
 */
export async function getCalendarMonthRecords(
  input: AnalyticsFilterInput | unknown,
  params: CalendarProjectionParams,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<CalendarProjectionRecords>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const db = getDb();
  const scope = frameworkConditions(context.data);
  const window = intersectWithDateBounds(params.monthRange, context.data.filters.dateBounds);

  const emptyResult: CalendarProjectionRecords = {
    mode: params.mode,
    effectiveRange: null,
    actual: [],
    system: [],
    paired: [],
  };
  if (window === null) return { ok: true, data: emptyResult };
  const effectiveRange = { start: window.start.toISOString(), end: window.end.toISOString() };

  if (params.mode === 'actual') {
    const rows = await db
      .select({
        tradeId: trades.id,
        exitedAt: trades.exitedAt,
        actualR: trades.actualR,
        traderOutcome: trades.traderOutcome,
      })
      .from(trades)
      .where(
        and(
          ...scope,
          isNull(trades.deletedAt),
          eq(trades.status, 'closed'),
          isNotNull(trades.actualR),
          isNotNull(trades.traderOutcome),
          gte(trades.exitedAt, window.start),
          lt(trades.exitedAt, window.end),
        ),
      );
    return {
      ok: true,
      data: {
        ...emptyResult,
        effectiveRange,
        actual: rows.map((row) => ({
          tradeId: row.tradeId,
          exitedAt: (row.exitedAt as Date).toISOString(),
          actualR: row.actualR as string,
          traderOutcome: row.traderOutcome as OutcomeValue,
        })),
      },
    };
  }

  if (params.mode === 'system') {
    const rows = await db
      .select({
        tradeId: trades.id,
        systemExitedAt: trades.systemExitedAt,
        systemR: trades.systemR,
        systemOutcome: trades.systemOutcome,
      })
      .from(trades)
      .where(
        and(
          ...scope,
          isNull(trades.deletedAt),
          eq(trades.systemStatus, 'resolved'),
          isNotNull(trades.systemR),
          isNotNull(trades.systemOutcome),
          gte(trades.systemExitedAt, window.start),
          lt(trades.systemExitedAt, window.end),
        ),
      );
    return {
      ok: true,
      data: {
        ...emptyResult,
        effectiveRange,
        system: rows.map((row) => ({
          tradeId: row.tradeId,
          systemExitedAt: (row.systemExitedAt as Date).toISOString(),
          systemR: row.systemR as string,
          systemOutcome: row.systemOutcome as OutcomeValue,
        })),
      },
    };
  }

  // Gap: Population C, anchored to Actual `exited_at` ONLY. `system_exited_at`
  // is required for System-side completeness and returned as context, but it
  // is never a second range gate — the same rule
  // `selectPairedAnalyticsRecords` already follows.
  const rows = await db
    .select({
      tradeId: trades.id,
      exitedAt: trades.exitedAt,
      systemExitedAt: trades.systemExitedAt,
      actualR: trades.actualR,
      systemR: trades.systemR,
    })
    .from(trades)
    .where(
      and(
        ...scope,
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        gte(trades.exitedAt, window.start),
        lt(trades.exitedAt, window.end),
      ),
    );
  return {
    ok: true,
    data: {
      ...emptyResult,
      effectiveRange,
      paired: rows.map((row) => ({
        tradeId: row.tradeId,
        exitedAt: (row.exitedAt as Date).toISOString(),
        systemExitedAt: (row.systemExitedAt as Date).toISOString(),
        actualR: row.actualR as string,
        systemR: row.systemR as string,
      })),
    },
  };
}

export interface DayReviewProjectionParams {
  readonly mode: CalendarProjectionMode;
  readonly dayRange: { readonly start: Date; readonly end: Date };
}

/**
 * ONE bounded read for a selected day's rows, on that mode's own axis and
 * inside the same Dashboard scope as the Calendar above it.
 *
 * Trade-level, never leg-level: a partially closed position is one row here
 * however many exits it has, because this selects Trades and joins no
 * `trade_exits` at all. Quick Preview is where legs belong, and it gets them
 * from the existing `getWorkspaceTradeDetail` rather than from a second copy
 * of that logic here.
 */
export async function getDayReviewRecords(
  input: AnalyticsFilterInput | unknown,
  params: DayReviewProjectionParams,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly DayReviewRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const db = getDb();
  const scope = frameworkConditions(context.data);
  const window = intersectWithDateBounds(params.dayRange, context.data.filters.dateBounds);
  if (window === null) return { ok: true, data: [] };

  const axisColumn = params.mode === 'system' ? trades.systemExitedAt : trades.exitedAt;
  const populationConditions =
    params.mode === 'system'
      ? [
          eq(trades.systemStatus, 'resolved'),
          isNotNull(trades.systemR),
          isNotNull(trades.systemOutcome),
        ]
      : params.mode === 'actual'
        ? [eq(trades.status, 'closed'), isNotNull(trades.actualR), isNotNull(trades.traderOutcome)]
        : [
            eq(trades.status, 'closed'),
            isNotNull(trades.actualR),
            isNotNull(trades.traderOutcome),
            eq(trades.systemStatus, 'resolved'),
            isNotNull(trades.systemR),
            isNotNull(trades.systemOutcome),
            isNotNull(trades.systemExitedAt),
          ];

  const rows = await db
    .select({
      tradeId: trades.id,
      occurredAt: occurredAtExpr,
      axisAt: axisColumn,
      symbol: trades.symbol,
      direction: trades.direction,
      tradingAccountName: tradingAccounts.name,
      status: trades.status,
      traderOutcome: trades.traderOutcome,
      actualR: trades.actualR,
      actualExitedAt: trades.exitedAt,
      systemStatus: trades.systemStatus,
      systemOutcome: trades.systemOutcome,
      systemR: trades.systemR,
      systemExitedAt: trades.systemExitedAt,
      strategyName: strategyVersions.name,
      setupName: strategySetupVersions.name,
    })
    .from(trades)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, trades.tradingAccountId))
    .leftJoin(strategyVersions, eq(strategyVersions.id, trades.strategyVersionId))
    .leftJoin(strategySetupVersions, eq(strategySetupVersions.id, trades.setupVersionId))
    .where(
      and(
        ...scope,
        isNull(trades.deletedAt),
        ...populationConditions,
        gte(axisColumn, window.start),
        lt(axisColumn, window.end),
      ),
    )
    .orderBy(asc(axisColumn), asc(trades.id));

  return {
    ok: true,
    data: rows.map((row) => ({
      tradeId: row.tradeId,
      occurredAt: new Date(row.occurredAt).toISOString(),
      axisAt: (row.axisAt as Date).toISOString(),
      symbol: row.symbol,
      direction: row.direction as TradeDirection,
      tradingAccountName: row.tradingAccountName,
      status: row.status as TradeStatus,
      traderOutcome: row.traderOutcome as OutcomeValue | null,
      actualR: row.actualR,
      actualExitedAt: row.actualExitedAt?.toISOString() ?? null,
      systemStatus: row.systemStatus as SystemStatus,
      systemOutcome: row.systemOutcome as OutcomeValue | null,
      systemR: row.systemR,
      systemExitedAt: row.systemExitedAt?.toISOString() ?? null,
      strategyName: row.strategyName,
      setupName: row.setupName,
    })),
  };
}
