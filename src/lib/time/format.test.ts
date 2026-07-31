import { describe, expect, it } from 'vitest';

import { formatInstant, formatOffset } from './format';
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

const instant = new Date('2026-07-31T16:30:00Z');

describe('formatInstant', () => {
  it('formats the same instant differently per zone', () => {
    // The same moment, three wall clocks. Exact punctuation is left to ICU;
    // the assertion is on the values that must differ.
    const utc = expectOk(formatInstant(instant, 'UTC', { style: 'time' }));
    const bangkok = expectOk(formatInstant(instant, 'Asia/Bangkok', { style: 'time' }));
    const newYork = expectOk(formatInstant(instant, 'America/New_York', { style: 'time' }));

    expect(utc).toContain('16:30');
    expect(bangkok).toContain('23:30');
    expect(newYork).toContain('12:30');
  });

  it('rolls the date forward in a zone ahead of UTC', () => {
    const lateEvening = new Date('2026-07-31T17:30:00Z');
    const bangkok = expectOk(formatInstant(lateEvening, 'Asia/Bangkok', { style: 'date' }));
    expect(bangkok).toContain('2026');
    expect(bangkok).toContain('Aug');
    expect(bangkok).toContain('01');
  });

  it('uses a 24-hour clock', () => {
    const evening = new Date('2026-07-31T20:00:00Z');
    const formatted = expectOk(formatInstant(evening, 'UTC', { style: 'time' }));
    expect(formatted).toContain('20:00');
    expect(formatted).not.toMatch(/pm/i);
  });

  it('can include the zone name', () => {
    const formatted = expectOk(
      formatInstant(instant, 'Asia/Bangkok', { style: 'datetime-with-zone' }),
    );
    expect(formatted).toContain('23:30');
    expect(formatted.length).toBeGreaterThan('31 Jul 2026, 23:30'.length);
  });

  it('rejects an invalid timezone', () => {
    expect(expectErrCode(formatInstant(instant, 'Nope/Nowhere'))).toBe('invalid_timezone');
  });

  it('rejects an invalid instant', () => {
    expect(expectErrCode(formatInstant(new Date('nope'), 'UTC'))).toBe('invalid_timestamp');
  });
});

describe('formatOffset', () => {
  it('formats zero as +00:00', () => {
    expect(expectOk(formatOffset(instant, 'UTC'))).toBe('+00:00');
  });

  it('formats a positive offset', () => {
    expect(expectOk(formatOffset(instant, 'Asia/Bangkok'))).toBe('+07:00');
  });

  it('formats a negative offset, tracking DST', () => {
    expect(expectOk(formatOffset(new Date('2026-07-15T12:00:00Z'), 'America/New_York'))).toBe(
      '-04:00',
    );
    expect(expectOk(formatOffset(new Date('2026-01-15T12:00:00Z'), 'America/New_York'))).toBe(
      '-05:00',
    );
  });

  it('formats a half-hour offset', () => {
    expect(expectOk(formatOffset(instant, 'Asia/Kolkata'))).toBe('+05:30');
  });

  it('formats a 45-minute offset', () => {
    expect(expectOk(formatOffset(instant, 'Asia/Kathmandu'))).toBe('+05:45');
  });

  it('rejects an invalid timezone', () => {
    expect(expectErrCode(formatOffset(instant, 'Nope/Nowhere'))).toBe('invalid_timezone');
  });
});
