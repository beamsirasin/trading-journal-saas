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
      comparison: raw.data.paired,
      rules: raw.data.rules,
      mistakes: raw.data.mistakes,
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
