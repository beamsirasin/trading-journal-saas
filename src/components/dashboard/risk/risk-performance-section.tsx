import type { DashboardFilterState } from '@/lib/dashboard/filters';
import {
  composeRiskPerformanceView,
  riskPerformanceServiceError,
} from '@/lib/dashboard/risk-performance-presentation';
import { getRiskPerformanceData } from '@/server/services/risk-performance';

import { RiskPerformanceCard } from './risk-performance-card';

export interface RiskPerformanceSectionProps {
  readonly filters: DashboardFilterState;
  /** The workspace analytics timezone the five core reads already resolved. */
  readonly timezone: string;
  readonly dateLocale: string;
  readonly accountLabel: string;
  readonly className?: string;
}

/**
 * D7B — the Risk Performance section's own server boundary.
 *
 * D7A deliberately kept Modeled Balance OUT of `DashboardPageData`. The five
 * core reads are all bounded to the selected range, while a balance history
 * has to reach back to the Account's whole authoritative money history to
 * know what the range OPENED at — a different universe on a different
 * horizon, which is exactly the kind of thing that should not be smuggled
 * into a bundle to avoid declaring a boundary. So:
 *
 *   Dashboard core — 5 major projections, unchanged by D7B
 *   Risk           — 1 focused projection, three columns per row
 *
 * It is still server-driven. Nothing below this component fetches anything,
 * there is no client `useEffect` read, and there is no per-point query: the
 * whole series comes from that one ordered projection.
 *
 * A thrown read is caught here rather than allowed to take down the page. The
 * KPI band, the two baselines, the Execution Gap and the Calendar all come
 * from a different boundary and are still true; this section says so about
 * itself instead of erasing them.
 */
export async function RiskPerformanceSection({
  filters,
  timezone,
  dateLocale,
  accountLabel,
  className,
}: RiskPerformanceSectionProps) {
  const result = await getRiskPerformanceData(filters).catch(() => null);
  const view =
    result === null || !result.ok
      ? riskPerformanceServiceError()
      : composeRiskPerformanceView({ data: result.data, timezone, dateLocale });

  return (
    <RiskPerformanceCard
      view={view}
      accountLabel={accountLabel}
      {...(className === undefined ? {} : { className })}
    />
  );
}
