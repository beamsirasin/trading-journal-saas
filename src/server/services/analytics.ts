import 'server-only';

import { composeAnalyticsSnapshot, type AnalyticsSnapshot } from '@/lib/analytics/metrics';
import {
  getAnalyticsRawPopulations,
  type AnalyticsFilterErrorCode,
  type AnalyticsReadOptions,
} from '@/server/dal/analytics';

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
