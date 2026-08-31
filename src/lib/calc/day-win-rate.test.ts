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

  /**
   * THE BAND, NOT A COMPARISON TO ZERO.
   *
   * A day's total R is a sum of Trades' own R values, so it is judged by the
   * same `BREAK_EVEN_TOLERANCE_R` (0.0500R) that classifies a Trade. Before
   * this rule was unified, a lone +0.0300R Trade produced a WINNING day while
   * the Trade itself was a break-even Trade — the same figure contradicting
   * itself between a Calendar cell and a Trade badge on one screen.
   *
   * Inclusive at the boundary, matching `classifyOutcome`: exactly 0.0500R is
   * break-even, and one ten-thousandth past it is not.
   */
  it.each([
    ['0.0300', 'break_even'],
    ['-0.0300', 'break_even'],
    ['0.0500', 'break_even'],
    ['-0.0500', 'break_even'],
    ['0.0501', 'winning'],
    ['-0.0501', 'losing'],
  ] as const)('classifies a day totalling %s as %s', (total, expected) => {
    const result = dayWinRate([trade(total, '2026-08-01T10:00:00Z')], 'UTC');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(
      {
        winning: result.value.winningDayCount,
        break_even: result.value.breakEvenDayCount,
        losing: result.value.losingDayCount,
      }[expected],
    ).toBe(1);
    // Whichever bucket it lands in, the day stays in the denominator.
    expect(result.value.eligibleDayCount).toBe(1);
  });

  /**
   * The case a per-Trade band cannot see: three Trades that are each
   * unambiguous on their own, summing into the band together. The day is
   * break-even even though no Trade in it is.
   */
  it('applies the band to the day total, not to the Trades that produced it', () => {
    const result = dayWinRate(
      [
        trade('2.2000', '2026-08-01T10:00:00Z'),
        trade('-1.1000', '2026-08-01T11:00:00Z'),
        trade('-1.1500', '2026-08-01T12:00:00Z'),
      ],
      'UTC',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        eligibleDayCount: 1,
        winningDayCount: 0,
        breakEvenDayCount: 1,
        losingDayCount: 0,
        rate: '0.0000',
      },
    });
  });

  /**
   * And the band is a fixed 0.0500R however many Trades the day holds — it
   * must not widen with volume, or the rule stops being one a trader can be
   * told. Nine Trades of +0.0400R total +0.3600R, which is a winning day.
   */
  it('does not scale the band with the number of Trades in the day', () => {
    const result = dayWinRate(
      Array.from({ length: 9 }, (_, index) => trade('0.0400', `2026-08-01T1${index}:00:00Z`)),
      'UTC',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.winningDayCount).toBe(1);
    expect(result.value.breakEvenDayCount).toBe(0);
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
