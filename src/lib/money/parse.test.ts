import { describe, expect, it } from 'vitest';

import { fromMinorUnits, parseMoney } from './parse';
import { MAX_SAFE_MINOR, MIN_SAFE_MINOR, type MoneyErrorCode, type MoneyResult } from './types';

/** Unwraps a success, failing loudly with the error code if it is not one. */
function expectOk<T>(result: MoneyResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

function expectErr<T>(result: MoneyResult<T>): MoneyErrorCode {
  if (result.ok) {
    throw new Error(`expected an error, got value: ${JSON.stringify(result.value, bigintJson)}`);
  }
  return result.error.code;
}

const bigintJson = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? `${value}n` : value;

describe('parseMoney — two-decimal currencies', () => {
  it('parses a plain USD decimal', () => {
    expect(expectOk(parseMoney('1234.56', 'USD')).amountMinor).toBe(123456n);
  });

  it('parses THB', () => {
    expect(expectOk(parseMoney('1500.75', 'THB')).amountMinor).toBe(150075n);
  });

  it('pads a single decimal place', () => {
    expect(expectOk(parseMoney('12.3', 'USD')).amountMinor).toBe(1230n);
  });

  it('parses an integer with no decimal point', () => {
    expect(expectOk(parseMoney('42', 'USD')).amountMinor).toBe(4200n);
  });

  it('accepts a leading decimal point', () => {
    expect(expectOk(parseMoney('.5', 'USD')).amountMinor).toBe(50n);
  });

  it('accepts a trailing decimal point', () => {
    expect(expectOk(parseMoney('5.', 'USD')).amountMinor).toBe(500n);
  });

  it('ignores surrounding whitespace', () => {
    expect(expectOk(parseMoney('   12.30   ', 'USD')).amountMinor).toBe(1230n);
  });
});

describe('parseMoney — zero-decimal currencies', () => {
  it('parses JPY without decimals', () => {
    // The case that breaks every naive `* 100` implementation.
    expect(expectOk(parseMoney('1234', 'JPY')).amountMinor).toBe(1234n);
  });

  it('parses KRW without decimals', () => {
    expect(expectOk(parseMoney('50000', 'KRW')).amountMinor).toBe(50000n);
  });

  it('rejects any decimal place on JPY', () => {
    expect(expectErr(parseMoney('1234.5', 'JPY'))).toBe('too_many_decimal_places');
  });

  it('rounds JPY only when explicitly asked', () => {
    const rounded = parseMoney('1234.6', 'JPY', { onExcessDecimals: 'round-half-up' });
    expect(expectOk(rounded).amountMinor).toBe(1235n);
  });
});

describe('parseMoney — sign and zero', () => {
  it('parses a negative amount', () => {
    expect(expectOk(parseMoney('-1234.56', 'USD')).amountMinor).toBe(-123456n);
  });

  it('parses an explicit positive amount', () => {
    expect(expectOk(parseMoney('+1234.56', 'USD')).amountMinor).toBe(123456n);
  });

  it('parses zero', () => {
    expect(expectOk(parseMoney('0', 'USD')).amountMinor).toBe(0n);
    expect(expectOk(parseMoney('0.00', 'USD')).amountMinor).toBe(0n);
  });

  it('normalises negative zero to zero', () => {
    const value = expectOk(parseMoney('-0.00', 'USD'));
    expect(value.amountMinor).toBe(0n);
    expect(Object.is(value.amountMinor, 0n)).toBe(true);
  });

  it('rounds negative values away from zero, symmetrically with positives', () => {
    const negative = parseMoney('-2.345', 'USD', { onExcessDecimals: 'round-half-up' });
    const positive = parseMoney('2.345', 'USD', { onExcessDecimals: 'round-half-up' });
    expect(expectOk(negative).amountMinor).toBe(-235n);
    expect(expectOk(positive).amountMinor).toBe(235n);
  });
});

describe('parseMoney — digit grouping', () => {
  it('accepts well-formed grouping', () => {
    expect(expectOk(parseMoney('1,234.56', 'USD')).amountMinor).toBe(123456n);
    expect(expectOk(parseMoney('1,234,567.89', 'USD')).amountMinor).toBe(123456789n);
    expect(expectOk(parseMoney('12,345', 'USD')).amountMinor).toBe(1234500n);
  });

  it('rejects malformed grouping rather than silently stripping commas', () => {
    expect(expectErr(parseMoney('1,23', 'USD'))).toBe('invalid_grouping');
    expect(expectErr(parseMoney('1,2345', 'USD'))).toBe('invalid_grouping');
    expect(expectErr(parseMoney('1,23,456', 'USD'))).toBe('invalid_grouping');
    expect(expectErr(parseMoney(',123', 'USD'))).toBe('invalid_grouping');
  });

  it('rejects grouping when the caller disables it', () => {
    expect(expectErr(parseMoney('1,234', 'USD', { allowGrouping: false }))).toBe('malformed');
  });

  it('rejects European convention as ambiguous', () => {
    // "1.234,56" means 1234.56 in Germany and is nonsense here. Guessing
    // would misread the amount by a factor of 1000.
    expect(expectErr(parseMoney('1.234,56', 'USD'))).toBe('ambiguous_separators');
  });

  it('rejects a comma inside the decimal places', () => {
    expect(expectErr(parseMoney('12.3,4', 'USD'))).toBe('ambiguous_separators');
  });
});

describe('parseMoney — excess decimal places', () => {
  it('rejects by default rather than rounding silently', () => {
    expect(expectErr(parseMoney('12.345', 'USD'))).toBe('too_many_decimal_places');
  });

  it('names the currency and its precision in the message', () => {
    const result = parseMoney('12.345', 'USD');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('USD');
      expect(result.error.message).toContain('2');
    }
  });

  it('rounds half-up when asked', () => {
    const round = (input: string) =>
      expectOk(parseMoney(input, 'USD', { onExcessDecimals: 'round-half-up' })).amountMinor;
    expect(round('12.344')).toBe(1234n);
    expect(round('12.345')).toBe(1235n);
    expect(round('12.346')).toBe(1235n);
    expect(round('12.999')).toBe(1300n);
  });

  it('truncates when asked', () => {
    const truncate = (input: string) =>
      expectOk(parseMoney(input, 'USD', { onExcessDecimals: 'truncate' })).amountMinor;
    expect(truncate('12.349')).toBe(1234n);
    expect(truncate('12.999')).toBe(1299n);
  });

  it('carries correctly when rounding cascades across the integer boundary', () => {
    const result = parseMoney('9.999', 'USD', { onExcessDecimals: 'round-half-up' });
    expect(expectOk(result).amountMinor).toBe(1000n);
  });
});

describe('parseMoney — malformed input', () => {
  const cases: Array<[string, MoneyErrorCode]> = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'malformed'],
    ['12abc', 'malformed'],
    ['$12.34', 'malformed'],
    ['1.2.3', 'malformed'],
    ['--12', 'malformed'],
    ['12 34', 'malformed'],
    ['(12.34)', 'malformed'],
    ['1e5', 'malformed'],
    ['.', 'malformed'],
    ['-', 'malformed'],
    ['NaN', 'malformed'],
    ['Infinity', 'malformed'],
  ];

  it.each(cases)('rejects %j', (input, expected) => {
    expect(expectErr(parseMoney(input, 'USD'))).toBe(expected);
  });

  it('rejects an unknown currency code', () => {
    // Cast through unknown: the guard exists for data crossing a runtime
    // boundary, where the type system offers no protection.
    const result = parseMoney('12.34', 'XYZ' as unknown as 'USD');
    expect(expectErr(result)).toBe('unknown_currency');
  });
});

describe('parseMoney — safe range', () => {
  it('accepts a value at the maximum', () => {
    // MAX_SAFE_MINOR as a major-unit decimal string.
    const atMax = '92233720368547758.07';
    expect(expectOk(parseMoney(atMax, 'USD')).amountMinor).toBe(MAX_SAFE_MINOR);
  });

  it('accepts a value at the minimum', () => {
    const atMin = '-92233720368547758.08';
    expect(expectOk(parseMoney(atMin, 'USD')).amountMinor).toBe(MIN_SAFE_MINOR);
  });

  it('rejects one minor unit above the maximum', () => {
    expect(expectErr(parseMoney('92233720368547758.08', 'USD'))).toBe('exceeds_safe_range');
  });

  it('rejects one minor unit below the minimum', () => {
    expect(expectErr(parseMoney('-92233720368547758.09', 'USD'))).toBe('exceeds_safe_range');
  });

  it('stays exact well beyond the float-safe integer range', () => {
    // 2^53 minor units is where `number` starts losing integers. bigint does not.
    const result = expectOk(parseMoney('90071992547409.93', 'USD'));
    expect(result.amountMinor).toBe(9007199254740993n);
    expect(result.amountMinor).not.toBe(BigInt(Number(9007199254740993n)));
  });
});

describe('fromMinorUnits', () => {
  it('accepts an in-range value', () => {
    expect(expectOk(fromMinorUnits(123456n, 'USD')).amountMinor).toBe(123456n);
  });

  it('rejects an out-of-range value', () => {
    expect(expectErr(fromMinorUnits(MAX_SAFE_MINOR + 1n, 'USD'))).toBe('exceeds_safe_range');
  });

  it('rejects an unknown currency', () => {
    expect(expectErr(fromMinorUnits(1n, 'XYZ' as unknown as 'USD'))).toBe('unknown_currency');
  });
});
