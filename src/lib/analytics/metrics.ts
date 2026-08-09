import {
  averageLossR,
  averageR,
  averageWinR,
  expectancyR,
  payoffRatio,
  profitFactor,
  selectSystemEligible,
  selectTraderEligible,
  totalR,
  winRate,
} from '@/lib/calc/aggregate';
import {
  executionEfficiency,
  pairedEdgeLeakageR,
  ruleAdherenceRate,
  selectComparisonEligible,
} from '@/lib/calc/attribution';
import { equityCurveR, maximumDrawdownR } from '@/lib/calc/equity';
import { type CalcFailureReason, type CalcResult } from '@/lib/calc/types';
import type {
  OutcomeValue,
  RuleCheckStatus,
  SystemStatus,
  TradeStatus,
} from '@/lib/trades/constants';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from './filters';

export const ANALYTICS_UNAVAILABLE_REASONS = [
  'no_trades',
  'no_wins',
  'no_losses',
  'no_profit_or_loss',
  'no_comparable_trades',
  'system_has_no_edge',
  'no_rule_checks',
] as const;

export type AnalyticsUnavailableReason = (typeof ANALYTICS_UNAVAILABLE_REASONS)[number];

export type AnalyticsMetric<T = string> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: AnalyticsUnavailableReason }
  | { readonly status: 'error'; readonly reason: 'data_integrity_error' };

const FAILURE_CLASSIFICATION = {
  missing_input: 'data_integrity_error',
  invalid_decimal: 'data_integrity_error',
  invalid_direction: 'data_integrity_error',
  zero_risk: 'data_integrity_error',
  invalid_risk_direction: 'data_integrity_error',
  invalid_target_direction: 'data_integrity_error',
  invalid_initial_risk: 'data_integrity_error',
  invalid_system_cost: 'data_integrity_error',
  unresolved_system_outcome: 'data_integrity_error',
  system_no_trade: 'data_integrity_error',
  no_trades: 'no_trades',
  no_wins: 'no_wins',
  no_losses: 'no_losses',
  no_profit_or_loss: 'no_profit_or_loss',
  system_has_no_edge: 'system_has_no_edge',
  no_comparable_trades: 'no_comparable_trades',
  no_rule_checks: 'no_rule_checks',
} as const satisfies Record<CalcFailureReason, AnalyticsUnavailableReason | 'data_integrity_error'>;

/** Exhaustive, sanitized boundary from calculation failures to UI-safe metric states. */
export function toAnalyticsMetric<T>(result: CalcResult<T>): AnalyticsMetric<T> {
  if (result.ok) return { status: 'available', value: result.value };
  const classification = FAILURE_CLASSIFICATION[result.reason];
  return classification === 'data_integrity_error'
    ? { status: 'error', reason: 'data_integrity_error' }
    : { status: 'unavailable', reason: classification };
}

function integrityError<T>(): AnalyticsMetric<T> {
  return { status: 'error', reason: 'data_integrity_error' };
}

export interface TraderMetricRecord {
  readonly tradeId: string;
  readonly status: TradeStatus | string;
  readonly deletedAt: Date | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly exitedAt: string;
}

export interface SystemMetricRecord {
  readonly tradeId: string;
  readonly systemStatus: SystemStatus | string;
  readonly deletedAt: Date | null;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemExitedAt: string;
}

export interface AnalyticsEquityPoint {
  readonly tradeId: string;
  readonly occurredAt: string;
  readonly cumulativeR: string;
}

export interface PerformanceAnalyticsModel {
  readonly sampleCount: number;
  readonly totalR: AnalyticsMetric;
  readonly winRate: AnalyticsMetric;
  readonly averageR: AnalyticsMetric;
  readonly expectancyR: AnalyticsMetric;
  readonly profitFactor: AnalyticsMetric;
  readonly maximumDrawdownR: AnalyticsMetric;
  readonly averageWinR: AnalyticsMetric;
  readonly averageLossR: AnalyticsMetric;
  readonly payoffRatio: AnalyticsMetric;
  readonly equityCurve: AnalyticsMetric<readonly AnalyticsEquityPoint[]>;
}

interface AxisRecord {
  readonly tradeId: string;
  readonly r: string;
  readonly outcome: OutcomeValue;
  readonly occurredAt: string;
}

function composePerformanceAxis(records: readonly AxisRecord[]): PerformanceAnalyticsModel {
  const rValues = records.map((record) => record.r);
  const outcomeRecords = records.map((record) => ({ r: record.r, outcome: record.outcome }));
  const datedRecords = records.map((record) => ({
    id: record.tradeId,
    occurredAt: new Date(record.occurredAt),
    r: record.r,
  }));
  const hasInvalidTimestamp = datedRecords.some((record) =>
    Number.isNaN(record.occurredAt.getTime()),
  );

  const equity = hasInvalidTimestamp ? null : equityCurveR(datedRecords);
  const drawdown = hasInvalidTimestamp ? null : maximumDrawdownR(datedRecords);

  return {
    sampleCount: records.length,
    totalR: toAnalyticsMetric(totalR(rValues)),
    winRate: toAnalyticsMetric(winRate(outcomeRecords)),
    averageR: toAnalyticsMetric(averageR(rValues)),
    expectancyR: toAnalyticsMetric(expectancyR(rValues)),
    profitFactor: toAnalyticsMetric(profitFactor(rValues)),
    maximumDrawdownR: drawdown === null ? integrityError() : toAnalyticsMetric(drawdown),
    averageWinR: toAnalyticsMetric(averageWinR(outcomeRecords)),
    averageLossR: toAnalyticsMetric(averageLossR(outcomeRecords)),
    payoffRatio: toAnalyticsMetric(payoffRatio(outcomeRecords)),
    equityCurve:
      equity === null
        ? integrityError()
        : equity.ok
          ? {
              status: 'available',
              value: equity.value.map((point) => ({
                tradeId: point.tradeId,
                occurredAt: point.occurredAt.toISOString(),
                cumulativeR: point.cumulativeR,
              })),
            }
          : toAnalyticsMetric(equity),
  };
}

export function composeTraderAnalytics(
  records: readonly TraderMetricRecord[],
): PerformanceAnalyticsModel {
  const eligible = selectTraderEligible(records);
  return composePerformanceAxis(
    eligible.map((record) => ({
      tradeId: record.tradeId,
      r: record.actualR as string,
      outcome: record.traderOutcome as OutcomeValue,
      occurredAt: record.exitedAt,
    })),
  );
}

export function composeSystemAnalytics(
  records: readonly SystemMetricRecord[],
): PerformanceAnalyticsModel {
  const eligible = selectSystemEligible(records);
  return composePerformanceAxis(
    eligible.map((record) => ({
      tradeId: record.tradeId,
      r: record.systemR as string,
      outcome: record.systemOutcome as OutcomeValue,
      occurredAt: record.systemExitedAt,
    })),
  );
}

export interface ComparisonMetricRecord {
  readonly tradeId: string;
  readonly actualR: string | null;
  readonly systemR: string | null;
}

export interface ComparisonAnalyticsModel {
  readonly comparableCount: number;
  readonly pairedSystemTotalR: AnalyticsMetric;
  readonly pairedActualTotalR: AnalyticsMetric;
  readonly edgeLeakageR: AnalyticsMetric;
  readonly executionEfficiency: AnalyticsMetric;
}

export function composeComparisonAnalytics(
  records: readonly ComparisonMetricRecord[],
): ComparisonAnalyticsModel {
  const eligible = selectComparisonEligible(records).map((record) => ({
    tradeId: record.tradeId,
    actualR: record.actualR as string,
    systemR: record.systemR as string,
  }));
  if (eligible.length === 0) {
    const unavailable = {
      status: 'unavailable',
      reason: 'no_comparable_trades',
    } as const;
    return {
      comparableCount: 0,
      pairedSystemTotalR: unavailable,
      pairedActualTotalR: unavailable,
      edgeLeakageR: unavailable,
      executionEfficiency: unavailable,
    };
  }

  return {
    comparableCount: eligible.length,
    pairedSystemTotalR: toAnalyticsMetric(totalR(eligible.map((record) => record.systemR))),
    pairedActualTotalR: toAnalyticsMetric(totalR(eligible.map((record) => record.actualR))),
    edgeLeakageR: toAnalyticsMetric(pairedEdgeLeakageR(eligible)),
    executionEfficiency: toAnalyticsMetric(executionEfficiency(eligible)),
  };
}

export interface RuleMetricRecord {
  readonly checkStatus: RuleCheckStatus | string;
}

export interface RuleAnalyticsModel {
  readonly followedCount: number;
  readonly violatedCount: number;
  readonly notCheckedCount: number;
  readonly notApplicableCount: number;
  readonly evaluatedCount: number;
  readonly adherenceRate: AnalyticsMetric;
}

export function composeRuleAnalytics(records: readonly RuleMetricRecord[]): RuleAnalyticsModel {
  let followedCount = 0;
  let violatedCount = 0;
  let notCheckedCount = 0;
  let notApplicableCount = 0;
  for (const record of records) {
    if (record.checkStatus === 'followed') followedCount += 1;
    else if (record.checkStatus === 'violated') violatedCount += 1;
    else if (record.checkStatus === 'not_checked') notCheckedCount += 1;
    else if (record.checkStatus === 'not_applicable') notApplicableCount += 1;
  }

  return {
    followedCount,
    violatedCount,
    notCheckedCount,
    notApplicableCount,
    evaluatedCount: followedCount + violatedCount,
    adherenceRate: toAnalyticsMetric(
      ruleAdherenceRate(records.map((record) => ({ status: record.checkStatus }))),
    ),
  };
}

export interface MistakeMetricRecord {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
}

export interface MistakeCountModel {
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
  readonly tradeCount: number;
}

export function composeMistakeAnalytics(
  records: readonly MistakeMetricRecord[],
): readonly MistakeCountModel[] {
  const counts = new Map<string, MistakeCountModel>();
  const seenPairs = new Set<string>();
  for (const record of records) {
    const pairKey = `${record.tradeId}:${record.mistakeTypeId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const current = counts.get(record.mistakeTypeId);
    counts.set(record.mistakeTypeId, {
      mistakeTypeId: record.mistakeTypeId,
      key: record.key,
      label: record.label,
      tradeCount: (current?.tradeCount ?? 0) + 1,
    });
  }
  return [...counts.values()].sort(
    (a, b) => b.tradeCount - a.tradeCount || a.key.localeCompare(b.key),
  );
}

export interface AnalyticsScopeModel {
  readonly datePreset: AnalyticsDatePreset;
  readonly dateBounds: AnalyticsDateBounds;
  readonly accountScope:
    | { readonly kind: 'all' }
    | {
        readonly kind: 'account';
        readonly accountId: string;
        readonly source: 'active' | 'explicit';
      };
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
  readonly timezone: string;
}

export interface AnalyticsSnapshotInput {
  readonly scope: AnalyticsScopeModel;
  readonly trader: readonly TraderMetricRecord[];
  readonly system: readonly SystemMetricRecord[];
  readonly comparison: readonly ComparisonMetricRecord[];
  readonly rules: readonly RuleMetricRecord[];
  readonly mistakes: readonly MistakeMetricRecord[];
}

export interface AnalyticsSnapshot {
  readonly scope: AnalyticsScopeModel;
  readonly trader: PerformanceAnalyticsModel;
  readonly system: PerformanceAnalyticsModel;
  readonly comparison: ComparisonAnalyticsModel;
  readonly rules: RuleAnalyticsModel;
  readonly mistakes: readonly MistakeCountModel[];
}

export function composeAnalyticsSnapshot(input: AnalyticsSnapshotInput): AnalyticsSnapshot {
  return {
    scope: input.scope,
    trader: composeTraderAnalytics(input.trader),
    system: composeSystemAnalytics(input.system),
    comparison: composeComparisonAnalytics(input.comparison),
    rules: composeRuleAnalytics(input.rules),
    mistakes: composeMistakeAnalytics(input.mistakes),
  };
}

export interface DashboardOverview {
  readonly scope: AnalyticsScopeModel;
  readonly trader: Pick<
    PerformanceAnalyticsModel,
    'sampleCount' | 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'
  >;
  readonly system: Pick<
    PerformanceAnalyticsModel,
    'sampleCount' | 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'
  >;
  readonly comparison: ComparisonAnalyticsModel;
}

/** Selects the Phase 09D headline subset without recalculating any metric. */
export function composeDashboardOverview(snapshot: AnalyticsSnapshot): DashboardOverview {
  const selectAxis = (axis: PerformanceAnalyticsModel) => ({
    sampleCount: axis.sampleCount,
    totalR: axis.totalR,
    expectancyR: axis.expectancyR,
    winRate: axis.winRate,
    profitFactor: axis.profitFactor,
  });
  return {
    scope: snapshot.scope,
    trader: selectAxis(snapshot.trader),
    system: selectAxis(snapshot.system),
    comparison: snapshot.comparison,
  };
}
