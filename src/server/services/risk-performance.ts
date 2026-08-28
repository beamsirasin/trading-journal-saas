import 'server-only';

import { dashboardAnalyticsInput, type DashboardFilterState } from '@/lib/dashboard/filters';
import {
  composeRiskPerformance,
  type RiskPerformanceData,
  type RiskPerformanceScopeInput,
} from '@/lib/dashboard/risk-performance';
import type { AnalyticsReadOptions } from '@/server/dal/analytics';
import {
  getRiskPerformanceRawData,
  type RiskPerformanceReadErrorCode,
} from '@/server/dal/risk-performance';

export type RiskPerformanceServiceResult =
  | { readonly ok: true; readonly data: RiskPerformanceData }
  | { readonly ok: false; readonly code: RiskPerformanceReadErrorCode };

/**
 * The Risk Performance boundary.
 *
 * D7A defined it; D7B accepted the contract unchanged and now renders it via
 * `RiskPerformanceSection`, whose server component is the only caller. The
 * Dashboard's five core projections are untouched, this remains exactly one
 * focused read, and nothing on the client fetches it.
 */
export async function getRiskPerformanceData(
  filters: DashboardFilterState,
  options: AnalyticsReadOptions = {},
): Promise<RiskPerformanceServiceResult> {
  const raw = await getRiskPerformanceRawData(dashboardAnalyticsInput(filters), options);
  if (!raw.ok) return raw;

  const scope: RiskPerformanceScopeInput = {
    datePreset: raw.data.filters.datePreset,
    dateBounds: raw.data.filters.dateBounds,
    account:
      raw.data.account.kind === 'all'
        ? { kind: 'all' }
        : {
            kind: 'account',
            accountId: raw.data.account.account.id,
            source: raw.data.account.source,
            baseCurrency: raw.data.account.account.baseCurrency,
            startingBalance: raw.data.account.account.startingBalance,
          },
    strategyId: raw.data.filters.strategyId,
    setupId: raw.data.filters.setupId,
    strategyVersionId: raw.data.filters.strategyVersionId,
  };

  return {
    ok: true,
    data: composeRiskPerformance({ scope, asOf: raw.data.asOf, trades: raw.data.trades }),
  };
}
