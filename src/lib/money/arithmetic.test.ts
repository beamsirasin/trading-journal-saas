import { describe, expect, it } from 'vitest';

import {
  absolute,
  add,
  compare,
  equals,
  isNegative,
  isPositive,
  isZero,
  negate,
  subtract,
  sum,
  zero,
} from './arithmetic';
import { MAX_SAFE_MINOR, MIN_SAFE_MINOR, type Money, type MoneyResult } from './types';

const usd = (minor: bigint): Money => ({ amountMinor: minor, currency: 'USD' });
const jpy = (minor: bigint): Money => ({ amountMinor: minor, currency: 'JPY' });

function expectOk<T>(result: MoneyResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

describe('add', () => {
  it('adds two positives', () => {
    expect(expectOk(add(usd(1050n), usd(295n))).amountMinor).toBe(1345n);
  });

  it('adds a negative', () => {
    expect(expectOk(add(usd(1050n), usd(-295n))).amountMinor).toBe(755n);
  });

  it('adds to zero', () => {
    expect(expectOk(add(usd(1050n), usd(-1050n))).amountMinor).toBe(0n);
  });

  it('is exact across many additions where floats would drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    let total = zero('USD');
    for (let i = 0; i < 10; i += 1) {
      total = expectOk(add(total, usd(10n)));
    }
    expect(total.amountMinor).toBe(100n);
  });

  it('refuses to mix currencies', () => {
    const result = add(usd(100n), jpy(100n));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('currency_mismatch');
    }
  });

  it('reports overflow past the storable range', () => {
    const result = add(usd(MAX_SAFE_MINOR), usd(1n));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('exceeds_safe_range');
    }
  });
});

describe('subtract', () => {
  it('subtracts', () => {
    expect(expectOk(subtract(usd(1050n), usd(295n))).amountMinor).toBe(755n);
  });

  it('produces a negative result', () => {
    expect(expectOk(subtract(usd(295n), usd(1050n))).amountMinor).toBe(-755n);
  });

  it('refuses to mix currencies', () => {
    const result = subtract(usd(100n), jpy(100n));
    expect(result.ok).toBe(false);
  });

  it('reports underflow past the storable range', () => {
    const result = subtract(usd(MIN_SAFE_MINOR), usd(1n));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('exceeds_safe_range');
    }
  });
});

describe('negate and absolute', () => {
  it('negates', () => {
    expect(expectOk(negate(usd(1234n))).amountMinor).toBe(-1234n);
    expect(expectOk(negate(usd(-1234n))).amountMinor).toBe(1234n);
  });

  it('negates zero to zero', () => {
    expect(expectOk(negate(usd(0n))).amountMinor).toBe(0n);
  });

  it('takes absolute value', () => {
    expect(expectOk(absolute(usd(-1234n))).amountMinor).toBe(1234n);
    expect(expectOk(absolute(usd(1234n))).amountMinor).toBe(1234n);
  });

  it('reports that the minimum has no representable absolute value', () => {
    // Two's-complement asymmetry: |MIN| is one past MAX.
    const result = absolute(usd(MIN_SAFE_MINOR));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('exceeds_safe_range');
    }
  });
});

describe('sum', () => {
  it('sums a list', () => {
    const total = sum([usd(100n), usd(250n), usd(-50n)], 'USD');
    expect(expectOk(total).amountMinor).toBe(300n);
  });

  it('returns zero for an empty list in the stated currency', () => {
    const total = sum([], 'USD');
    expect(expectOk(total)).toEqual({ amountMinor: 0n, currency: 'USD' });
  });

  it('refuses a foreign currency in the list', () => {
    const total = sum([usd(100n), jpy(100n)], 'USD');
    expect(total.ok).toBe(false);
    if (!total.ok) {
      expect(total.error.code).toBe('currency_mismatch');
    }
  });
});

describe('predicates', () => {
  it('identifies zero, positive and negative', () => {
    expect(isZero(usd(0n))).toBe(true);
    expect(isZero(usd(1n))).toBe(false);
    expect(isPositive(usd(1n))).toBe(true);
    expect(isPositive(usd(0n))).toBe(false);
    expect(isNegative(usd(-1n))).toBe(true);
    expect(isNegative(usd(0n))).toBe(false);
  });

  it('compares within a currency', () => {
    expect(expectOk(compare(usd(100n), usd(200n)))).toBe(-1);
    expect(expectOk(compare(usd(200n), usd(100n)))).toBe(1);
    expect(expectOk(compare(usd(100n), usd(100n)))).toBe(0);
  });

  it('refuses to compare across currencies', () => {
    expect(compare(usd(100n), jpy(100n)).ok).toBe(false);
  });

  it('treats equal amounts in different currencies as unequal', () => {
    expect(equals(usd(100n), jpy(100n))).toBe(false);
    expect(equals(usd(100n), usd(100n))).toBe(true);
  });
});
