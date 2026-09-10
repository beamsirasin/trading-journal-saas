import { systemAnalyticsEligibility } from '@/lib/calc/system-assessment';
import type { TradeDetail } from '@/server/dal/trades';

/** UI adapter only; staleness remains owned by the Pass 5A domain helper. */
export function tradeSystemAssessmentEligibility(trade: TradeDetail) {
  return systemAnalyticsEligibility({
    systemStatus: trade.systemStatus,
    systemResolvedAt: trade.systemResolvedAt,
    systemDependencySnapshot: trade.systemDependencySnapshot,
    systemGrossR: trade.systemGrossR,
    systemR: trade.systemR,
    systemOutcome: trade.systemOutcome,
    current: {
      systemResolutionKind: trade.systemResolutionKind,
      systemExitReason: trade.systemExitReason,
      strategyVersionId: trade.strategyVersionId,
      setupVersionId: trade.setupVersionId,
      plannedRiskMinor: trade.plannedRiskMinor,
      plannedRewardMinor: trade.plannedRewardMinor,
      plannedEntry: trade.plannedEntry,
      plannedStop: trade.plannedStop,
    },
  });
}
