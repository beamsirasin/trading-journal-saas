import 'server-only';

import {
  composeAnalyticsSnapshot,
  composeDashboardOverview,
  type AnalyticsSnapshot,
  type DashboardOverview,
} from '@/lib/analytics/metrics';
import { resolveDashboardDatePreset } from '@/lib/analytics/presentation';
import {
  getAnalyticsFilterOptions,
  getAnalyticsRawPopulations,
  type AnalyticsFilterErrorCode,
  type AnalyticsFilterOptions,
  type AnalyticsReadOptions,
} from '@/server/dal/analytics';
import { listWorkspaceTrades, type TradeListItem } from '@/server/dal/trades';

export type AnalyticsServiceResult =
  | { readonly ok: true; readonly data: AnalyticsSnapshot }
  | { readonly ok: false; readonly code: AnalyticsFilterErrorCode };

/** Authenticated Phase 09 analytics boundary consumed by future route/UI code. */
export async function getAnalyticsSnapshot(
  input: unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsServiceResult> {
  const raw = await getAnalyticsRawPopulations(input, options);
  if (!raw.ok) return raw;

  return {
    ok: true,
    data: composeAnalyticsSnapshot({
      scope: {
        datePreset: raw.data.filters.datePreset,
        dateBounds: raw.data.filters.dateBounds,
        accountScope: raw.data.filters.accountScope,
        strategyId: raw.data.filters.strategyId,
        setupId: raw.data.filters.setupId,
        strategyVersionId: raw.data.filters.strategyVersionId,
        timezone: raw.data.filters.timezone,
      },
      trader: raw.data.trader,
      system: raw.data.system,
      systemPendingCount: raw.data.systemPendingCount,
      comparison: raw.data.paired,
      rules: raw.data.rules,
      mistakes: raw.data.mistakes,
      setupAdherence: raw.data.setupAdherence.map((record) => ({
        tradeId: record.tradeId,
        metCount: record.metCount,
        totalCount: record.totalCount,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      setupAdherenceSystem: raw.data.setupAdherenceSystem.map((record) => ({
        tradeId: record.tradeId,
        metCount: record.metCount,
        totalCount: record.totalCount,
        r: record.systemR,
        outcome: record.systemOutcome,
      })),
      conditions: raw.data.conditions.map((record) => ({
        tradeId: record.tradeId,
        setupId: record.setupId,
        conditionKey: record.conditionKey,
        label: record.label,
        checkStatus: record.checkStatus,
        r: record.actualR,
        outcome: record.traderOutcome,
        occurredAt: record.exitedAt,
      })),
      conditionsSystem: raw.data.conditionsSystem.map((record) => ({
        tradeId: record.tradeId,
        setupId: record.setupId,
        conditionKey: record.conditionKey,
        label: record.label,
        checkStatus: record.checkStatus,
        r: record.systemR,
        outcome: record.systemOutcome,
        occurredAt: record.systemExitedAt,
      })),
      confidence: raw.data.confidence.map((record) => ({
        tradeId: record.tradeId,
        confidence: record.confidence,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      confidenceSystem: raw.data.confidenceSystem.map((record) => ({
        tradeId: record.tradeId,
        confidence: record.confidence,
        r: record.systemR,
        outcome: record.systemOutcome,
      })),
      emotions: raw.data.emotions.map((record) => ({
        tradeId: record.tradeId,
        key: record.key,
        label: record.label,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      emotionsSystem: raw.data.emotionsSystem.map((record) => ({
        tradeId: record.tradeId,
        key: record.key,
        label: record.label,
        r: record.systemR,
        outcome: record.systemOutcome,
      })),
      // Phase 15D — Strategy/Setup grouping reuses the SAME already-fetched
      // Trader/System eligible arrays (they already carry `strategyId`/
      // `setupId` — Phase 14B never gated eligibility on classification), no
      // new query.
      frameworkTrader: raw.data.trader.map((record) => ({
        tradeId: record.tradeId,
        strategyId: record.strategyId,
        setupId: record.setupId,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      frameworkSystem: raw.data.system.map((record) => ({
        tradeId: record.tradeId,
        strategyId: record.strategyId,
        setupId: record.setupId,
        r: record.systemR,
        outcome: record.systemOutcome,
      })),
      // Phase 15D — Context breakdowns, Trader-only (documented decision).
      // `raw.data.trader` was widened (`server/dal/analytics.ts`) to also
      // carry symbol/direction/session/timeframe on this same query.
      contextSymbol: raw.data.trader.map((record) => ({
        tradeId: record.tradeId,
        value: record.symbol,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      contextDirection: raw.data.trader.map((record) => ({
        tradeId: record.tradeId,
        value: record.direction,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      contextSession: raw.data.trader.map((record) => ({
        tradeId: record.tradeId,
        value: record.session,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
      contextTimeframe: raw.data.trader.map((record) => ({
        tradeId: record.tradeId,
        value: record.timeframe,
        r: record.actualR,
        outcome: record.traderOutcome,
      })),
    }),
  };
}

export interface AnalyticsPageData {
  readonly snapshot: AnalyticsSnapshot;
  readonly filterOptions: AnalyticsFilterOptions;
}

export type AnalyticsPageServiceResult =
  | { readonly ok: true; readonly data: AnalyticsPageData }
  | {
      readonly ok: false;
      readonly code: AnalyticsFilterErrorCode;
      readonly filterOptions: AnalyticsFilterOptions;
    };

/** Real deep-Analytics read boundary: one canonical snapshot plus selectors. */
export async function getAnalyticsPageData(
  input: unknown,
  options: AnalyticsReadOptions = {},
): Promise<AnalyticsPageServiceResult> {
  const [snapshot, filterOptions] = await Promise.all([
    getAnalyticsSnapshot(input, options),
    getAnalyticsFilterOptions(),
  ]);
  return snapshot.ok
    ? { ok: true, data: { snapshot: snapshot.data, filterOptions } }
    : { ok: false, code: snapshot.code, filterOptions };
}

export interface DashboardOverviewData {
  readonly overview: DashboardOverview;
  readonly recentTrades: readonly TradeListItem[];
}

export type DashboardOverviewServiceResult =
  | { readonly ok: true; readonly data: DashboardOverviewData }
  | { readonly ok: false; readonly code: AnalyticsFilterErrorCode };

/**
 * Narrow `/app` contract: the caller supplies only a date-range value. The
 * Account is always resolved from the active-account context, so this API
 * cannot be used to request All Accounts or framework filters.
 */
export async function getDashboardOverview(
  rangeInput: unknown,
  options: AnalyticsReadOptions = {},
): Promise<DashboardOverviewServiceResult> {
  const datePreset = resolveDashboardDatePreset(rangeInput);
  const snapshot = await getAnalyticsSnapshot({ datePreset }, options);
  if (!snapshot.ok) return snapshot;
  const accountScope = snapshot.data.scope.accountScope;
  if (accountScope.kind !== 'account' || accountScope.source !== 'active') {
    return { ok: false, code: 'invalid_filters' };
  }

  const recent = await listWorkspaceTrades({
    limit: 5,
    tradingAccountId: accountScope.accountId,
  });
  return {
    ok: true,
    data: {
      overview: composeDashboardOverview(snapshot.data),
      recentTrades: recent.items,
    },
  };
}
