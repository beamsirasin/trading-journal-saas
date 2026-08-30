import type { AnalyticsMetric, PerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import type { ComparisonExclusions } from '@/lib/dashboard/execution-comparison';

/**
 * Shared literals for the two analytics models that unit tests build by hand.
 *
 * `ComparisonAnalyticsModel` and `DashboardExecutionComparison` are wide
 * contracts, and a test that only cares about the Execution Gap total still
 * has to satisfy every field. Before this module each such test spelled the
 * whole shape inline, so adding one field to either model meant editing five
 * files that had no opinion about it — and the pressure that creates is to
 * widen the model with optional fields it does not really have.
 *
 * These are DEFAULTS, not assertions. A test that cares about an axis or an
 * exclusion count passes its own value; these exist so the tests that do not
 * care can say so by omission.
 */

const unavailable = (reason: 'no_trades' | 'no_comparable_trades'): AnalyticsMetric => ({
  status: 'unavailable',
  reason,
});

/**
 * A performance axis over an empty population — every aggregate legitimately
 * unavailable, never a fabricated zero (CLAUDE.md §6).
 */
export function emptyPerformanceAxis(): PerformanceAnalyticsModel {
  return {
    sampleCount: 0,
    outcomeCounts: { wins: 0, breakEvens: 0, losses: 0 },
    totalR: unavailable('no_trades'),
    winRate: unavailable('no_trades'),
    averageR: unavailable('no_trades'),
    expectancyR: unavailable('no_trades'),
    profitFactor: unavailable('no_trades'),
    maximumDrawdownR: unavailable('no_trades'),
    averageWinR: unavailable('no_trades'),
    averageLossR: unavailable('no_trades'),
    payoffRatio: unavailable('no_trades'),
    equityCurve: { status: 'available', value: [] },
  };
}

/**
 * A populated axis whose figures a test can override individually.
 *
 * The defaults are the reference fixture's paired System side, so a test that
 * overrides nothing still reads as a plausible axis rather than as a row of
 * placeholder ones.
 */
export function performanceAxis(
  overrides: Partial<PerformanceAnalyticsModel> = {},
): PerformanceAnalyticsModel {
  return {
    ...emptyPerformanceAxis(),
    sampleCount: 64,
    outcomeCounts: { wins: 28, breakEvens: 3, losses: 33 },
    totalR: { status: 'available', value: '35.8000' },
    winRate: { status: 'available', value: '0.4375' },
    averageR: { status: 'available', value: '0.5594' },
    expectancyR: { status: 'available', value: '0.5594' },
    ...overrides,
  };
}

/** Nothing was left out — the shape a pre-filtered fixture honestly has. */
export const NO_COMPARISON_EXCLUSIONS: ComparisonExclusions = {
  total: 0,
  byReason: {
    awaiting_system_result: 0,
    trade_open: 0,
    trade_planned: 0,
    trade_canceled: 0,
    incomplete_record: 0,
  },
};
