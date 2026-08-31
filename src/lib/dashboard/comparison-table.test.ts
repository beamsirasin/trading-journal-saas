import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric, ComparisonAnalyticsModel } from '@/lib/analytics/metrics';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import { emptyPerformanceAxis, performanceAxis } from '@/test/analytics-model-fixtures';

import {
  composeComparisonTable,
  composeComparisonTablePrecision,
  metricDelta,
} from './comparison-table';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable: AnalyticsMetric = { status: 'unavailable', reason: 'no_comparable_trades' };

function summary(overrides: Partial<ComparisonAnalyticsModel> = {}): ComparisonAnalyticsModel {
  return {
    comparableCount: 64,
    // The reference fixture's two axes, pinned to the same 64 Trades.
    pairedSystemAxis: performanceAxis({
      winRate: available('0.4375'),
      payoffRatio: available('2.5665'),
    }),
    pairedActualAxis: performanceAxis({
      totalR: available('22.0000'),
      winRate: available('0.4063'),
      payoffRatio: available('2.0239'),
    }),
    pairedSystemTotalR: available('35.8000'),
    pairedActualTotalR: available('22.0000'),
    executionGapR: available('-13.8000'),
    averageExecutionGapR: available('-0.2156'),
    systemEdgeCaptured: available('0.6145'),
    ...overrides,
  };
}

const rowFor = (key: string, model = summary()) =>
  composeComparisonTable(model).find((row) => row.key === key)!;

const rendered = (key: string, model = summary()) => {
  const row = rowFor(key, model);
  const delta = formatAnalyticsMetric(row.delta, row.deltaStyle);
  return {
    system: formatAnalyticsMetric(row.system, row.style),
    actual: formatAnalyticsMetric(row.actual, row.style),
    delta,
  };
};

describe('comparison table composition', () => {
  it('emits the three rows in reading order', () => {
    expect(composeComparisonTable(summary()).map((row) => row.key)).toEqual([
      'totalR',
      'winRate',
      'payoffRatio',
    ]);
  });

  /**
   * The Total R difference must BE `executionGapR`, not a second computation
   * of it. The two agree today by linearity, which is exactly why a
   * re-derivation would be dangerous: it would keep agreeing right up until
   * it did not, with nothing to say which value was right.
   */
  it('takes the Total R difference from executionGapR rather than subtracting the totals', () => {
    const model = summary({ executionGapR: available('-99.0000') });
    expect(rowFor('totalR', model).delta).toEqual(available('-99.0000'));
  });

  it('reads both sides of every row from the paired axes', () => {
    const rows = composeComparisonTable(summary());
    expect(rows.map((row) => row.system)).toEqual([
      available('35.8000'),
      available('0.4375'),
      available('2.5665'),
    ]);
    expect(rows.map((row) => row.actual)).toEqual([
      available('22.0000'),
      available('0.4063'),
      available('2.0239'),
    ]);
  });

  /**
   * A difference of two rates is in percentage points, and a difference of
   * two ratios is still a multiple. Rendering both as the same unit as their
   * operands would be wrong for the first and right for the second, which is
   * why the row carries its own `deltaStyle` rather than reusing `style`.
   */
  it('renders each difference in the unit a difference of that row actually has', () => {
    expect(rendered('totalR').delta).toEqual({
      status: 'available',
      text: '-13.80R',
      tone: 'negative',
    });
    expect(rendered('winRate').delta).toEqual({
      status: 'available',
      text: '-3.12 pp',
      tone: 'negative',
    });
    expect(rendered('payoffRatio').delta).toEqual({
      status: 'available',
      text: '-0.54x',
      tone: 'negative',
    });
  });

  /**
   * THE ROUNDING CONTRACT, PINNED SO IT IS NOT "FIXED" LATER.
   *
   * CLAUDE.md §5 allows exactly one rounding, at the presentation boundary.
   * Each visible figure is rounded once from its canonical value, and the
   * difference is rounded once from the difference of those canonical values
   * — never from the difference of the two rounded figures. On the reference
   * fixture that makes Avg Win/Loss read 2.57x and 2.02x with a difference of
   * -0.54x, where subtracting what is on screen gives -0.55x.
   *
   * This is correct. Rounding the operands first and then subtracting is two
   * roundings, which drifts further with every row. If this test fails, the
   * question to ask is which of the two practices changed, not how to make
   * the column match a by-eye subtraction.
   */
  it('rounds the difference once from the canonical values, not from the displayed ones', () => {
    const { system, actual, delta } = rendered('payoffRatio');
    expect(system).toMatchObject({ text: '2.57x' });
    expect(actual).toMatchObject({ text: '2.02x' });
    expect(delta).toMatchObject({ text: '-0.54x' });

    // The by-eye subtraction a reader would do, spelled out so the intent of
    // the assertion above cannot be mistaken for a typo.
    expect((2.57 - 2.02).toFixed(2)).toBe('0.55');
    expect(metricDelta(available('2.5665'), available('2.0239'))).toEqual(available('-0.5426'));
  });

  it('propagates an unavailable operand instead of inventing a difference', () => {
    expect(metricDelta(unavailable, available('1.0000'))).toEqual(unavailable);
    expect(metricDelta(available('1.0000'), unavailable)).toEqual(unavailable);
    const model = summary({
      pairedActualAxis: performanceAxis({
        payoffRatio: { status: 'unavailable', reason: 'no_losses' },
      }),
    });
    expect(rowFor('payoffRatio', model).delta).toEqual({
      status: 'unavailable',
      reason: 'no_losses',
    });
  });

  it('reports an unparseable stored value as an integrity error, never as zero', () => {
    expect(metricDelta(available('not-a-number'), available('1.0000'))).toEqual({
      status: 'error',
      reason: 'data_integrity_error',
    });
  });

  it('survives a population with nothing in it', () => {
    const empty = summary({
      comparableCount: 0,
      pairedSystemAxis: emptyPerformanceAxis(),
      pairedActualAxis: emptyPerformanceAxis(),
      pairedSystemTotalR: unavailable,
      pairedActualTotalR: unavailable,
      executionGapR: unavailable,
      systemEdgeCaptured: unavailable,
    });
    for (const row of composeComparisonTable(empty)) {
      expect(row.delta.status).not.toBe('available');
    }
  });
});

describe('comparison table precision', () => {
  /**
   * The popover exists because of the rounding contract above: a reader who
   * checks the subtraction and lands one unit out needs the canonical values
   * to confirm what happened, not the rounded ones already on screen.
   */
  it('exposes the canonical values the difference was taken from', () => {
    expect(composeComparisonTablePrecision(composeComparisonTable(summary()))).toEqual([
      { key: 'totalR', system: '35.8000', actual: '22.0000', delta: '-13.8000' },
      { key: 'winRate', system: '0.4375', actual: '0.4063', delta: '-0.0312' },
      { key: 'payoffRatio', system: '2.5665', actual: '2.0239', delta: '-0.5426' },
    ]);
  });

  it('reports an unavailable figure as absent rather than as a value', () => {
    const model = summary({ pairedSystemTotalR: unavailable, executionGapR: unavailable });
    const totalR = composeComparisonTablePrecision(composeComparisonTable(model))[0];
    expect(totalR).toEqual({ key: 'totalR', system: null, actual: '22.0000', delta: null });
  });
});
