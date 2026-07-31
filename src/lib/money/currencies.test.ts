import { describe, expect, it } from 'vitest';

import {
  CURRENCIES,
  CURRENCY_CODES,
  getCurrency,
  isCurrencyCode,
  minorUnitScale,
  minorUnitsFor,
} from './currencies';

describe('currency registry', () => {
  it('reports the correct precision for two-decimal currencies', () => {
    expect(minorUnitsFor('USD')).toBe(2);
    expect(minorUnitsFor('THB')).toBe(2);
    expect(minorUnitsFor('EUR')).toBe(2);
  });

  it('reports zero precision for zero-decimal currencies', () => {
    expect(minorUnitsFor('JPY')).toBe(0);
    expect(minorUnitsFor('KRW')).toBe(0);
    expect(minorUnitsFor('VND')).toBe(0);
    expect(minorUnitsFor('IDR')).toBe(0);
  });

  it('computes the scale as a bigint power of ten', () => {
    expect(minorUnitScale('USD')).toBe(100n);
    expect(minorUnitScale('THB')).toBe(100n);
    expect(minorUnitScale('JPY')).toBe(1n);
  });

  it('exposes metadata', () => {
    expect(getCurrency('THB')).toEqual({
      code: 'THB',
      minorUnits: 2,
      symbol: '฿',
      name: 'Thai Baht',
    });
  });

  it('guards unknown codes at runtime boundaries', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('XYZ')).toBe(false);
    expect(isCurrencyCode('')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
    expect(isCurrencyCode(123)).toBe(false);
    // Guards against prototype keys being mistaken for currencies.
    expect(isCurrencyCode('toString')).toBe(false);
    expect(isCurrencyCode('constructor')).toBe(false);
  });

  it('keeps every entry self-consistent', () => {
    for (const code of CURRENCY_CODES) {
      const meta = CURRENCIES[code];
      expect(meta.code).toBe(code);
      expect(meta.minorUnits).toBeGreaterThanOrEqual(0);
      expect(meta.minorUnits).toBeLessThanOrEqual(4);
      expect(meta.symbol.length).toBeGreaterThan(0);
      expect(meta.name.length).toBeGreaterThan(0);
    }
  });

  it('includes the currencies the product launches with', () => {
    expect(CURRENCY_CODES).toContain('THB');
    expect(CURRENCY_CODES).toContain('USD');
    expect(CURRENCY_CODES).toContain('JPY');
  });
});
