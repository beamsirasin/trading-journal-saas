import { describe, expect, it } from 'vitest';

import { isAccountMode } from './constants';
import {
  hasNoControlOrHtmlCharacters,
  isValidBaseCurrency,
  isValidPercent,
  isValidStartingBalance,
  parsePlainDecimal,
} from './validation';

describe('isAccountMode', () => {
  it.each(['live', 'demo', 'prop', 'backtest'])('accepts %s', (mode) => {
    expect(isAccountMode(mode)).toBe(true);
  });

  it.each(['Live', 'LIVE', 'paper', '', 'live ', 123, null, undefined])('rejects %s', (value) => {
    expect(isAccountMode(value)).toBe(false);
  });
});

describe('isValidBaseCurrency', () => {
  it.each(['USD', 'EUR', 'BTC', 'ETH', 'USDT', 'USDC', 'AB', 'ABCDEFGHIJ'])(
    'accepts %s',
    (value) => {
      expect(isValidBaseCurrency(value)).toBe(true);
    },
  );

  it('rejects lowercase', () => {
    expect(isValidBaseCurrency('usd')).toBe(false);
  });

  it('rejects mixed case', () => {
    expect(isValidBaseCurrency('Usd')).toBe(false);
  });

  it('rejects internal whitespace', () => {
    expect(isValidBaseCurrency('US D')).toBe(false);
  });

  it('rejects surrounding whitespace (not trimmed, rejected outright)', () => {
    expect(isValidBaseCurrency(' USD ')).toBe(false);
  });

  it('rejects a single character (below the minimum length)', () => {
    expect(isValidBaseCurrency('U')).toBe(false);
  });

  it('rejects more than 10 characters', () => {
    expect(isValidBaseCurrency('ABCDEFGHIJK')).toBe(false);
  });

  it('rejects HTML-shaped input', () => {
    expect(isValidBaseCurrency('<SCRIPT>')).toBe(false);
  });

  it('rejects a tab character', () => {
    expect(isValidBaseCurrency(`US${String.fromCharCode(9)}D`)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBaseCurrency('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidBaseCurrency(1234)).toBe(false);
    expect(isValidBaseCurrency(null)).toBe(false);
    expect(isValidBaseCurrency(undefined)).toBe(false);
  });
});

describe('hasNoControlOrHtmlCharacters', () => {
  it('accepts ordinary text', () => {
    expect(hasNoControlOrHtmlCharacters('Interactive Brokers')).toBe(true);
  });

  it('accepts Thai text', () => {
    expect(hasNoControlOrHtmlCharacters('โบรกเกอร์ของฉัน')).toBe(true);
  });

  it('rejects angle brackets', () => {
    expect(hasNoControlOrHtmlCharacters('<script>alert(1)</script>')).toBe(false);
    expect(hasNoControlOrHtmlCharacters('a > b')).toBe(false);
  });

  it('rejects a null character (code point 0)', () => {
    expect(hasNoControlOrHtmlCharacters(`a${String.fromCharCode(0)}b`)).toBe(false);
  });

  it('rejects a newline character (code point 10)', () => {
    expect(hasNoControlOrHtmlCharacters(`a${String.fromCharCode(10)}b`)).toBe(false);
  });

  it('rejects a tab character (code point 9)', () => {
    expect(hasNoControlOrHtmlCharacters(`a${String.fromCharCode(9)}b`)).toBe(false);
  });

  it('rejects the delete character (code point 127)', () => {
    expect(hasNoControlOrHtmlCharacters(`a${String.fromCharCode(127)}b`)).toBe(false);
  });

  it('accepts an empty string', () => {
    expect(hasNoControlOrHtmlCharacters('')).toBe(true);
  });
});

describe('parsePlainDecimal', () => {
  it('parses a whole number', () => {
    expect(parsePlainDecimal('10000')?.toString()).toBe('10000');
  });

  it('parses a decimal', () => {
    expect(parsePlainDecimal('1.5')?.toString()).toBe('1.5');
  });

  it('parses zero', () => {
    expect(parsePlainDecimal('0')?.toString()).toBe('0');
  });

  it('trims surrounding whitespace', () => {
    expect(parsePlainDecimal('  10  ')?.toString()).toBe('10');
  });

  it('rejects a negative sign', () => {
    expect(parsePlainDecimal('-10')).toBeNull();
  });

  it('rejects a leading plus sign', () => {
    expect(parsePlainDecimal('+10')).toBeNull();
  });

  it('rejects scientific notation', () => {
    expect(parsePlainDecimal('1e5')).toBeNull();
  });

  it('rejects thousands grouping', () => {
    expect(parsePlainDecimal('1,000')).toBeNull();
  });

  it('rejects multiple decimal points', () => {
    expect(parsePlainDecimal('1.2.3')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parsePlainDecimal('')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(parsePlainDecimal('abc')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parsePlainDecimal(10)).toBeNull();
    expect(parsePlainDecimal(null)).toBeNull();
    expect(parsePlainDecimal(undefined)).toBeNull();
  });
});

describe('isValidStartingBalance', () => {
  it('accepts zero', () => {
    expect(isValidStartingBalance('0')).toBe(true);
  });

  it('accepts a positive whole number', () => {
    expect(isValidStartingBalance('10000')).toBe(true);
  });

  it('accepts a high-precision decimal (e.g. a crypto balance)', () => {
    expect(isValidStartingBalance('0.0000000001')).toBe(true);
  });

  it('rejects a negative value', () => {
    expect(isValidStartingBalance('-1')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidStartingBalance('abc')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidStartingBalance('')).toBe(false);
  });
});

describe('isValidPercent', () => {
  it('accepts a typical value', () => {
    expect(isValidPercent('1')).toBe(true);
  });

  it('accepts the upper bound of 100', () => {
    expect(isValidPercent('100')).toBe(true);
  });

  it('accepts a small fractional value', () => {
    expect(isValidPercent('0.1')).toBe(true);
  });

  it('rejects exactly zero (must be strictly greater than zero)', () => {
    expect(isValidPercent('0')).toBe(false);
  });

  it('rejects a negative value', () => {
    expect(isValidPercent('-1')).toBe(false);
  });

  it('rejects a value over 100', () => {
    expect(isValidPercent('100.01')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidPercent('abc')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidPercent('')).toBe(false);
  });
});
