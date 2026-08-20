import { describe, expect, it } from 'vitest';

import {
  calendarDateIn,
  dayRangeIn,
  daysInMonth,
  endOfDayExclusiveIn,
  monthRangeIn,
  parseCalendarParts,
  startOfDayIn,
  wallClockToInstant,
} from './convert';
import type { TimeResult } from './types';

function expectOk<T>(result: TimeResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function expectErrCode<T>(result: TimeResult<T>): string {
  if (result.ok) {
    throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  }
  return result.error.code;
}

describe('calendarDateIn — the day-bucketing contract', () => {
  it('agrees with UTC when the zone is UTC', () => {
    expect(expectOk(calendarDateIn(new Date('2026-07-31T23:30:00Z'), 'UTC'))).toBe('2026-07-31');
  });

  it('puts a late-evening Bangkok trade on the Bangkok day, not the UTC day', () => {
    // 2026-07-31 23:30 in Bangkok is 16:30Z on the same UTC day.
    const instant = new Date('2026-07-31T16:30:00Z');
    expect(expectOk(calendarDateIn(instant, 'Asia/Bangkok'))).toBe('2026-07-31');
    expect(expectOk(calendarDateIn(instant, 'UTC'))).toBe('2026-07-31');
  });

  it('rolls a Bangkok trade into the next day before UTC does', () => {
    // 17:00Z is 00:00 the following day in Bangkok. This is the exact case
    // that silently shifts trades between days when bucketing uses UTC.
    const instant = new Date('2026-07-31T17:00:00Z');
    expect(expectOk(calendarDateIn(instant, 'Asia/Bangkok'))).toBe('2026-08-01');
    expect(expectOk(calendarDateIn(instant, 'UTC'))).toBe('2026-07-31');
  });

  it('keeps a New York evening trade on the previous UTC day', () => {
    // 2026-07-31 20:00 EDT is 2026-08-01 00:00Z.
    const instant = new Date('2026-08-01T00:00:00Z');
    expect(expectOk(calendarDateIn(instant, 'America/New_York'))).toBe('2026-07-31');
    expect(expectOk(calendarDateIn(instant, 'UTC'))).toBe('2026-08-01');
  });

  it('crosses a year boundary correctly', () => {
    const instant = new Date('2026-12-31T17:00:00Z');
    expect(expectOk(calendarDateIn(instant, 'Asia/Bangkok'))).toBe('2027-01-01');
    expect(expectOk(calendarDateIn(instant, 'UTC'))).toBe('2026-12-31');
  });

  it('rejects an invalid timezone', () => {
    expect(expectErrCode(calendarDateIn(new Date('2026-07-31T00:00:00Z'), 'Nope/Nowhere'))).toBe(
      'invalid_timezone',
    );
  });

  it('rejects an invalid instant', () => {
    expect(expectErrCode(calendarDateIn(new Date('not a date'), 'UTC'))).toBe('invalid_timestamp');
  });
});

describe('wallClockToInstant', () => {
  it('round-trips a UTC wall clock', () => {
    const instant = expectOk(
      wallClockToInstant({ year: 2026, month: 7, day: 31, hour: 10, minute: 0, second: 0 }, 'UTC'),
    );
    expect(instant.toISOString()).toBe('2026-07-31T10:00:00.000Z');
  });

  it('applies a fixed offset for Bangkok', () => {
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 7, day: 31, hour: 10, minute: 0, second: 0 },
        'Asia/Bangkok',
      ),
    );
    expect(instant.toISOString()).toBe('2026-07-31T03:00:00.000Z');
  });

  it('applies the summer offset for New York', () => {
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 7, day: 31, hour: 10, minute: 0, second: 0 },
        'America/New_York',
      ),
    );
    expect(instant.toISOString()).toBe('2026-07-31T14:00:00.000Z');
  });

  it('applies the winter offset for New York', () => {
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 1, day: 31, hour: 10, minute: 0, second: 0 },
        'America/New_York',
      ),
    );
    expect(instant.toISOString()).toBe('2026-01-31T15:00:00.000Z');
  });

  it('rejects an invalid timezone', () => {
    const result = wallClockToInstant(
      { year: 2026, month: 7, day: 31, hour: 10, minute: 0, second: 0 },
      'Nope/Nowhere',
    );
    expect(expectErrCode(result)).toBe('invalid_timezone');
  });

  it('rejects an out-of-range wall clock', () => {
    const result = wallClockToInstant(
      { year: 2026, month: 13, day: 31, hour: 10, minute: 0, second: 0 },
      'UTC',
    );
    expect(expectErrCode(result)).toBe('invalid_wall_clock');
  });

  it('rejects an impossible calendar date instead of treating it as a DST gap', () => {
    const result = wallClockToInstant(
      { year: 2026, month: 2, day: 30, hour: 10, minute: 0, second: 0 },
      'UTC',
    );
    expect(expectErrCode(result)).toBe('invalid_wall_clock');
  });

  it('accepts a real leap-day wall clock', () => {
    const instant = expectOk(
      wallClockToInstant({ year: 2028, month: 2, day: 29, hour: 10, minute: 0, second: 0 }, 'UTC'),
    );
    expect(instant.toISOString()).toBe('2028-02-29T10:00:00.000Z');
  });
});

describe('wallClockToInstant — DST edges', () => {
  // New York 2026: spring forward 08 March (02:00 -> 03:00),
  //                fall back 01 November (02:00 -> 01:00).

  it('resolves an ambiguous fall-back time to the earlier instant by default', () => {
    // 01:30 on 01 Nov 2026 occurs twice: 05:30Z (EDT) and 06:30Z (EST).
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
        'America/New_York',
      ),
    );
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('resolves an ambiguous time to the later instant when asked', () => {
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
        'America/New_York',
        { ambiguous: 'later' },
      ),
    );
    expect(instant.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('skips past a nonexistent spring-forward time by default', () => {
    // 02:30 on 08 March 2026 never happens; the clock jumps 02:00 -> 03:00.
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
        'America/New_York',
      ),
    );
    // Lands at 03:30 EDT, which is 07:30Z.
    expect(instant.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('maps a nonexistent time backwards when asked', () => {
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
        'America/New_York',
        { nonexistent: 'before-gap' },
      ),
    );
    expect(instant.toISOString()).toBe('2026-03-08T06:30:00.000Z');
  });

  it('is unaffected in a zone without DST', () => {
    const instant = expectOk(
      wallClockToInstant(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
        'Asia/Bangkok',
      ),
    );
    expect(instant.toISOString()).toBe('2026-03-07T19:30:00.000Z');
  });
});

describe('startOfDayIn and endOfDayExclusiveIn', () => {
  it('computes a UTC day boundary', () => {
    expect(expectOk(startOfDayIn('2026-07-31', 'UTC')).toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
    expect(expectOk(endOfDayExclusiveIn('2026-07-31', 'UTC')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('computes a Bangkok day boundary offset by seven hours', () => {
    expect(expectOk(startOfDayIn('2026-07-31', 'Asia/Bangkok')).toISOString()).toBe(
      '2026-07-30T17:00:00.000Z',
    );
    expect(expectOk(endOfDayExclusiveIn('2026-07-31', 'Asia/Bangkok')).toISOString()).toBe(
      '2026-07-31T17:00:00.000Z',
    );
  });

  it('produces a 23-hour day on spring-forward', () => {
    const range = expectOk(dayRangeIn('2026-03-08', 'America/New_York'));
    const hours = (range.end.getTime() - range.start.getTime()) / 3_600_000;
    expect(hours).toBe(23);
  });

  it('produces a 25-hour day on fall-back', () => {
    const range = expectOk(dayRangeIn('2026-11-01', 'America/New_York'));
    const hours = (range.end.getTime() - range.start.getTime()) / 3_600_000;
    expect(hours).toBe(25);
  });

  it('produces a 24-hour day in a zone without DST', () => {
    const range = expectOk(dayRangeIn('2026-03-08', 'Asia/Bangkok'));
    const hours = (range.end.getTime() - range.start.getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });

  it('spans month and year boundaries', () => {
    expect(expectOk(endOfDayExclusiveIn('2026-01-31', 'UTC')).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(expectOk(endOfDayExclusiveIn('2026-12-31', 'UTC')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('handles a leap day', () => {
    expect(expectOk(endOfDayExclusiveIn('2028-02-28', 'UTC')).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(expectOk(endOfDayExclusiveIn('2028-02-29', 'UTC')).toISOString()).toBe(
      '2028-03-01T00:00:00.000Z',
    );
  });

  it('makes the range half-open, so consecutive days do not overlap', () => {
    const first = expectOk(dayRangeIn('2026-07-31', 'Asia/Bangkok'));
    const second = expectOk(dayRangeIn('2026-08-01', 'Asia/Bangkok'));
    expect(first.end.getTime()).toBe(second.start.getTime());
  });

  it('round-trips: every boundary instant buckets to its own day', () => {
    const range = expectOk(dayRangeIn('2026-07-31', 'Asia/Bangkok'));
    expect(expectOk(calendarDateIn(range.start, 'Asia/Bangkok'))).toBe('2026-07-31');
    expect(expectOk(calendarDateIn(new Date(range.end.getTime() - 1), 'Asia/Bangkok'))).toBe(
      '2026-07-31',
    );
    expect(expectOk(calendarDateIn(range.end, 'Asia/Bangkok'))).toBe('2026-08-01');
  });

  it('rejects a malformed calendar date', () => {
    expect(expectErrCode(startOfDayIn('31-07-2026', 'UTC'))).toBe('invalid_calendar_date');
    expect(expectErrCode(startOfDayIn('2026-7-31', 'UTC'))).toBe('invalid_calendar_date');
  });
});

describe('monthRangeIn — Trading Calendar (Phase 14D)', () => {
  it('agrees with dayRangeIn at both ends: start of day 1 through start of next month day 1', () => {
    const month = expectOk(monthRangeIn(2026, 8, 'Asia/Bangkok'));
    const firstDay = expectOk(dayRangeIn('2026-08-01', 'Asia/Bangkok'));
    const nextMonthFirstDay = expectOk(dayRangeIn('2026-09-01', 'Asia/Bangkok'));
    expect(month.start.getTime()).toBe(firstDay.start.getTime());
    expect(month.end.getTime()).toBe(nextMonthFirstDay.start.getTime());
  });

  it('rolls over the year at December', () => {
    const december = expectOk(monthRangeIn(2026, 12, 'UTC'));
    expect(december.start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(december.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('is a half-open range spanning the exact number of days in the month, offset by the zone', () => {
    const bangkokFeb = expectOk(monthRangeIn(2026, 2, 'Asia/Bangkok'));
    const hours = (bangkokFeb.end.getTime() - bangkokFeb.start.getTime()) / 3_600_000;
    expect(hours).toBe(28 * 24); // 2026 is not a leap year
  });

  it('every boundary instant round-trips to the correct calendar day, in a DST zone spanning a spring-forward', () => {
    // March 2026 in America/New_York contains the spring-forward transition
    // (2026-03-08) — the month range itself must still start/end exactly on
    // day 1 of March/April despite that 23-hour day inside it.
    const march = expectOk(monthRangeIn(2026, 3, 'America/New_York'));
    expect(expectOk(calendarDateIn(march.start, 'America/New_York'))).toBe('2026-03-01');
    expect(expectOk(calendarDateIn(new Date(march.end.getTime() - 1), 'America/New_York'))).toBe(
      '2026-03-31',
    );
    expect(expectOk(calendarDateIn(march.end, 'America/New_York'))).toBe('2026-04-01');
  });
});

describe('daysInMonth', () => {
  it('returns the correct Gregorian day count for every month, including leap February', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('parseCalendarParts', () => {
  it('parses a valid date', () => {
    expect(expectOk(parseCalendarParts('2026-07-31'))).toEqual({ year: 2026, month: 7, day: 31 });
  });

  it('rejects impossible dates rather than rolling them over', () => {
    // new Date(2026, 1, 30) silently becomes 2 March. That is refused here.
    expect(expectErrCode(parseCalendarParts('2026-02-30'))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarParts('2026-13-01'))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarParts('2026-04-31'))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarParts('2027-02-29'))).toBe('invalid_calendar_date');
  });

  it('accepts a real leap day', () => {
    expect(expectOk(parseCalendarParts('2028-02-29'))).toEqual({ year: 2028, month: 2, day: 29 });
  });
});
