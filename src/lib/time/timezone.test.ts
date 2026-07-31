import { describe, expect, it } from 'vitest';

import { isValidTimeZone, observesDstInYear, offsetMinutesAt, wallClockAt } from './timezone';

describe('isValidTimeZone', () => {
  it('accepts real IANA identifiers', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
  });

  it('rejects nonsense', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('   ')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(420)).toBe(false);
    expect(isValidTimeZone({})).toBe(false);
  });
});

describe('offsetMinutesAt', () => {
  it('is zero for UTC', () => {
    expect(offsetMinutesAt(new Date('2026-07-31T00:00:00Z'), 'UTC')).toBe(0);
    expect(offsetMinutesAt(new Date('2026-01-31T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('is a constant +07:00 for Asia/Bangkok, which has no DST', () => {
    expect(offsetMinutesAt(new Date('2026-01-15T00:00:00Z'), 'Asia/Bangkok')).toBe(420);
    expect(offsetMinutesAt(new Date('2026-07-15T00:00:00Z'), 'Asia/Bangkok')).toBe(420);
  });

  it('tracks DST for America/New_York', () => {
    // EST in January, EDT in July.
    expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutesAt(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('changes exactly at the 2026 spring-forward transition', () => {
    // 2026-03-08 07:00Z is 02:00 EST -> clocks jump to 03:00 EDT.
    expect(offsetMinutesAt(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutesAt(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('changes exactly at the 2026 fall-back transition', () => {
    // 2026-11-01 06:00Z is 02:00 EDT -> clocks return to 01:00 EST.
    expect(offsetMinutesAt(new Date('2026-11-01T05:59:00Z'), 'America/New_York')).toBe(-240);
    expect(offsetMinutesAt(new Date('2026-11-01T06:00:00Z'), 'America/New_York')).toBe(-300);
  });

  it('handles a half-hour offset', () => {
    expect(offsetMinutesAt(new Date('2026-07-15T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('handles a 45-minute offset', () => {
    expect(offsetMinutesAt(new Date('2026-07-15T00:00:00Z'), 'Asia/Kathmandu')).toBe(345);
  });

  it('handles a southern-hemisphere zone where DST is inverted', () => {
    expect(offsetMinutesAt(new Date('2026-01-15T00:00:00Z'), 'Australia/Sydney')).toBe(660);
    expect(offsetMinutesAt(new Date('2026-07-15T00:00:00Z'), 'Australia/Sydney')).toBe(600);
  });
});

describe('wallClockAt', () => {
  it('reads the wall clock in UTC', () => {
    expect(wallClockAt(new Date('2026-07-31T23:30:00Z'), 'UTC')).toEqual({
      year: 2026,
      month: 7,
      day: 31,
      hour: 23,
      minute: 30,
      second: 0,
    });
  });

  it('reads the wall clock in Bangkok, crossing into the next day', () => {
    expect(wallClockAt(new Date('2026-07-31T23:30:00Z'), 'Asia/Bangkok')).toEqual({
      year: 2026,
      month: 8,
      day: 1,
      hour: 6,
      minute: 30,
      second: 0,
    });
  });

  it('uses a 24-hour clock rather than reporting hour 24 at midnight', () => {
    const wall = wallClockAt(new Date('2026-07-31T17:00:00Z'), 'Asia/Bangkok');
    expect(wall.hour).toBe(0);
    expect(wall.day).toBe(1);
    expect(wall.month).toBe(8);
  });
});

describe('observesDstInYear', () => {
  it('is false for zones without DST', () => {
    expect(observesDstInYear('Asia/Bangkok', 2026)).toBe(false);
    expect(observesDstInYear('UTC', 2026)).toBe(false);
    expect(observesDstInYear('Asia/Tokyo', 2026)).toBe(false);
  });

  it('is true for zones with DST', () => {
    expect(observesDstInYear('America/New_York', 2026)).toBe(true);
    expect(observesDstInYear('Europe/London', 2026)).toBe(true);
    expect(observesDstInYear('Australia/Sydney', 2026)).toBe(true);
  });
});
