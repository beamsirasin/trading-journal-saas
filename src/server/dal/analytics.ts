import 'server-only';

import { and, asc, desc, eq, gte, isNotNull, isNull, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  parseAnalyticsFilters,
  resolveAnalyticsDateBounds,
  type AnalyticsDateBounds,
  type AnalyticsFilterInput,
  type AnalyticsFilters,
} from '@/lib/analytics/filters';
import { systemClock } from '@/lib/time';
import type {
  OutcomeValue,
  RuleCheckStatus,
  SystemStatus,
  TradeStatus,
} from '@/lib/trades/constants';
import {
  getActiveTradingAccount,
  getActiveWorkspaceContext,
  getCurrentUserPreferences,
} from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import {
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradingAccounts,
} from '@/server/db/schema';

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
  readonly accountScope: ResolvedAnalyticsAccountScope;
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

interface AnalyticsQueryContext {
  readonly workspaceId: string;
  readonly filters: ResolvedAnalyticsFilters;
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

  const { workspaceId } = await getActiveWorkspaceContext();
  const preferences = await getCurrentUserPreferences();
  const db = getDb();
  const filters = parsed.filters;

  let accountScope: ResolvedAnalyticsAccountScope;
  if (filters.accountScope.kind === 'all') {
    accountScope = { kind: 'all' };
  } else if (filters.accountScope.kind === 'active') {
    const active = await getActiveTradingAccount();
    if (active === null) return { ok: false, code: 'no_active_trading_account' };
    accountScope = { kind: 'account', accountId: active.id, source: 'active' };
  } else {
    const account = await db.query.tradingAccounts.findFirst({
      columns: { id: true },
      where: and(
        eq(tradingAccounts.id, filters.accountScope.accountId),
        eq(tradingAccounts.workspaceId, workspaceId),
      ),
    });
    if (account === undefined) return { ok: false, code: 'invalid_filters' };
    accountScope = { kind: 'account', accountId: account.id, source: 'explicit' };
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
      filters: {
        datePreset: filters.datePreset,
        dateBounds: dateResult.bounds,
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
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly setupId: string;
}

export async function getTraderAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly TraderAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const db = getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      status: trades.status,
      actualR: trades.actualR,
      traderOutcome: trades.traderOutcome,
      exitedAt: trades.exitedAt,
      tradingAccountId: trades.tradingAccountId,
      strategyId: trades.strategyId,
      strategyVersionId: trades.strategyVersionId,
      setupId: trades.setupId,
    })
    .from(trades)
    .where(
      and(
        ...frameworkConditions(context.data),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.actualR),
        isNotNull(trades.traderOutcome),
        isNotNull(trades.exitedAt),
        ...dateConditions(trades.exitedAt, context.data.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id));

  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      status: row.status as TradeStatus,
      deletedAt: null,
      actualR: row.actualR as string,
      traderOutcome: row.traderOutcome as OutcomeValue,
      exitedAt: (row.exitedAt as Date).toISOString(),
    })),
  };
}

export interface SystemAnalyticsRecord {
  readonly tradeId: string;
  readonly systemStatus: SystemStatus;
  readonly deletedAt: null;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
  readonly systemExitedAt: string;
  readonly tradingAccountId: string;
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly setupId: string;
}

export async function getSystemAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly SystemAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
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
        ...frameworkConditions(context.data),
        isNull(trades.deletedAt),
        eq(trades.systemStatus, 'resolved'),
        isNotNull(trades.systemR),
        isNotNull(trades.systemOutcome),
        isNotNull(trades.systemExitedAt),
        ...dateConditions(trades.systemExitedAt, context.data.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.systemExitedAt), asc(trades.id));

  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      systemStatus: row.systemStatus as SystemStatus,
      deletedAt: null,
      systemR: row.systemR as string,
      systemOutcome: row.systemOutcome as OutcomeValue,
      systemExitedAt: (row.systemExitedAt as Date).toISOString(),
    })),
  };
}

export interface PairedAnalyticsRecord {
  readonly tradeId: string;
  readonly actualR: string;
  readonly systemR: string;
  readonly actualExitedAt: string;
  readonly systemExitedAt: string;
  readonly tradingAccountId: string;
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly setupId: string;
}

export async function getPairedAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly PairedAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
  const db = getDb();
  const conditions = [
    ...frameworkConditions(context.data),
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
  if (context.data.filters.dateBounds.kind === 'bounded') {
    conditions.push(
      ...dateConditions(trades.exitedAt, context.data.filters.dateBounds),
      ...dateConditions(trades.systemExitedAt, context.data.filters.dateBounds),
    );
  }

  const rows = await db
    .select({
      tradeId: trades.id,
      actualR: trades.actualR,
      systemR: trades.systemR,
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

  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      actualR: row.actualR as string,
      systemR: row.systemR as string,
      actualExitedAt: (row.actualExitedAt as Date).toISOString(),
      systemExitedAt: (row.systemExitedAt as Date).toISOString(),
    })),
  };
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
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly setupId: string;
  readonly exitedAt: string;
}

export async function getRuleAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly RuleAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
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
        ...frameworkConditions(context.data),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.exitedAt),
        ...dateConditions(trades.exitedAt, context.data.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id), asc(tradeRuleChecks.sortOrder));

  return {
    ok: true,
    data: rows.map(({ setupVersionId, ...row }) => ({
      ...row,
      checkStatus: row.checkStatus as RuleCheckStatus,
      scope: setupVersionId === null ? 'strategy' : 'setup',
      exitedAt: (row.exitedAt as Date).toISOString(),
    })),
  };
}

export interface MistakeAnalyticsRecord {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
  readonly tradingAccountId: string;
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly setupId: string;
  readonly exitedAt: string;
}

export async function getMistakeAnalyticsRecords(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsReadResult<readonly MistakeAnalyticsRecord[]>> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;
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
        ...frameworkConditions(context.data),
        isNull(trades.deletedAt),
        eq(trades.status, 'closed'),
        isNotNull(trades.exitedAt),
        eq(mistakeTypes.isSystem, true),
        ...dateConditions(trades.exitedAt, context.data.filters.dateBounds),
      ),
    )
    .orderBy(asc(trades.exitedAt), asc(trades.id), asc(mistakeTypes.sortOrder));

  return {
    ok: true,
    data: rows.map((row) => ({ ...row, exitedAt: (row.exitedAt as Date).toISOString() })),
  };
}
