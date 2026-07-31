import { describe, expect, it } from 'vitest';

import { parseCalendarDate, parseInstant, toIsoUtc } from './parse';
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

describe('parseInstant', () => {
  it('parses a UTC instant', () => {
    expect(expectOk(parseInstant('2026-07-31T10:00:00Z')).toISOString()).toBe(
      '2026-07-31T10:00:00.000Z',
    );
  });

  it('parses milliseconds', () => {
    expect(expectOk(parseInstant('2026-07-31T10:00:00.123Z')).toISOString()).toBe(
      '2026-07-31T10:00:00.123Z',
    );
  });

  it('parses a positive offset and normalises to UTC', () => {
    expect(expectOk(parseInstant('2026-07-31T17:00:00+07:00')).toISOString()).toBe(
      '2026-07-31T10:00:00.000Z',
    );
  });

  it('parses a negative offset', () => {
    expect(expectOk(parseInstant('2026-07-31T06:00:00-04:00')).toISOString()).toBe(
      '2026-07-31T10:00:00.000Z',
    );
  });

  it('parses without seconds', () => {
    expect(expectOk(parseInstant('2026-07-31T10:00Z')).toISOString()).toBe(
      '2026-07-31T10:00:00.000Z',
    );
  });

  it('rejects a timestamp with no offset', () => {
    // The critical rejection: new Date('2026-07-31T10:00:00') reads this as
    // LOCAL time, so the result would depend on the machine's timezone.
    expect(expectErrCode(parseInstant('2026-07-31T10:00:00'))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('2026-07-31 10:00:00'))).toBe('invalid_timestamp');
  });

  it('rejects a bare calendar date', () => {
    expect(expectErrCode(parseInstant('2026-07-31'))).toBe('invalid_timestamp');
  });

  it('rejects impossible calendar dates', () => {
    expect(expectErrCode(parseInstant('2026-02-30T10:00:00Z'))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('2026-13-01T10:00:00Z'))).toBe('invalid_timestamp');
  });

  it('rejects out-of-range time components', () => {
    expect(expectErrCode(parseInstant('2026-07-31T24:00:00Z'))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('2026-07-31T10:60:00Z'))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('2026-07-31T10:00:60Z'))).toBe('invalid_timestamp');
  });

  it('rejects junk', () => {
    expect(expectErrCode(parseInstant(''))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('   '))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('yesterday'))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('31/07/2026'))).toBe('invalid_timestamp');
    expect(expectErrCode(parseInstant('1754000000'))).toBe('invalid_timestamp');
  });

  it('does not depend on the runtime timezone', () => {
    // Whatever TZ the test process runs under, an explicit offset must give
    // the same instant. This is the property the whole module exists for.
    const fromUtc = expectOk(parseInstant('2026-07-31T10:00:00Z'));
    const fromBangkok = expectOk(parseInstant('2026-07-31T17:00:00+07:00'));
    expect(fromUtc.getTime()).toBe(fromBangkok.getTime());
  });
});

describe('parseCalendarDate', () => {
  it('parses a valid date', () => {
    expect(expectOk(parseCalendarDate('2026-07-31')).toString()).toBe('2026-07-31');
  });

  it('trims surrounding whitespace', () => {
    expect(expectOk(parseCalendarDate('  2026-07-31  '))).toBe('2026-07-31');
  });

  it('rejects malformed and impossible dates', () => {
    expect(expectErrCode(parseCalendarDate(''))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarDate('2026-7-31'))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarDate('31-07-2026'))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarDate('2026-02-30'))).toBe('invalid_calendar_date');
    expect(expectErrCode(parseCalendarDate('2026-07-31T00:00:00Z'))).toBe('invalid_calendar_date');
  });
});

describe('toIsoUtc', () => {
  it('produces the canonical storage form', () => {
    expect(expectOk(toIsoUtc(new Date('2026-07-31T10:00:00Z')))).toBe('2026-07-31T10:00:00.000Z');
  });

  it('normalises an offset input to UTC', () => {
    const instant = expectOk(parseInstant('2026-07-31T17:00:00+07:00'));
    expect(expectOk(toIsoUtc(instant))).toBe('2026-07-31T10:00:00.000Z');
  });

  it('rejects an invalid date', () => {
    expect(expectErrCode(toIsoUtc(new Date('nope')))).toBe('invalid_timestamp');
  });

  it('round-trips through parseInstant', () => {
    const original = '2026-07-31T10:00:00.000Z';
    const instant = expectOk(parseInstant(original));
    expect(expectOk(toIsoUtc(instant))).toBe(original);
  });
});
