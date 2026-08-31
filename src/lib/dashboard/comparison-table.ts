import type { AnalyticsMetric, ComparisonAnalyticsModel } from '@/lib/analytics/metrics';
import type { AnalyticsDisplayStyle } from '@/lib/analytics/presentation';
import { parseCalcDecimal, toCanonicalR } from '@/lib/calc/decimal';

/**
 * The three rows of the System-versus-Trader comparison table.
 *
 * WHY THESE THREE. They are the three figures the two retired baseline cards
 * led with, and each has a definition that survives being pinned to one
 * population: a sum, a rate, and a ratio of averages. Expectancy, profit
 * factor and maximum drawdown are all still composed on both axes and remain
 * on the payload — they are simply not the Dashboard's detection layer.
 */
export const COMPARISON_TABLE_ROWS = ['totalR', 'winRate', 'payoffRatio'] as const;

export type ComparisonTableRowKey = (typeof COMPARISON_TABLE_ROWS)[number];

export interface ComparisonTableRow {
  readonly key: ComparisonTableRowKey;
  readonly system: AnalyticsMetric;
  readonly actual: AnalyticsMetric;
  /** `actual - system`, canonical. Never a ratio: see the module note below. */
  readonly delta: AnalyticsMetric;
  /** How System and Actual are rendered. */
  readonly style: AnalyticsDisplayStyle;
  /** How the difference is rendered — a difference is not always the same unit. */
  readonly deltaStyle: AnalyticsDisplayStyle;
}

/**
 * `actual - system` over two already-canonical metrics.
 *
 * THE DIFFERENCE IS NOT A RATIO, DELIBERATELY. System Edge Captured is the
 * product's one approved captured-ratio and it is defined for the R total
 * only, where it has a meaning ("you captured 61% of the edge the System
 * offered") and a guard for the case that would invert it (a non-positive
 * denominator). Extending a ratio to the other two rows would invent two
 * metrics that no evidence in this repository defines: a "win-rate captured"
 * of 92.9% does not mean 92.9% of an edge was captured, it means one hit rate
 * was 92.9% of another, which is a different claim wearing the same label.
 * A signed difference introduces no such policy — no weighting, no
 * normalisation, and no denominator that can flip the sign of the meaning.
 *
 * ROUNDING, AND WHY THE COLUMN MAY NOT EQUAL THE SUBTRACTION ON SCREEN.
 * CLAUDE.md §5 requires a single rounding at the presentation boundary. The
 * inputs here are the engine's canonical 4dp values; the difference is taken
 * at full precision and rounded exactly once when it is formatted, at 2dp.
 * The two visible figures are rounded once each, independently, for the same
 * reason. So on the reference fixture Avg Win/Loss reads 2.57x and 2.02x
 * while the difference reads -0.54x, not the -0.55x a reader subtracting the
 * displayed figures would get: 2.5665 - 2.0239 is 0.5426.
 *
 * THAT IS CORRECT AND IT IS NOT A BUG. Rounding the two operands first and
 * subtracting the results would be rounding twice, which is the practice §5
 * exists to forbid, and it would drift further with every additional row. The
 * difference may disagree with a by-eye subtraction by one unit in the last
 * displayed place. Please do not "fix" it by subtracting formatted strings.
 */
export function metricDelta(system: AnalyticsMetric, actual: AnalyticsMetric): AnalyticsMetric {
  if (system.status !== 'available') return system;
  if (actual.status !== 'available') return actual;

  const systemDecimal = parseCalcDecimal(system.value);
  const actualDecimal = parseCalcDecimal(actual.value);
  if (systemDecimal === null || actualDecimal === null) {
    return { status: 'error', reason: 'data_integrity_error' };
  }

  return { status: 'available', value: toCanonicalR(actualDecimal.minus(systemDecimal)) };
}

/**
 * Composes the table from one paired population.
 *
 * EVERY ROW READS THE SAME TRADES. `pairedSystemAxis` and `pairedActualAxis`
 * are both Population C, so the three rows can be checked against each other
 * and against the header's Execution Gap without the reader having to know
 * which population produced which figure. That is the entire reason the two
 * baseline cards could not simply be placed side by side: they count
 * Populations B and A, which differ by six Trades on the reference fixture.
 *
 * TOTAL R'S DIFFERENCE IS THE EXISTING METRIC, NOT A SUBTRACTION. It is
 * `executionGapR` — the summed per-Trade `actualR - systemR` that the header
 * shows and that Phase 13H locked. Recomputing it here as
 * `actualTotal - systemTotal` would be a second implementation of one
 * quantity that happens to agree today by linearity; one of them would
 * eventually stop agreeing, and there would be no way to tell which was
 * right. The other two rows have no such existing metric, so they take the
 * difference above.
 */
export function composeComparisonTable(
  summary: ComparisonAnalyticsModel,
): readonly ComparisonTableRow[] {
  const system = summary.pairedSystemAxis;
  const actual = summary.pairedActualAxis;

  return [
    {
      key: 'totalR',
      system: summary.pairedSystemTotalR,
      actual: summary.pairedActualTotalR,
      delta: summary.executionGapR,
      style: 'r',
      deltaStyle: 'r',
    },
    {
      key: 'winRate',
      system: system.winRate,
      actual: actual.winRate,
      delta: metricDelta(system.winRate, actual.winRate),
      style: 'percent',
      // A difference of two rates is measured in percentage points, and
      // labelling it `%` invites reading it as a relative change instead.
      deltaStyle: 'percentage-points',
    },
    {
      key: 'payoffRatio',
      system: system.payoffRatio,
      actual: actual.payoffRatio,
      delta: metricDelta(system.payoffRatio, actual.payoffRatio),
      style: 'multiple',
      deltaStyle: 'multiple',
    },
  ];
}

/**
 * The full-precision figures behind the table, for the card's info popover.
 *
 * The table shows two decimal places because that is what a Dashboard is
 * scanned at. A reader who wants to check the arithmetic — and the rounding
 * note above guarantees some will — needs the canonical values the difference
 * was actually taken from, not the rounded ones they can already see.
 */
export interface ComparisonTablePrecision {
  readonly key: ComparisonTableRowKey;
  readonly system: string | null;
  readonly actual: string | null;
  readonly delta: string | null;
}

export function composeComparisonTablePrecision(
  rows: readonly ComparisonTableRow[],
): readonly ComparisonTablePrecision[] {
  const canonical = (metric: AnalyticsMetric): string | null =>
    metric.status === 'available' ? metric.value : null;

  return rows.map((row) => ({
    key: row.key,
    system: canonical(row.system),
    actual: canonical(row.actual),
    delta: canonical(row.delta),
  }));
}
