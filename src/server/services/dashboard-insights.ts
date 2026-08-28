import 'server-only';

import { dashboardAnalyticsInput, type DashboardFilterState } from '@/lib/dashboard/filters';
import {
  composeDashboardInsights,
  type DashboardInsightData,
} from '@/lib/dashboard/insight-pillars';
import type { AnalyticsReadOptions } from '@/server/dal/analytics';
import {
  getDashboardInsightRawData,
  type DashboardInsightReadErrorCode,
} from '@/server/dal/dashboard-insights';

export type DashboardInsightServiceResult =
  | { readonly ok: true; readonly data: DashboardInsightData }
  | { readonly ok: false; readonly code: DashboardInsightReadErrorCode };

/** D8A DTO boundary only. D8B may consume it after contract review. */
export async function getDashboardInsightData(
  filters: DashboardFilterState,
  options: AnalyticsReadOptions = {},
): Promise<DashboardInsightServiceResult> {
  const raw = await getDashboardInsightRawData(dashboardAnalyticsInput(filters), options);
  if (!raw.ok) return raw;
  return { ok: true, data: composeDashboardInsights(raw.data) };
}
