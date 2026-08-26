import type { AnalyticsUnavailableReason } from '@/lib/analytics/metrics';

import { neutralMetric, plainValue, signedMetric, type MetricDisplayValue } from './metric-display';
import type { DashboardPageData, DashboardPerformanceData } from './page-data';
import { dashboardLayoutItem, type DashboardLayoutItem, type DashboardWidgetId } from './widgets';

/**
 * D4 System/Trader performance-card presentation model.
 *
 * Pure, and symmetric by construction: both sides run through one composer,
 * so the two cards cannot drift into different geometry or different state
 * handling. It recomputes no formula — every figure arrives canonical from D1
 * through D2 — and it never reads the paired comparison population, which is
 * D5's material.
 *
 * The two sides are two independent lenses, not a scoreboard. Population B
 * answers "what would the strategy have produced when resolved?"; Population
 * A answers "what did the execution actually produce?". Their Trade counts
 * legitimately differ under the same filter, and nothing here reconciles them.
 */

export const PERFORMANCE_SIDES = ['system', 'trader'] as const;
export type PerformanceSide = (typeof PERFORMANCE_SIDES)[number];

export type PerformanceValue = MetricDisplayValue<AnalyticsUnavailableReason>;

/**
 * The supporting grid, in reading order. Identical keys and identical order
 * on both sides, so a reader compares like with like by position alone.
 */
export const PERFORMANCE_METRIC_KEYS = [
  'winRate',
  'averageR',
  'expectancyR',
  'profitFactor',
  'maximumDrawdownR',
  'sampleCount',
] as const;

export type PerformanceMetricKey = (typeof PERFORMANCE_METRIC_KEYS)[number];

export interface PerformanceMetricCell {
  readonly key: PerformanceMetricKey;
  readonly value: PerformanceValue;
}

export interface PerformanceOutcomeComposition {
  readonly wins: number;
  readonly breakEvens: number;
  readonly losses: number;
}

export interface PerformanceCardModel {
  readonly side: PerformanceSide;
  readonly widgetId: DashboardWidgetId;
  readonly layout: DashboardLayoutItem;
  /** No eligible population for this side under the current filter. */
  readonly populationEmpty: boolean;
  readonly sampleCount: number;
  /** System Total R / Actual Total R — the one hero figure, signed. */
  readonly hero: PerformanceValue;
  readonly composition: PerformanceOutcomeComposition | null;
  readonly metrics: readonly PerformanceMetricCell[];
}

const WIDGET_ID: Record<PerformanceSide, DashboardWidgetId> = {
  system: 'system.performance',
  trader: 'trader.performance',
};

const EMPTY: PerformanceValue = { status: 'empty' };

function composeSide(side: PerformanceSide, axis: DashboardPerformanceData): PerformanceCardModel {
  const populationEmpty = axis.sampleCount === 0;

  const metrics: readonly PerformanceMetricCell[] = [
    { key: 'winRate', value: cell(populationEmpty, axis.winRate, 'percent') },
    { key: 'averageR', value: cell(populationEmpty, axis.averageR, 'r') },
    { key: 'expectancyR', value: cell(populationEmpty, axis.expectancyR, 'r') },
    { key: 'profitFactor', value: cell(populationEmpty, axis.profitFactor, 'factor') },
    // Maximum Drawdown is an unsigned distance, not a signed outcome: the
    // `magnitude` style renders `2.00R`, never `+2.00R`, and never tones it.
    { key: 'maximumDrawdownR', value: cell(populationEmpty, axis.maximumDrawdownR, 'magnitude') },
    // Always a truthful figure, including the zero of an empty population.
    { key: 'sampleCount', value: plainValue(String(axis.sampleCount)) },
  ];

  return {
    side,
    widgetId: WIDGET_ID[side],
    layout: dashboardLayoutItem(WIDGET_ID[side]),
    populationEmpty,
    sampleCount: axis.sampleCount,
    hero: populationEmpty ? EMPTY : signedMetric<AnalyticsUnavailableReason>(axis.totalR, 'r'),
    composition: populationEmpty ? null : axis.outcomeCounts,
    metrics,
  };
}

/**
 * Supporting analytics stay neutral whatever they read (§7): a Win Rate or a
 * Profit Factor is a measurement, not a verdict. Only the hero Total R keeps
 * its sign's colour.
 *
 * Per-metric availability survives an empty population only as `empty`; over
 * a population that does exist, each metric reports its own reason, so a
 * Profit Factor undefined for want of losses never blanks its neighbours.
 */
function cell(
  populationEmpty: boolean,
  metric: DashboardPerformanceData['winRate'],
  style: Parameters<typeof neutralMetric>[1],
): PerformanceValue {
  return populationEmpty ? EMPTY : neutralMetric<AnalyticsUnavailableReason>(metric, style);
}

/**
 * Both performance cards, System first.
 *
 * Reads `data.system` and `data.trader` only. `data.comparison` is
 * deliberately untouched: Execution Gap and System Edge Captured are D5, and
 * D4's job is to establish the two independent baselines first.
 */
export function composePerformanceCards(
  data: DashboardPageData,
): readonly [PerformanceCardModel, PerformanceCardModel] {
  return [composeSide('system', data.system), composeSide('trader', data.trader)];
}
