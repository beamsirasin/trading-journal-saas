import { describe, expect, it } from 'vitest';

import type { CalendarGapDay, CalendarPerformanceDay } from './calendar';
import {
  composeDayReview,
  reconcileDayReview,
  type DayReviewData,
  type DayReviewRecord,
} from './day-review';

const DATE = '2026-03-05';
const BANGKOK = 'Asia/Bangkok';

function record(
  tradeId: string,
  axisAt: string,
  actualR: string | null,
  systemR: string | null,
  overrides: Partial<DayReviewRecord> = {},
): DayReviewRecord {
  return {
    tradeId,
    occurredAt: axisAt,
    axisAt,
    symbol: 'XAUUSD',
    direction: 'long',
    tradingAccountName: 'Primary',
    status: 'closed',
    traderOutcome: actualR === null ? null : actualR.startsWith('-') ? 'loss' : 'win',
    actualR,
    actualExitedAt: actualR === null ? null : axisAt,
    systemStatus: systemR === null ? 'pending' : 'resolved',
    systemOutcome: systemR === null ? null : systemR.startsWith('-') ? 'loss' : 'win',
    systemR,
    systemExitedAt: systemR === null ? null : axisAt,
    strategyName: 'Momentum v1',
    setupName: 'Retest',
    ...overrides,
  };
}

const ACTUAL_DAY: CalendarPerformanceDay = {
  mode: 'actual',
  date: DATE,
  eligibleTradeCount: 2,
  totalR: '1.5000',
  wins: 1,
  breakEvens: 0,
  losses: 1,
  classification: 'winning',
};

const GAP_DAY: CalendarGapDay = {
  mode: 'gap',
  date: DATE,
  pairedTradeCount: 2,
  systemR: '4.0000',
  actualR: '1.5000',
  gapR: '-2.5000',
  classification: 'underperformed',
  underperformedCount: 2,
  matchedCount: 0,
  outperformedCount: 0,
};

function available(review: DayReviewData) {
  if (review.status !== 'available') {
    throw new Error(`Expected an available Day Review, received "${review.status}".`);
  }
  return review;
}

describe('Day Review composition', () => {
  it('states the mode and date back, and takes its headline from the Calendar day', () => {
    const review = available(
      composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, ACTUAL_DAY, [
        record('a', '2026-03-05T03:00:00.000Z', '2.0000', '3.0000'),
        record('b', '2026-03-05T06:00:00.000Z', '-0.5000', '1.0000'),
      ]),
    );
    expect(review.mode).toBe('actual');
    expect(review.date).toBe(DATE);
    expect(review.headline).toEqual({
      mode: 'actual',
      totalR: '1.5000',
      eligibleTradeCount: 2,
      wins: 1,
      breakEvens: 0,
      losses: 1,
      classification: 'winning',
    });
  });

  /**
   * §13 — the headline is the clicked square's own numbers, so the panel and
   * the cell cannot disagree. This asserts they also reconcile with the rows.
   */
  it('reconciles the rows with the headline in Actual mode', () => {
    const review = composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, ACTUAL_DAY, [
      record('a', '2026-03-05T03:00:00.000Z', '2.0000', '3.0000'),
      record('b', '2026-03-05T06:00:00.000Z', '-0.5000', '1.0000'),
    ]);
    expect(reconcileDayReview(review)).toBe(true);
  });

  it('reconciles the rows with the headline in Gap mode', () => {
    const review = composeDayReview({ mode: 'gap', date: DATE, timezone: BANGKOK }, GAP_DAY, [
      record('a', '2026-03-05T03:00:00.000Z', '1.0000', '3.0000'),
      record('b', '2026-03-05T06:00:00.000Z', '0.5000', '1.0000'),
    ]);
    expect(reconcileDayReview(review)).toBe(true);
    const headline = available(review).headline;
    expect(headline).toMatchObject({
      mode: 'gap',
      gapR: '-2.5000',
      classification: 'underperformed',
    });
  });

  it('orders rows by this mode axis, then Trade ID, deterministically', () => {
    const instant = '2026-03-05T03:00:00.000Z';
    const forwards = available(
      composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, ACTUAL_DAY, [
        record('trade-b', instant, '1.0000', '1.0000'),
        record('trade-a', instant, '0.5000', '1.0000'),
      ]),
    );
    expect(forwards.trades.map((row) => row.tradeId)).toEqual(['trade-a', 'trade-b']);
  });

  /**
   * §13 — rows carry the canonical three-state Gap from the SAME composer the
   * Dashboard's Recent Trades uses, so an unresolved System stays unresolved
   * rather than becoming a zero.
   */
  it('preserves an unresolved System state on a row instead of inventing a Gap', () => {
    const day: CalendarPerformanceDay = { ...ACTUAL_DAY, eligibleTradeCount: 1, totalR: '2.0000' };
    const review = available(
      composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, day, [
        record('a', '2026-03-05T03:00:00.000Z', '2.0000', null),
      ]),
    );
    const row = review.trades[0];
    expect(row?.systemR).toBeNull();
    expect(row?.executionGapR).toEqual({ status: 'unavailable', reason: 'system_incomplete' });
  });

  it('carries a stable Trade ID for the Quick Preview boundary', () => {
    const review = available(
      composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, ACTUAL_DAY, [
        record('a', '2026-03-05T03:00:00.000Z', '2.0000', '3.0000'),
        record('b', '2026-03-05T06:00:00.000Z', '-0.5000', '1.0000'),
      ]),
    );
    for (const row of review.trades) {
      expect(typeof row.tradeId).toBe('string');
      expect(row.tradeId.length).toBeGreaterThan(0);
    }
    expect(new Set(review.trades.map((row) => row.tradeId)).size).toBe(review.trades.length);
  });

  /**
   * §21 — one position is one row. The composer never sees an exit leg, so
   * this holds by construction rather than by filtering.
   */
  it('emits one row per Trade, never one per exit leg', () => {
    const day: CalendarPerformanceDay = { ...ACTUAL_DAY, eligibleTradeCount: 1, totalR: '1.7500' };
    const review = available(
      composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, day, [
        record('partially-closed', '2026-03-05T03:00:00.000Z', '1.7500', '2.0000'),
      ]),
    );
    expect(review.trades).toHaveLength(1);
    expect(reconcileDayReview(review)).toBe(true);
  });
});

describe('Day Review availability', () => {
  it('reports empty when the day carries nothing eligible', () => {
    const review = composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, null, []);
    expect(review.status).toBe('empty');
    if (review.status !== 'empty') throw new Error('unreachable');
    expect(review.reason).toBe('no_eligible_trades');
    expect(review.date).toBe(DATE);
  });

  /**
   * A mismatch here would render one day's totals above another day's rows —
   * the exact silent substitution §12 forbids.
   */
  it('refuses to render one day headline above another day rows', () => {
    const otherDay: CalendarPerformanceDay = { ...ACTUAL_DAY, date: '2026-03-06' };
    const review = composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, otherDay, [
      record('a', '2026-03-05T03:00:00.000Z', '2.0000', '3.0000'),
    ]);
    expect(review.status).toBe('error');
  });

  it('refuses a Calendar day from a different mode', () => {
    const review = composeDayReview({ mode: 'gap', date: DATE, timezone: BANGKOK }, ACTUAL_DAY, [
      record('a', '2026-03-05T03:00:00.000Z', '2.0000', '3.0000'),
    ]);
    expect(review.status).toBe('error');
  });

  it('reports an integrity error on an unusable axis timestamp', () => {
    const review = composeDayReview({ mode: 'actual', date: DATE, timezone: BANGKOK }, ACTUAL_DAY, [
      record('a', 'not-a-timestamp', '2.0000', '3.0000'),
    ]);
    expect(review.status).toBe('error');
  });
});
