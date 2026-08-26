import { describe, expect, it } from 'vitest';

import { dayWinRate } from './day-win-rate';

const trade = (actualR: string, exitedAt: string) => ({ actualR, exitedAt: new Date(exitedAt) });

describe('dayWinRate', () => {
  it('groups multiple Trades on the same local day and classifies the net result', () => {
    expect(
      dayWinRate(
        [
          trade('2', '2026-08-01T10:00:00Z'),
          trade('-1', '2026-08-01T11:00:00Z'),
          trade('1', '2026-08-02T10:00:00Z'),
          trade('-1', '2026-08-02T11:00:00Z'),
          trade('-2', '2026-08-03T10:00:00Z'),
        ],
        'UTC',
      ),
    ).toEqual({
      ok: true,
      value: {
        eligibleDayCount: 3,
        winningDayCount: 1,
        breakEvenDayCount: 1,
        losingDayCount: 1,
        rate: '0.3333',
      },
    });
  });

  it('uses the persisted IANA timezone rather than UTC day boundaries', () => {
    const result = dayWinRate(
      [
        trade('1', '2026-07-31T18:00:00Z'), // 2026-08-01 in Bangkok
        trade('-1', '2026-08-01T16:59:59Z'), // same Bangkok day
        trade('2', '2026-08-01T17:00:00Z'), // next Bangkok day
      ],
      'Asia/Bangkok',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        eligibleDayCount: 2,
        winningDayCount: 1,
        breakEvenDayCount: 1,
        losingDayCount: 0,
        rate: '0.5000',
      },
    });
  });

  it('buckets safely across a DST spring-forward boundary', () => {
    const result = dayWinRate(
      [
        trade('1', '2026-03-08T06:59:59Z'), // 01:59:59 local
        trade('-1', '2026-03-08T07:00:00Z'), // 03:00:00 local, same calendar day
        trade('1', '2026-03-09T04:00:00Z'), // next local calendar day
      ],
      'America/New_York',
    );
    expect(result).toMatchObject({
      ok: true,
      value: { eligibleDayCount: 2, winningDayCount: 1, breakEvenDayCount: 1, rate: '0.5000' },
    });
  });

  it('distinguishes no eligible trading days from a zero-percent result', () => {
    expect(dayWinRate([], 'UTC')).toEqual({ ok: false, reason: 'no_trading_days' });
    expect(dayWinRate([trade('-1', '2026-08-01T10:00:00Z')], 'UTC')).toMatchObject({
      ok: true,
      value: { rate: '0.0000', losingDayCount: 1 },
    });
  });
});
