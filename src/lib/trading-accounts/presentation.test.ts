import { describe, expect, it } from 'vitest';

import { formatStartingBalance } from './presentation';

describe('formatStartingBalance', () => {
  it('renders the stored NUMERIC scale as a grouped currency amount', () => {
    // The exact shape Drizzle returns for NUMERIC(20, 10).
    expect(formatStartingBalance('10000.0000000000', 'USD')).toBe('$10,000.00');
  });

  it('accepts a value that carries no decimal scale at all', () => {
    expect(formatStartingBalance('10000', 'USD')).toBe('$10,000.00');
  });

  /**
   * The whole point of routing through `parseMoney`/`formatMoney` rather than
   * a local `toFixed(2)`: the currency's own ISO-4217 exponent decides the
   * decimal places, so a zero-decimal currency does not grow two fake ones.
   */
  it('uses the currency exponent rather than a hardcoded two decimals', () => {
    expect(formatStartingBalance('10000.0000000000', 'JPY')).toBe('¥10,000');
    expect(formatStartingBalance('250000.0000000000', 'KRW')).toBe('₩250,000');
    expect(formatStartingBalance('10000.0000000000', 'VND')).toBe('₫10,000');
  });

  it('follows the account currency, not the UI language', () => {
    expect(formatStartingBalance('10000.0000000000', 'THB')).toBe('฿10,000.00');
    expect(formatStartingBalance('2500.5000000000', 'EUR')).toBe('€2,500.50');
    expect(formatStartingBalance('999.9900000000', 'GBP')).toBe('£999.99');
  });

  it('rounds excess decimals once, at the presentation boundary', () => {
    // The column holds ten places; a currency with two has to resolve them.
    expect(formatStartingBalance('10000.5550000000', 'USD')).toBe('$10,000.56');
    expect(formatStartingBalance('10000.5540000000', 'USD')).toBe('$10,000.55');
    expect(formatStartingBalance('0.9990000000', 'USD')).toBe('$1.00');
  });

  it('never mutates or re-rounds the stored value', () => {
    const stored = '10000.5550000000';
    formatStartingBalance(stored, 'USD');
    expect(stored).toBe('10000.5550000000');
  });

  it('handles a zero balance and a large one without losing precision', () => {
    expect(formatStartingBalance('0.0000000000', 'USD')).toBe('$0.00');
    expect(formatStartingBalance('9999999999.9900000000', 'USD')).toBe('$9,999,999,999.99');
  });

  /**
   * `base_currency` is a shape-validated ticker, not the closed fiat registry
   * (CLAUDE.md A12). Crypto accounts are legitimate and have no ISO exponent,
   * so they keep the ticker rendering rather than being forced through Money.
   */
  it('keeps non-registry tickers truthful instead of inventing a symbol', () => {
    expect(formatStartingBalance('2.5000000000', 'BTC')).toBe('2.5 BTC');
    expect(formatStartingBalance('10000.0000000000', 'USDT')).toBe('10000 USDT');
    expect(formatStartingBalance('15.0000000000', 'ETH')).toBe('15 ETH');
  });

  it('drops only the scale zeros, never a whole number own trailing zeros', () => {
    expect(formatStartingBalance('1000', 'BTC')).toBe('1000 BTC');
    expect(formatStartingBalance('0.0000000000', 'BTC')).toBe('0 BTC');
    expect(formatStartingBalance('10.1000000000', 'BTC')).toBe('10.1 BTC');
  });

  it('falls back safely rather than throwing on an unparseable amount', () => {
    // Should be unreachable behind the column's own CHECK constraint, but a
    // formatter that throws would take the whole Dashboard down with it.
    expect(formatStartingBalance('not-a-number', 'USD')).toBe('not-a-number USD');
    expect(formatStartingBalance('', 'USD')).toBe(' USD');
  });
});
