import { describe, expect, it } from 'vitest';

import type { ComparisonMetricRecord } from '@/lib/analytics/metrics';

import { composeExecutionComparison } from './execution-comparison';

const BANGKOK = 'Asia/Bangkok';

function pair(
  tradeId: string,
  actualR: string,
  systemR: string,
  exitedAt: string,
  systemExitedAt = exitedAt,
): ComparisonMetricRecord {
  return {
    tradeId,
    status: 'closed',
    deletedAt: null,
    actualR,
    traderOutcome: actualR.startsWith('-') ? 'loss' : 'win',
    actualExitedAt: exitedAt,
    systemStatus: 'resolved',
    systemR,
    systemOutcome: systemR.startsWith('-') ? 'loss' : 'win',
    systemExitedAt,
  };
}

function available(comparison: ReturnType<typeof composeExecutionComparison>) {
  if (comparison.status !== 'available') {
    throw new Error(`Expected an available comparison, received "${comparison.status}".`);
  }
  return comparison;
}

describe('composeExecutionComparison — paired trade series', () => {
  it('orders by Actual exit ascending regardless of input order', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('c', '1.0000', '1.0000', '2026-03-03T10:00:00.000Z'),
          pair('a', '1.0000', '2.0000', '2026-03-01T10:00:00.000Z'),
          pair('b', '2.0000', '1.0000', '2026-03-02T10:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries.map((point) => point.tradeId)).toEqual(['a', 'b', 'c']);
  });

  /**
   * The tie-break is the whole reason the cumulative path is reproducible.
   * Both orderings below contain the same Trades with the same instant, so
   * without a deterministic secondary key the two cumulative sequences would
   * differ while every total stayed identical — the hardest kind of chart bug
   * to notice.
   */
  it('breaks identical Actual exit timestamps by Trade ID, stably', () => {
    const instant = '2026-03-01T10:00:00.000Z';
    const forwards = available(
      composeExecutionComparison(
        [
          pair('trade-a', '1.0000', '0.0000', instant),
          pair('trade-b', '3.0000', '0.0000', instant),
          pair('trade-c', '5.0000', '0.0000', instant),
        ],
        BANGKOK,
      ),
    );
    const backwards = available(
      composeExecutionComparison(
        [
          pair('trade-c', '5.0000', '0.0000', instant),
          pair('trade-b', '3.0000', '0.0000', instant),
          pair('trade-a', '1.0000', '0.0000', instant),
        ],
        BANGKOK,
      ),
    );
    expect(forwards.tradeSeries.map((point) => point.tradeId)).toEqual([
      'trade-a',
      'trade-b',
      'trade-c',
    ]);
    expect(backwards.tradeSeries).toEqual(forwards.tradeSeries);
    expect(forwards.tradeSeries.map((point) => point.cumulativeActualR)).toEqual([
      '1.0000',
      '4.0000',
      '9.0000',
    ]);
  });

  it('carries the canonical per-Trade gap sign', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('under', '1.0000', '3.0000', '2026-03-01T10:00:00.000Z'),
          pair('match', '2.0000', '2.0000', '2026-03-02T10:00:00.000Z'),
          pair('over', '4.0000', '1.0000', '2026-03-03T10:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries.map((point) => point.executionGapR)).toEqual([
      '-2.0000',
      '0.0000',
      '3.0000',
    ]);
  });

  it('accumulates System, Actual and Gap independently and consistently', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '1.0000', '2.0000', '2026-03-01T10:00:00.000Z'),
          pair('t2', '-0.5000', '1.5000', '2026-03-02T10:00:00.000Z'),
          pair('t3', '3.0000', '1.0000', '2026-03-03T10:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries.map((point) => point.cumulativeSystemR)).toEqual([
      '2.0000',
      '3.5000',
      '4.5000',
    ]);
    expect(result.tradeSeries.map((point) => point.cumulativeActualR)).toEqual([
      '1.0000',
      '0.5000',
      '3.5000',
    ]);
    expect(result.tradeSeries.map((point) => point.cumulativeExecutionGapR)).toEqual([
      '-1.0000',
      '-3.0000',
      '-1.0000',
    ]);
  });

  it('holds cumulativeGap = cumulativeActual - cumulativeSystem at every point', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '0.3333', '1.6667', '2026-03-01T10:00:00.000Z'),
          pair('t2', '-1.2500', '0.7500', '2026-03-02T10:00:00.000Z'),
          pair('t3', '2.1250', '-0.3750', '2026-03-03T10:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    for (const point of result.tradeSeries) {
      expect(Number(point.cumulativeExecutionGapR)).toBeCloseTo(
        Number(point.cumulativeActualR) - Number(point.cumulativeSystemR),
        10,
      );
    }
  });

  it('reconciles the final cumulative point with the paired summary totals', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '1.0000', '2.0000', '2026-03-01T10:00:00.000Z'),
          pair('t2', '-0.5000', '1.5000', '2026-03-02T10:00:00.000Z'),
          pair('t3', '3.0000', '1.0000', '2026-03-03T10:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    const last = result.tradeSeries.at(-1);
    expect(last).toBeDefined();
    expect(result.summary.pairedSystemTotalR).toEqual({
      status: 'available',
      value: last?.cumulativeSystemR,
    });
    expect(result.summary.pairedActualTotalR).toEqual({
      status: 'available',
      value: last?.cumulativeActualR,
    });
    expect(result.summary.executionGapR).toEqual({
      status: 'available',
      value: last?.cumulativeExecutionGapR,
    });
  });

  it('keeps the System exit as metadata without letting it reorder anything', () => {
    const result = available(
      composeExecutionComparison(
        [
          // System exits are deliberately in the opposite order to the Actual
          // exits, so a sort that leaked onto the System axis would show.
          pair('first', '1.0000', '1.0000', '2026-03-01T10:00:00.000Z', '2026-03-09T10:00:00.000Z'),
          pair(
            'second',
            '1.0000',
            '1.0000',
            '2026-03-02T10:00:00.000Z',
            '2026-03-08T10:00:00.000Z',
          ),
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries.map((point) => point.tradeId)).toEqual(['first', 'second']);
    expect(result.tradeSeries.map((point) => point.systemExitedAt)).toEqual([
      '2026-03-09T10:00:00.000Z',
      '2026-03-08T10:00:00.000Z',
    ]);
  });

  /**
   * Population C is a same-Trade intersection: a Trade whose Actual side is
   * complete but whose System side is still pending contributes to Trader
   * metrics and to nothing here.
   */
  it('excludes records that are not both-sides complete', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('paired', '1.0000', '2.0000', '2026-03-01T10:00:00.000Z'),
          {
            ...pair('system-pending', '1.0000', '2.0000', '2026-03-02T10:00:00.000Z'),
            systemStatus: 'pending',
            systemR: null,
            systemOutcome: null,
            systemExitedAt: null,
          },
          {
            ...pair('still-open', '1.0000', '2.0000', '2026-03-03T10:00:00.000Z'),
            status: 'open',
            actualR: null,
            traderOutcome: null,
            actualExitedAt: null,
          },
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries.map((point) => point.tradeId)).toEqual(['paired']);
    expect(result.summary.comparableCount).toBe(1);
  });
});

/**
 * D1's bounded Population C contract, exercised at the composer. The DAL
 * applies the range with `dateConditions(trades.exitedAt, ...)`, so what the
 * composer must guarantee is that it never re-gates on the System axis.
 */
describe('composeExecutionComparison — date axis', () => {
  it('includes a pair whose Actual exit is inside the range and System exit outside it', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair(
            'actual-in-system-out',
            '1.0000',
            '2.0000',
            '2026-03-15T10:00:00.000Z',
            '2019-01-01T10:00:00.000Z',
          ),
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries).toHaveLength(1);
    expect(result.tradeSeries[0]?.tradeId).toBe('actual-in-system-out');
  });

  it('buckets and orders on the Actual exit even when the System exit is years away', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('a', '1.0000', '1.0000', '2026-03-02T04:00:00.000Z', '2030-01-01T00:00:00.000Z'),
          pair('b', '1.0000', '1.0000', '2026-03-01T04:00:00.000Z', '2019-01-01T00:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries.map((point) => point.tradeId)).toEqual(['b', 'a']);
    expect(result.dailySeries.map((point) => point.date)).toEqual(['2026-03-01', '2026-03-02']);
  });
});

describe('composeExecutionComparison — daily series', () => {
  it('groups by the analytics timezone local date, not the UTC date', () => {
    // 17:30Z on the 1st is 00:30 on the 2nd in Bangkok (UTC+7).
    const result = available(
      composeExecutionComparison(
        [pair('t1', '1.0000', '1.0000', '2026-03-01T17:30:00.000Z')],
        BANGKOK,
      ),
    );
    expect(result.dailySeries.map((point) => point.date)).toEqual(['2026-03-02']);

    const utc = available(
      composeExecutionComparison(
        [pair('t1', '1.0000', '1.0000', '2026-03-01T17:30:00.000Z')],
        'UTC',
      ),
    );
    expect(utc.dailySeries.map((point) => point.date)).toEqual(['2026-03-01']);
  });

  it('splits a cross-midnight pair into two local days', () => {
    const result = available(
      composeExecutionComparison(
        [
          // 16:59Z -> 23:59 Bangkok on the 1st.
          pair('before', '1.0000', '2.0000', '2026-03-01T16:59:00.000Z'),
          // 17:01Z -> 00:01 Bangkok on the 2nd.
          pair('after', '3.0000', '1.0000', '2026-03-01T17:01:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.dailySeries.map((point) => point.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(result.dailySeries.map((point) => point.pairedTradeCount)).toEqual([1, 1]);
    expect(result.dailySeries.map((point) => point.executionGapR)).toEqual(['-1.0000', '2.0000']);
  });

  it('sums a day with several paired Trades and keeps its count', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '1.0000', '2.0000', '2026-03-01T03:00:00.000Z'),
          pair('t2', '2.5000', '0.5000', '2026-03-01T04:00:00.000Z'),
          pair('t3', '-1.0000', '1.0000', '2026-03-03T04:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.dailySeries).toHaveLength(2);
    expect(result.dailySeries[0]).toMatchObject({
      date: '2026-03-01',
      pairedTradeCount: 2,
      systemR: '2.5000',
      actualR: '3.5000',
      executionGapR: '1.0000',
    });
  });

  /**
   * §6: no artificial zero rows. 2026-03-02 has no paired Trade and must be
   * absent rather than asserted as a day the Trader matched the System.
   */
  it('omits days with no paired Trades instead of zero-filling them', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '1.0000', '1.0000', '2026-03-01T04:00:00.000Z'),
          pair('t2', '1.0000', '1.0000', '2026-03-04T04:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.dailySeries.map((point) => point.date)).toEqual(['2026-03-01', '2026-03-04']);
  });

  it('holds the daily cumulative identity and reconciles with the summary', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '0.3333', '1.6667', '2026-03-01T04:00:00.000Z'),
          pair('t2', '-1.2500', '0.7500', '2026-03-01T05:00:00.000Z'),
          pair('t3', '2.1250', '-0.3750', '2026-03-05T04:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    for (const point of result.dailySeries) {
      expect(Number(point.executionGapR)).toBeCloseTo(
        Number(point.actualR) - Number(point.systemR),
        10,
      );
      expect(Number(point.cumulativeExecutionGapR)).toBeCloseTo(
        Number(point.cumulativeActualR) - Number(point.cumulativeSystemR),
        10,
      );
    }
    const lastDaily = result.dailySeries.at(-1);
    const lastTrade = result.tradeSeries.at(-1);
    expect(lastDaily?.cumulativeSystemR).toBe(lastTrade?.cumulativeSystemR);
    expect(lastDaily?.cumulativeActualR).toBe(lastTrade?.cumulativeActualR);
    expect(lastDaily?.cumulativeExecutionGapR).toBe(lastTrade?.cumulativeExecutionGapR);
    expect(result.summary.executionGapR).toEqual({
      status: 'available',
      value: lastDaily?.cumulativeExecutionGapR,
    });
  });
});

describe('composeExecutionComparison — availability', () => {
  it('reports empty with a semantic reason when nothing is paired', () => {
    const result = composeExecutionComparison([], BANGKOK);
    expect(result.status).toBe('empty');
    if (result.status !== 'empty') throw new Error('unreachable');
    expect(result.reason).toBe('no_comparable_trades');
    expect(result.summary.comparableCount).toBe(0);
    expect(result.summary.executionGapR).toEqual({
      status: 'unavailable',
      reason: 'no_comparable_trades',
    });
  });

  /**
   * §15. A zero or negative System edge makes the CAPTURED RATIO undefined,
   * and nothing else. The series, the Gap and the distribution are all still
   * real and must survive.
   */
  it('keeps the whole comparison available when the paired System total is zero', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('t1', '1.0000', '1.0000', '2026-03-01T04:00:00.000Z'),
          pair('t2', '-2.0000', '-1.0000', '2026-03-02T04:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.summary.pairedSystemTotalR).toEqual({ status: 'available', value: '0.0000' });
    expect(result.summary.systemEdgeCaptured).toEqual({
      status: 'unavailable',
      reason: 'system_has_no_edge',
    });
    expect(result.tradeSeries).toHaveLength(2);
    expect(result.dailySeries).toHaveLength(2);
    // Paired Actual -1.0000 minus paired System 0.0000.
    expect(result.summary.pairedActualTotalR).toEqual({ status: 'available', value: '-1.0000' });
    expect(result.summary.executionGapR).toEqual({ status: 'available', value: '-1.0000' });
  });

  it('keeps the comparison available when the paired System total is negative', () => {
    const result = available(
      composeExecutionComparison(
        [pair('t1', '-3.0000', '-1.0000', '2026-03-01T04:00:00.000Z')],
        BANGKOK,
      ),
    );
    expect(result.summary.pairedSystemTotalR).toEqual({ status: 'available', value: '-1.0000' });
    expect(result.summary.systemEdgeCaptured).toEqual({
      status: 'unavailable',
      reason: 'system_has_no_edge',
    });
    expect(result.tradeSeries).toHaveLength(1);
  });

  it('never clamps System Edge Captured above 100% or below zero', () => {
    const over = available(
      composeExecutionComparison(
        [pair('t1', '4.0000', '2.0000', '2026-03-01T04:00:00.000Z')],
        BANGKOK,
      ),
    );
    expect(over.summary.systemEdgeCaptured).toEqual({ status: 'available', value: '2.0000' });

    const negative = available(
      composeExecutionComparison(
        [pair('t1', '-1.0000', '2.0000', '2026-03-01T04:00:00.000Z')],
        BANGKOK,
      ),
    );
    expect(negative.summary.systemEdgeCaptured).toEqual({
      status: 'available',
      value: '-0.5000',
    });
  });

  it('reports a data-integrity error rather than a silent gap when an R will not parse', () => {
    const result = composeExecutionComparison(
      [
        pair('good', '1.0000', '1.0000', '2026-03-01T04:00:00.000Z'),
        { ...pair('bad', '1.0000', '1.0000', '2026-03-02T04:00:00.000Z'), actualR: 'not-a-number' },
      ],
      BANGKOK,
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('unreachable');
    expect(result.reason).toBe('data_integrity_error');
    // The summary is still handed back so the caller can say something true.
    expect(result.summary.comparableCount).toBe(2);
  });

  it('reports a data-integrity error for an unusable timezone', () => {
    const result = composeExecutionComparison(
      [pair('t1', '1.0000', '1.0000', '2026-03-01T04:00:00.000Z')],
      'Not/AZone',
    );
    expect(result.status).toBe('error');
  });

  it('reports a data-integrity error for an unparseable Actual exit', () => {
    const result = composeExecutionComparison(
      [pair('t1', '1.0000', '1.0000', 'not-a-timestamp')],
      BANGKOK,
    );
    expect(result.status).toBe('error');
  });
});

describe('composeExecutionComparison — Gap distribution', () => {
  it('counts underperformance, exact matches and outperformance', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('a', '1.0000', '3.0000', '2026-03-01T04:00:00.000Z'),
          pair('b', '0.5000', '2.0000', '2026-03-02T04:00:00.000Z'),
          pair('c', '2.0000', '2.0000', '2026-03-03T04:00:00.000Z'),
          pair('d', '4.0000', '1.0000', '2026-03-04T04:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.distribution.underperformedCount).toBe(2);
    expect(result.distribution.matchedCount).toBe(1);
    expect(result.distribution.outperformedCount).toBe(1);
    expect(
      result.distribution.underperformedCount +
        result.distribution.matchedCount +
        result.distribution.outperformedCount,
    ).toBe(result.summary.comparableCount);
  });

  /**
   * `matched` is exact, never the break-even tolerance band. A -0.0400R
   * execution difference is a real difference, and calling it "matched the
   * System" would be a different claim about a different quantity.
   */
  it('treats a sub-tolerance gap as underperformance, not a match', () => {
    const result = available(
      composeExecutionComparison(
        [pair('a', '1.9600', '2.0000', '2026-03-01T04:00:00.000Z')],
        BANGKOK,
      ),
    );
    expect(result.distribution.matchedCount).toBe(0);
    expect(result.distribution.underperformedCount).toBe(1);
  });

  it('exposes the extremes of the paired Gap as neutral facts', () => {
    const result = available(
      composeExecutionComparison(
        [
          pair('a', '1.0000', '3.0000', '2026-03-01T04:00:00.000Z'),
          pair('b', '5.0000', '1.0000', '2026-03-02T04:00:00.000Z'),
          pair('c', '2.0000', '2.0000', '2026-03-03T04:00:00.000Z'),
        ],
        BANGKOK,
      ),
    );
    expect(result.distribution.minimumExecutionGapR).toEqual({
      status: 'available',
      value: '-2.0000',
    });
    expect(result.distribution.maximumExecutionGapR).toEqual({
      status: 'available',
      value: '4.0000',
    });
  });
});

/**
 * §16. A partially closed position is still ONE Trade with one canonical
 * Actual R, so it contributes exactly one series point. The composer reads
 * Trade-level records and never sees an exit leg, which is what makes this
 * true by construction rather than by filtering.
 */
describe('composeExecutionComparison — partial closes', () => {
  it('emits one series point per Trade, never one per exit leg', () => {
    const result = available(
      composeExecutionComparison(
        [pair('partially-closed', '1.7500', '2.0000', '2026-03-01T04:00:00.000Z')],
        BANGKOK,
      ),
    );
    expect(result.tradeSeries).toHaveLength(1);
    expect(result.tradeSeries[0]).toMatchObject({
      tradeId: 'partially-closed',
      actualR: '1.7500',
      executionGapR: '-0.2500',
    });
    expect(result.dailySeries).toHaveLength(1);
    expect(result.dailySeries[0]?.pairedTradeCount).toBe(1);
  });
});
