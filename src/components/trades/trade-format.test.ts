import { describe, expect, it } from 'vitest';

import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';

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

  it('formats an ISO instant through the persisted timezone', () => {
    expect(formatTradeInstant('2026-08-08T00:30:00.000Z', 'Asia/Bangkok', 'en-GB')).toContain(
      '07:30',
    );
    expect(formatTradeInstant('not-an-instant', 'Asia/Bangkok', 'en-GB')).toBeNull();
  });
});
