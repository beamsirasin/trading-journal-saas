import { describe, expect, it } from 'vitest';

import { formatMoney, toDecimalString } from './format';
import { parseMoney } from './parse';
import type { Money } from './types';

const usd = (minor: bigint): Money => ({ amountMinor: minor, currency: 'USD' });
const thb = (minor: bigint): Money => ({ amountMinor: minor, currency: 'THB' });
const jpy = (minor: bigint): Money => ({ amountMinor: minor, currency: 'JPY' });

describe('formatMoney — two-decimal currencies', () => {
  it('formats with grouping by default', () => {
    expect(formatMoney(usd(123456n))).toBe('1,234.56');
  });

  it('formats without grouping in plain style', () => {
    expect(formatMoney(usd(123456n), { style: 'plain' })).toBe('1234.56');
  });

  it('formats with a symbol', () => {
    expect(formatMoney(usd(123456n), { style: 'symbol' })).toBe('$1,234.56');
    expect(formatMoney(thb(150075n), { style: 'symbol' })).toBe('฿1,500.75');
  });

  it('formats with a currency code', () => {
    expect(formatMoney(usd(123456n), { style: 'code' })).toBe('1,234.56 USD');
  });

  it('pads the minor units', () => {
    expect(formatMoney(usd(5n))).toBe('0.05');
    expect(formatMoney(usd(50n))).toBe('0.50');
    expect(formatMoney(usd(500n))).toBe('5.00');
  });

  it('formats zero', () => {
    expect(formatMoney(usd(0n))).toBe('0.00');
    expect(formatMoney(jpy(0n))).toBe('0');
  });
});

describe('formatMoney — zero-decimal currencies', () => {
  it('omits the decimal point entirely for JPY', () => {
    expect(formatMoney(jpy(1234n))).toBe('1,234');
    expect(formatMoney(jpy(1234n), { style: 'symbol' })).toBe('¥1,234');
  });
});

describe('formatMoney — negatives', () => {
  it('places the sign before the digits', () => {
    expect(formatMoney(usd(-123456n))).toBe('-1,234.56');
  });

  it('places the sign before the symbol', () => {
    // -$12.34 reads correctly; $-12.34 does not.
    expect(formatMoney(usd(-1234n), { style: 'symbol' })).toBe('-$12.34');
  });

  it('places the sign before the code', () => {
    expect(formatMoney(usd(-1234n), { style: 'code' })).toBe('-12.34 USD');
  });
});

describe('formatMoney — sign display', () => {
  it('adds a plus when asked', () => {
    expect(formatMoney(usd(123456n), { signDisplay: 'always' })).toBe('+1,234.56');
  });

  it('leaves negatives unchanged when always is set', () => {
    expect(formatMoney(usd(-123456n), { signDisplay: 'always' })).toBe('-1,234.56');
  });

  it('does not add a plus to zero by default', () => {
    expect(formatMoney(usd(0n))).toBe('0.00');
  });
});

describe('formatMoney — grouping boundaries', () => {
  it.each([
    [1n, '0.01'],
    [99n, '0.99'],
    [100n, '1.00'],
    [99999n, '999.99'],
    [100000n, '1,000.00'],
    [99999999n, '999,999.99'],
    [100000000n, '1,000,000.00'],
    [100000000000n, '1,000,000,000.00'],
  ])('formats %s minor units as %s', (minor, expected) => {
    expect(formatMoney(usd(minor))).toBe(expected);
  });
});

describe('formatMoney — large values', () => {
  it('stays exact past the float-safe integer range', () => {
    // Number(9007199254740993n) === 9007199254740992, so an implementation
    // routing through Number would print ...92 here.
    expect(formatMoney(usd(9007199254740993n), { style: 'plain' })).toBe('90071992547409.93');
  });

  it('formats the maximum storable amount', () => {
    expect(formatMoney(usd(9223372036854775807n), { style: 'plain' })).toBe('92233720368547758.07');
  });
});

describe('toDecimalString round-trip', () => {
  it.each(['0', '0.01', '12.34', '-12.34', '1234567.89', '92233720368547758.07'])(
    'round-trips %s',
    (input) => {
      const parsed = parseMoney(input, 'USD');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const reparsed = parseMoney(toDecimalString(parsed.value), 'USD');
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
          expect(reparsed.value.amountMinor).toBe(parsed.value.amountMinor);
        }
      }
    },
  );

  it('round-trips a grouped input through its plain form', () => {
    const parsed = parseMoney('1,234,567.89', 'USD');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(toDecimalString(parsed.value)).toBe('1234567.89');
    }
  });

  it('round-trips a zero-decimal currency', () => {
    const parsed = parseMoney('1234', 'JPY');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(toDecimalString(parsed.value)).toBe('1234');
    }
  });
});
