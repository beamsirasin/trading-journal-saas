import 'server-only';

import { dashboardAnalyticsInput, type DashboardFilterState } from '@/lib/dashboard/filters';
import { composeDashboardPageData, type DashboardPageData } from '@/lib/dashboard/page-data';
import {
  getDashboardRawData,
  type AnalyticsFilterErrorCode,
  type AnalyticsReadOptions,
} from '@/server/dal/analytics';

export type DashboardPageServiceResult =
  | { readonly ok: true; readonly data: DashboardPageData }
  | { readonly ok: false; readonly code: AnalyticsFilterErrorCode };

/** D2 canonical Dashboard service: one scope resolution and one narrow DAL bundle. */
export async function getDashboardPageData(
  filters: DashboardFilterState,
  options: AnalyticsReadOptions = {},
): Promise<DashboardPageServiceResult> {
  const raw = await getDashboardRawData(dashboardAnalyticsInput(filters), options);
  if (!raw.ok) return raw;
  return {
    ok: true,
    data: composeDashboardPageData({
      scope: {
        datePreset: raw.data.filters.datePreset,
        dateBounds: raw.data.filters.dateBounds,
        accountScope: raw.data.filters.accountScope,
        strategyId: raw.data.filters.strategyId,
        setupId: raw.data.filters.setupId,
        strategyVersionId: raw.data.filters.strategyVersionId,
        timezone: raw.data.filters.timezone,
      },
      filters,
      account: raw.data.account,
      trader: raw.data.trader,
      system: raw.data.system,
      comparison: raw.data.paired,
      attention: raw.data.attention,
      recentTrades: raw.data.recentTrades,
    }),
  };
}
