import { describe, expect, it } from 'vitest';

import { formatPlannedRr, formatR, formatTradeInstant, formatTradeMoney } from './trade-format';

describe('Trade presentation formatting', () => {
  it('formats canonical positive, zero, negative, and high-precision R strings without null becoming zero', () => {
    expect(formatR('3.0000')).toBe('+3.00R');
    expect(formatR('2.1250')).toBe('+2.13R');
    expect(formatR('0.0000')).toBe('0.00R');
    expect(formatR('-1.0000')).toBe('-1.00R');
    expect(formatR('9007199254740993.1250')).toBe('+9007199254740993.13R');
    expect(formatR(null)).toBeNull();
  });

  it('formats minor units using currency metadata, including zero-decimal currencies', () => {
    expect(formatTradeMoney('12345', 'USD')).toBe('123.45 USD');
    expect(formatTradeMoney('-500', 'JPY')).toBe('-500 JPY');
    expect(formatTradeMoney('42', 'USDT')).toBe('42 USDT minor units');
  });

  it('spells Planned RR as a ratio, so it is never mistaken for an R value', () => {
    // The leading 1 names the unit. In a table that also carries Actual R and
    // System R, a bare "3.00" is indistinguishable from either.
    expect(formatPlannedRr('3.0000')).toBe('1 : 3.00');
    expect(formatPlannedRr('1.5000')).toBe('1 : 1.50');
    expect(formatPlannedRr('0.7500')).toBe('1 : 0.75');
  });

  it('reports a plan with no reward leg as unavailable, never as a 1 : 0.00 plan', () => {
    // A plan with no Target is a plan that was never fully made, not a plan
    // to make nothing.
    expect(formatPlannedRr(null)).toBeNull();
    expect(formatPlannedRr('not-a-number')).toBeNull();
  });

  it('presents the persisted ratio and never recomputes it', () => {
    // `planned_r` already IS reward / risk, resolved once by the calc engine.
    // Rounding is the only thing that happens here.
    expect(formatPlannedRr('2.1250')).toBe('1 : 2.13');
  });

  it('formats an ISO instant through the persisted timezone', () => {
    expect(formatTradeInstant('2026-08-08T00:30:00.000Z', 'Asia/Bangkok', 'en-GB')).toContain(
      '07:30',
    );
    expect(formatTradeInstant('not-an-instant', 'Asia/Bangkok', 'en-GB')).toBeNull();
  });
});
