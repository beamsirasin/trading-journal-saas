import { describe, expect, it } from 'vitest';

import { tradeHoldingTime } from './holding-time';

describe('tradeHoldingTime', () => {
  it('breaks an elapsed span into days, hours and minutes', () => {
    expect(tradeHoldingTime('2026-08-20T02:00:00.000Z', '2026-08-22T07:34:00.000Z')).toEqual({
      days: 2,
      hours: 5,
      minutes: 34,
      totalMinutes: 3214,
    });
  });

  it('reports a sub-hour hold in minutes alone', () => {
    expect(tradeHoldingTime('2026-08-20T02:00:00.000Z', '2026-08-20T02:12:00.000Z')).toEqual({
      days: 0,
      hours: 0,
      minutes: 12,
      totalMinutes: 12,
    });
  });

  it('is zero, not null, for an instant scratch', () => {
    expect(
      tradeHoldingTime('2026-08-20T02:00:00.000Z', '2026-08-20T02:00:00.000Z')?.totalMinutes,
    ).toBe(0);
  });

  it('is timezone-independent — the same span whichever zone it is written in', () => {
    const utc = tradeHoldingTime('2026-08-20T02:00:00.000Z', '2026-08-20T06:00:00.000Z');
    const bangkok = tradeHoldingTime('2026-08-20T09:00:00+07:00', '2026-08-20T13:00:00+07:00');
    expect(utc).toEqual(bangkok);
  });

  it('is unavailable while either end is missing', () => {
    expect(tradeHoldingTime(null, '2026-08-20T06:00:00.000Z')).toBeNull();
    expect(tradeHoldingTime('2026-08-20T02:00:00.000Z', null)).toBeNull();
  });

  it('refuses corrupt data rather than reporting a confident negative', () => {
    expect(tradeHoldingTime('2026-08-20T06:00:00.000Z', '2026-08-20T02:00:00.000Z')).toBeNull();
    expect(tradeHoldingTime('not-a-date', '2026-08-20T02:00:00.000Z')).toBeNull();
  });
});
