import { describe, expect, it } from 'vitest';

import { bigintToCalcDecimal, CalcDecimal, parseCalcDecimal, toCanonicalR } from './decimal';

describe('parseCalcDecimal', () => {
  it('parses a plain positive decimal', () => {
    expect(parseCalcDecimal('1.5')?.toString()).toBe('1.5');
  });

  it('parses a signed negative decimal', () => {
    expect(parseCalcDecimal('-1.5')?.toString()).toBe('-1.5');
  });

  it('parses an explicitly signed positive decimal', () => {
    expect(parseCalcDecimal('+1.5')?.toString()).toBe('1.5');
  });

  it('parses an integer with no fractional part', () => {
    expect(parseCalcDecimal('100')?.toString()).toBe('100');
  });

  it('parses surrounding whitespace', () => {
    expect(parseCalcDecimal('  1.5  ')?.toString()).toBe('1.5');
  });

  it('rejects a non-string value', () => {
    expect(parseCalcDecimal(1.5)).toBeNull();
    expect(parseCalcDecimal(null)).toBeNull();
    expect(parseCalcDecimal(undefined)).toBeNull();
  });

  it('rejects malformed decimal strings', () => {
    expect(parseCalcDecimal('abc')).toBeNull();
    expect(parseCalcDecimal('1.2.3')).toBeNull();
    expect(parseCalcDecimal('')).toBeNull();
    expect(parseCalcDecimal('1,234.5')).toBeNull();
    expect(parseCalcDecimal('1e10')).toBeNull();
    expect(parseCalcDecimal('$1.50')).toBeNull();
    expect(parseCalcDecimal('--1.5')).toBeNull();
  });

  it('parses a huge but representable decimal without precision loss', () => {
    // `Decimal#toString()` normalizes away an insignificant trailing zero
    // (".1234567890" -> ".123456789") — the VALUE is unchanged, so this
    // compares numeric equality via `Decimal#equals`, not string identity.
    const huge = '123456789012345.1234567890';
    const parsed = parseCalcDecimal(huge);
    expect(parsed?.equals(huge)).toBe(true);
    expect(parsed?.toString()).toBe('123456789012345.123456789');
  });
});

describe('bigintToCalcDecimal', () => {
  it('converts an exact bigint without precision loss, including beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2 — unsafe to round-trip through Number
    expect(bigintToCalcDecimal(huge).toString()).toBe('9007199254740993');
  });

  it('converts a negative bigint exactly', () => {
    expect(bigintToCalcDecimal(-1000n).toString()).toBe('-1000');
  });

  it('converts zero exactly', () => {
    expect(bigintToCalcDecimal(0n).toString()).toBe('0');
  });
});

describe('toCanonicalR', () => {
  it('formats a whole number to four decimal places', () => {
    expect(toCanonicalR(new CalcDecimal('3'))).toBe('3.0000');
  });

  it('formats a negative value to four decimal places', () => {
    expect(toCanonicalR(new CalcDecimal('-1'))).toBe('-1.0000');
  });

  it('normalizes exact zero to a positive-signed "0.0000"', () => {
    expect(toCanonicalR(new CalcDecimal('0'))).toBe('0.0000');
  });

  it('normalizes a computed negative zero to "0.0000", not "-0.0000"', () => {
    expect(toCanonicalR(new CalcDecimal('0').minus(new CalcDecimal('0')))).toBe('0.0000');
  });

  it('rounds half-up away from zero on the fifth decimal place', () => {
    expect(toCanonicalR(new CalcDecimal('1.00005'))).toBe('1.0001');
    expect(toCanonicalR(new CalcDecimal('-1.00005'))).toBe('-1.0001');
  });

  it('rounds down when the fifth decimal place is below five', () => {
    expect(toCanonicalR(new CalcDecimal('1.00004'))).toBe('1.0000');
  });

  it('preserves exactly four decimal places with no trailing truncation', () => {
    expect(toCanonicalR(new CalcDecimal('2.125'))).toBe('2.1250');
  });

  describe('precision — the classic binary floating-point trap', () => {
    it('0.1 + 0.2 equals exactly 0.3, not 0.30000000000000004', () => {
      const sum = new CalcDecimal('0.1').plus(new CalcDecimal('0.2'));
      expect(toCanonicalR(sum)).toBe('0.3000');
      // The native-number version of this exact computation is the textbook
      // counterexample this engine exists to avoid reproducing.
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('a division that is not exactly representable in binary floating point still rounds deterministically', () => {
      // 1/3 has no exact binary (or decimal) representation; the engine must
      // still produce one deterministic, correctly-rounded 4dp string.
      const oneThird = new CalcDecimal('1').dividedBy(new CalcDecimal('3'));
      expect(toCanonicalR(oneThird)).toBe('0.3333');
    });
  });
});
