import { describe, expect, it } from 'vitest';

import {
  composeCalendarGapMonth,
  composeCalendarPerformanceMonth,
  isCalendarMode,
  type CalendarActualRecord,
  type CalendarGapDay,
  type CalendarMonthModel,
  type CalendarPairedRecord,
  type CalendarPerformanceDay,
  type CalendarSystemRecord,
} from './calendar';

const BANGKOK = 'Asia/Bangkok';
const NEW_YORK = 'America/New_York';

function actual(
  tradeId: string,
  exitedAt: string,
  actualR: string,
  traderOutcome: 'win' | 'loss' | 'break_even' = actualROutcome(actualR),
): CalendarActualRecord {
  return { tradeId, exitedAt, actualR, traderOutcome };
}

function actualROutcome(value: string): 'win' | 'loss' | 'break_even' {
  if (value.startsWith('-')) return 'loss';
  return Number(value) === 0 ? 'break_even' : 'win';
}

function system(tradeId: string, systemExitedAt: string, systemR: string): CalendarSystemRecord {
  return { tradeId, systemExitedAt, systemR, systemOutcome: actualROutcome(systemR) };
}

function paired(
  tradeId: string,
  exitedAt: string,
  actualR: string,
  systemR: string,
  systemExitedAt = exitedAt,
): CalendarPairedRecord {
  return { tradeId, exitedAt, systemExitedAt, actualR, systemR };
}

function available(model: CalendarMonthModel) {
  if (model.status !== 'available') {
    throw new Error(`Expected an available month, received "${model.status}".`);
  }
  return model;
}

const ACTUAL_REQUEST = { mode: 'actual', year: 2026, month: 3, timezone: BANGKOK } as const;
const SYSTEM_REQUEST = { mode: 'system', year: 2026, month: 3, timezone: BANGKOK } as const;
const GAP_REQUEST = { mode: 'gap', year: 2026, month: 3, timezone: BANGKOK } as const;

describe('calendar modes', () => {
  it('recognises exactly the three canonical modes', () => {
    expect(isCalendarMode('actual')).toBe(true);
    expect(isCalendarMode('system')).toBe(true);
    expect(isCalendarMode('gap')).toBe(true);
    expect(isCalendarMode('trader')).toBe(false);
    expect(isCalendarMode('')).toBe(false);
    expect(isCalendarMode(undefined)).toBe(false);
  });
});

describe('Actual calendar month', () => {
  it('groups by local date and totals the day', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('a', '2026-03-02T03:00:00.000Z', '2.0000'),
        actual('b', '2026-03-02T09:00:00.000Z', '-0.5000'),
        actual('c', '2026-03-05T03:00:00.000Z', '-1.0000'),
      ]),
    );
    expect(month.days).toHaveLength(2);
    expect(month.days[0]).toMatchObject({
      mode: 'actual',
      date: '2026-03-02',
      eligibleTradeCount: 2,
      totalR: '1.5000',
      wins: 1,
      losses: 1,
      breakEvens: 0,
      classification: 'winning',
    });
    expect(month.days[1]).toMatchObject({ date: '2026-03-05', classification: 'losing' });
  });

  /**
   * §10 — the day's verdict follows its TOTAL R, not which outcome won a
   * majority of the Trades. Two losses and one larger win is a winning day.
   */
  it('classifies by total R, never by majority outcome', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('a', '2026-03-02T03:00:00.000Z', '-1.0000'),
        actual('b', '2026-03-02T04:00:00.000Z', '-1.0000'),
        actual('c', '2026-03-02T05:00:00.000Z', '4.0000'),
      ]),
    );
    const day = month.days[0] as CalendarPerformanceDay;
    expect(day.losses).toBe(2);
    expect(day.wins).toBe(1);
    expect(day.totalR).toBe('2.0000');
    expect(day.classification).toBe('winning');
  });

  it('treats an exactly flat day as break-even, not winning or losing', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('a', '2026-03-02T03:00:00.000Z', '1.5000'),
        actual('b', '2026-03-02T04:00:00.000Z', '-1.5000'),
      ]),
    );
    expect(month.days[0]).toMatchObject({ totalR: '0.0000', classification: 'break_even' });
    expect(month.totals.classifiedDayCounts).toEqual({ positive: 0, neutral: 1, negative: 0 });
  });

  /**
   * §11 — a day with nothing eligible is NOT a 0R day. Only populated dates
   * appear; the visual grid builds the blanks.
   */
  it('emits only populated dates, never a zero row for an empty day', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('a', '2026-03-02T03:00:00.000Z', '1.0000'),
        actual('b', '2026-03-20T03:00:00.000Z', '1.0000'),
      ]),
    );
    expect(month.days.map((day) => day.date)).toEqual(['2026-03-02', '2026-03-20']);
    expect(month.totals.populatedDayCount).toBe(2);
  });

  it('reports an empty month rather than an error when nothing is eligible', () => {
    const month = composeCalendarPerformanceMonth(ACTUAL_REQUEST, []);
    expect(month.status).toBe('empty');
    if (month.status !== 'empty') throw new Error('unreachable');
    expect(month.reason).toBe('no_eligible_trades');
  });

  it('reconciles the month total with the sum of its days', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('a', '2026-03-02T03:00:00.000Z', '2.2500'),
        actual('b', '2026-03-05T03:00:00.000Z', '-1.7500'),
        actual('c', '2026-03-09T03:00:00.000Z', '0.5000'),
      ]),
    );
    const summed = month.days.reduce(
      (total, day) => total + Number((day as CalendarPerformanceDay).totalR),
      0,
    );
    expect(Number(month.totals.totalR)).toBeCloseTo(summed, 10);
    expect(month.totals.eligibleTradeCount).toBe(3);
  });

  it('reports a data-integrity error on an unparseable R rather than dropping a day', () => {
    const month = composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
      actual('a', '2026-03-02T03:00:00.000Z', 'not-a-number'),
    ]);
    expect(month.status).toBe('error');
  });
});

describe('System calendar month', () => {
  it('buckets on system_exited_at, never on the Actual exit', () => {
    const month = available(
      composeCalendarPerformanceMonth(SYSTEM_REQUEST, [
        system('a', '2026-03-04T03:00:00.000Z', '3.0000'),
        system('b', '2026-03-04T06:00:00.000Z', '-1.0000'),
      ]),
    );
    expect(month.days[0]).toMatchObject({
      mode: 'system',
      date: '2026-03-04',
      eligibleTradeCount: 2,
      totalR: '2.0000',
    });
  });

  /**
   * §8 — the same Trade may legitimately fall on a different local day in
   * each mode. Nothing forces the two axes into alignment.
   */
  it('lets one Trade land on different local days in Actual and System modes', () => {
    // 17:30Z is 00:30 the next day in Bangkok; 16:30Z is still the same day.
    const actualMonth = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('same-trade', '2026-03-02T16:30:00.000Z', '1.0000'),
      ]),
    );
    const systemMonth = available(
      composeCalendarPerformanceMonth(SYSTEM_REQUEST, [
        system('same-trade', '2026-03-02T17:30:00.000Z', '1.0000'),
      ]),
    );
    expect(actualMonth.days[0]?.date).toBe('2026-03-02');
    expect(systemMonth.days[0]?.date).toBe('2026-03-03');
  });
});

describe('Gap calendar month', () => {
  it('anchors on the Actual exit and never on the System exit', () => {
    const month = available(
      composeCalendarGapMonth(GAP_REQUEST, [
        // Actual 2 March in Bangkok; System exit is a different day entirely.
        paired('a', '2026-03-02T03:00:00.000Z', '1.0000', '3.0000', '2026-03-09T03:00:00.000Z'),
      ]),
    );
    expect(month.days).toHaveLength(1);
    expect(month.days[0]?.date).toBe('2026-03-02');
  });

  it('sums paired System, paired Actual and the Gap per day', () => {
    const month = available(
      composeCalendarGapMonth(GAP_REQUEST, [
        paired('a', '2026-03-02T03:00:00.000Z', '1.0000', '3.0000'),
        paired('b', '2026-03-02T04:00:00.000Z', '2.5000', '0.5000'),
      ]),
    );
    const day = month.days[0] as CalendarGapDay;
    expect(day).toMatchObject({
      mode: 'gap',
      pairedTradeCount: 2,
      systemR: '3.5000',
      actualR: '3.5000',
      gapR: '0.0000',
      classification: 'matched',
    });
    expect(day.underperformedCount).toBe(1);
    expect(day.outperformedCount).toBe(1);
    expect(day.matchedCount).toBe(0);
  });

  /**
   * §10 — Gap days are never "winning" or "losing". A day the account LOST
   * money on can still be a day the Trader outperformed the System.
   */
  it('uses relative execution vocabulary, not winning and losing', () => {
    const month = available(
      composeCalendarGapMonth(GAP_REQUEST, [
        // Actual is negative, yet it beat an even more negative System.
        paired('a', '2026-03-02T03:00:00.000Z', '-1.0000', '-3.0000'),
      ]),
    );
    const day = month.days[0] as CalendarGapDay;
    expect(day.actualR).toBe('-1.0000');
    expect(day.gapR).toBe('2.0000');
    expect(day.classification).toBe('outperformed');
    expect(['winning', 'losing', 'break_even']).not.toContain(day.classification);
  });

  it('reconciles the month Gap with actual minus system across days', () => {
    const month = available(
      composeCalendarGapMonth(GAP_REQUEST, [
        paired('a', '2026-03-02T03:00:00.000Z', '1.0000', '3.0000'),
        paired('b', '2026-03-06T03:00:00.000Z', '4.0000', '1.0000'),
      ]),
    );
    const gapSum = month.days.reduce(
      (total, day) => total + Number((day as CalendarGapDay).gapR),
      0,
    );
    expect(Number(month.totals.totalR)).toBeCloseTo(gapSum, 10);
    expect(month.totals.totalR).toBe('1.0000');
    expect(month.totals.eligibleTradeCount).toBe(2);
  });

  it('reports an empty Gap month rather than an error when nothing is paired', () => {
    expect(composeCalendarGapMonth(GAP_REQUEST, []).status).toBe('empty');
  });
});

/**
 * §5 / §26 — month and day boundaries are the USER's, never UTC's and never
 * the machine's. These are the cases where the two genuinely disagree.
 */
describe('timezone and month boundaries', () => {
  it('moves a late-evening UTC instant into the next Bangkok day', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('before', '2026-03-02T16:59:00.000Z', '1.0000'),
        actual('after', '2026-03-02T17:01:00.000Z', '1.0000'),
      ]),
    );
    expect(month.days.map((day) => day.date)).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('keeps the same instant on the same UTC day when UTC is the configured zone', () => {
    const month = available(
      composeCalendarPerformanceMonth({ ...ACTUAL_REQUEST, timezone: 'UTC' }, [
        actual('a', '2026-03-02T17:30:00.000Z', '1.0000'),
      ]),
    );
    expect(month.days[0]?.date).toBe('2026-03-02');
  });

  /**
   * A month boundary is where naive UTC bucketing does real damage: this
   * instant is 1 April in UTC but still 31 March in New York.
   */
  it('keeps a UTC-next-month instant on the previous local day in New York', () => {
    const month = available(
      composeCalendarPerformanceMonth(
        { mode: 'actual', year: 2026, month: 3, timezone: NEW_YORK },
        [actual('a', '2026-04-01T02:00:00.000Z', '1.0000')],
      ),
    );
    expect(month.days[0]?.date).toBe('2026-03-31');
  });

  /**
   * US DST began 8 March 2026. An instant just after the spring-forward must
   * still land on the correct local date, which a fixed-offset calculation
   * would get wrong by an hour.
   */
  it('resolves local dates correctly across a DST transition', () => {
    const month = available(
      composeCalendarPerformanceMonth(
        { mode: 'actual', year: 2026, month: 3, timezone: NEW_YORK },
        [
          // 06:30Z on 8 March = 01:30 EST, before the 02:00 spring-forward.
          actual('before-dst', '2026-03-08T06:30:00.000Z', '1.0000'),
          // 07:30Z the same day = 03:30 EDT, after it.
          actual('after-dst', '2026-03-08T07:30:00.000Z', '1.0000'),
          // 03:30Z on 9 March = 23:30 EDT on 8 March — still the 8th locally.
          actual('late-evening', '2026-03-09T03:30:00.000Z', '1.0000'),
        ],
      ),
    );
    expect(month.days).toHaveLength(1);
    expect(month.days[0]).toMatchObject({ date: '2026-03-08', eligibleTradeCount: 3 });
  });

  it('reports an integrity error for an unusable timezone rather than guessing', () => {
    const month = composeCalendarPerformanceMonth({ ...ACTUAL_REQUEST, timezone: 'Not/AZone' }, [
      actual('a', '2026-03-02T03:00:00.000Z', '1.0000'),
    ]);
    expect(month.status).toBe('error');
  });
});

/**
 * §21 — Calendar performance counts POSITIONS. The composer receives
 * Trade-level records and never sees an exit leg, so a partially closed
 * position is one Trade here however many times it was scaled out of.
 */
describe('partial closes', () => {
  it('counts one partially closed position as exactly one Trade', () => {
    const month = available(
      composeCalendarPerformanceMonth(ACTUAL_REQUEST, [
        actual('partially-closed', '2026-03-02T03:00:00.000Z', '1.7500'),
      ]),
    );
    expect(month.days[0]).toMatchObject({ eligibleTradeCount: 1, totalR: '1.7500' });
    expect(month.totals.eligibleTradeCount).toBe(1);
  });
});
