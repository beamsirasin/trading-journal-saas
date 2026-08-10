import { describe, expect, it } from 'vitest';

import { fillUtc30DayCounts, resolveUtc30DayWindow } from './date-window';

describe('resolveUtc30DayWindow', () => {
  it('returns exactly 30 days, oldest first, ending on today (UTC)', () => {
    const window = resolveUtc30DayWindow(new Date('2026-08-10T15:42:00Z'));
    expect(window.days).toHaveLength(30);
    expect(window.days[0]).toBe('2026-07-12');
    expect(window.days[29]).toBe('2026-08-10');
  });

  it('start boundary is exactly UTC midnight of the first day', () => {
    const window = resolveUtc30DayWindow(new Date('2026-08-10T15:42:00Z'));
    expect(window.startInclusive.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  it('end boundary is exactly UTC midnight the day AFTER today (exclusive)', () => {
    const window = resolveUtc30DayWindow(new Date('2026-08-10T15:42:00Z'));
    expect(window.endExclusive.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('a timestamp exactly at UTC midnight today still includes today as the last day', () => {
    const window = resolveUtc30DayWindow(new Date('2026-08-10T00:00:00Z'));
    expect(window.days[29]).toBe('2026-08-10');
  });

  it('a timestamp one millisecond before UTC midnight belongs to the previous UTC day', () => {
    const window = resolveUtc30DayWindow(new Date('2026-08-09T23:59:59.999Z'));
    expect(window.days[29]).toBe('2026-08-09');
  });

  it('spans a month boundary correctly', () => {
    const window = resolveUtc30DayWindow(new Date('2026-03-05T12:00:00Z'));
    expect(window.days[0]).toBe('2026-02-04');
    expect(window.days[29]).toBe('2026-03-05');
    // February 2026 is not a leap year — 28 days — proves real calendar
    // arithmetic, not a naive day-count subtraction.
    expect(window.days).toContain('2026-02-28');
    expect(window.days).not.toContain('2026-02-29');
  });

  it('spans a year boundary correctly', () => {
    const window = resolveUtc30DayWindow(new Date('2026-01-10T12:00:00Z'));
    expect(window.days[0]).toBe('2025-12-12');
    expect(window.days[29]).toBe('2026-01-10');
  });

  it('is completely independent of the host process timezone (UTC hardcoded, not derived)', () => {
    // Regression guard: a naive implementation using `new Date().getDate()`
    // (local time) instead of `getUTCDate()` would shift by a day depending
    // on the machine's TZ — this asserts the UTC-specific instant directly.
    const window = resolveUtc30DayWindow(new Date('2026-08-10T23:00:00Z'));
    expect(window.days[29]).toBe('2026-08-10');
  });

  it('throws on an invalid Date rather than silently producing NaN-derived output', () => {
    expect(() => resolveUtc30DayWindow(new Date('not-a-date'))).toThrow();
  });
});

describe('fillUtc30DayCounts', () => {
  const window = resolveUtc30DayWindow(new Date('2026-08-10T00:00:00Z'));

  it('fills every day with zero when no rows are counted', () => {
    const filled = fillUtc30DayCounts(window, []);
    expect(filled).toHaveLength(30);
    expect(filled.every((row) => row.count === 0)).toBe(true);
  });

  it('merges sparse counted rows into the full window, preserving day order', () => {
    const filled = fillUtc30DayCounts(window, [
      { day: '2026-08-10', count: 5 },
      { day: '2026-07-12', count: 2 },
    ]);
    expect(filled[0]).toEqual({ day: '2026-07-12', count: 2 });
    expect(filled[29]).toEqual({ day: '2026-08-10', count: 5 });
    expect(filled[1]).toEqual({ day: '2026-07-13', count: 0 });
  });

  it('ignores a counted row for a day outside the window', () => {
    const filled = fillUtc30DayCounts(window, [{ day: '1999-01-01', count: 99 }]);
    expect(filled.every((row) => row.count === 0)).toBe(true);
  });
});
