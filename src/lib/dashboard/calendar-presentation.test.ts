import { describe, expect, it } from 'vitest';

import type { CalendarGapDay, CalendarMonthModel, CalendarPerformanceDay } from './calendar';
import {
  calendarDayClassificationKey,
  calendarDayPrimaryR,
  calendarDayTone,
  calendarDayTradeCount,
  calendarMonthDays,
} from './calendar-presentation';

const performance = (overrides: Partial<CalendarPerformanceDay> = {}): CalendarPerformanceDay => ({
  mode: 'actual',
  date: '2026-03-05',
  eligibleTradeCount: 3,
  totalR: '1.5000',
  wins: 2,
  breakEvens: 0,
  losses: 1,
  classification: 'winning',
  ...overrides,
});

const gap = (overrides: Partial<CalendarGapDay> = {}): CalendarGapDay => ({
  mode: 'gap',
  date: '2026-03-05',
  pairedTradeCount: 2,
  systemR: '4.0000',
  actualR: '1.5000',
  gapR: '-2.5000',
  classification: 'underperformed',
  underperformedCount: 2,
  matchedCount: 0,
  outperformedCount: 0,
  ...overrides,
});

describe('calendar day tone', () => {
  it.each([
    ['winning', 'positive'],
    ['break_even', 'neutral'],
    ['losing', 'negative'],
  ] as const)('maps a %s performance day to %s', (classification, tone) => {
    expect(calendarDayTone(performance({ classification }))).toBe(tone);
  });

  it.each([
    ['outperformed', 'positive'],
    ['matched', 'neutral'],
    ['underperformed', 'negative'],
  ] as const)('maps an %s gap day to %s', (classification, tone) => {
    expect(calendarDayTone(gap({ classification }))).toBe(tone);
  });

  /**
   * §7 — the vocabularies must never merge. A Gap day shares a DIRECTION with
   * a performance day and nothing else: a day the account lost money on can
   * still be a day the Trader outperformed the System, so a key that would
   * render "winning" over a Gap cell is a false claim.
   */
  it('namespaces the classification key by mode so a Gap day is never "winning"', () => {
    expect(calendarDayClassificationKey(performance())).toBe('performance.winning');
    expect(calendarDayClassificationKey(gap())).toBe('gap.underperformed');
    expect(calendarDayClassificationKey(gap({ classification: 'outperformed' }))).not.toContain(
      'winning',
    );
  });
});

describe('calendar day figures', () => {
  it('leads a performance day with its total R and its eligible count', () => {
    expect(calendarDayPrimaryR(performance())).toBe('1.5000');
    expect(calendarDayTradeCount(performance())).toBe(3);
  });

  it('leads a gap day with its Gap R and its paired count', () => {
    expect(calendarDayPrimaryR(gap())).toBe('-2.5000');
    expect(calendarDayTradeCount(gap())).toBe(2);
  });
});

describe('month day extraction', () => {
  const base = { mode: 'actual', year: 2026, month: 3, timezone: 'Asia/Bangkok' } as const;

  it('returns the days of an available month', () => {
    const month: CalendarMonthModel = {
      status: 'available',
      ...base,
      days: [performance()],
      totals: {
        populatedDayCount: 1,
        eligibleTradeCount: 3,
        totalR: '1.5000',
        classifiedDayCounts: { positive: 1, neutral: 0, negative: 0 },
      },
    };
    expect(calendarMonthDays(month)).toHaveLength(1);
  });

  it('returns nothing for empty and error months without conflating them', () => {
    const empty: CalendarMonthModel = { status: 'empty', reason: 'no_eligible_trades', ...base };
    const error: CalendarMonthModel = { status: 'error', reason: 'data_integrity_error', ...base };
    expect(calendarMonthDays(empty)).toEqual([]);
    expect(calendarMonthDays(error)).toEqual([]);
    expect(empty.status).not.toBe(error.status);
  });
});
