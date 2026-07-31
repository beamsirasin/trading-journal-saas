import { getCurrency, minorUnitScale, minorUnitsFor } from './currencies';
import type { Money } from './types';

export interface FormatMoneyOptions {
  /**
   * `'plain'`  -> `1234.56`      machine-ish, no grouping, for inputs and tests
   * `'group'`  -> `1,234.56`     grouped, no currency marker
   * `'symbol'` -> `$1,234.56`    grouped with the currency symbol
   * `'code'`   -> `1,234.56 USD` grouped with the ISO code
   *
   * Default: `'group'`.
   */
  readonly style?: 'plain' | 'group' | 'symbol' | 'code';
  /** Force a leading `+` on positive values. Default: `false`. */
  readonly signDisplay?: 'auto' | 'always';
}

/**
 * Formats money for display.
 *
 * Implemented with string arithmetic on the bigint rather than
 * `Intl.NumberFormat`, because feeding a large minor-unit value through
 * `Number` would lose precision above 2^53 — silently, and only for the
 * largest accounts. Grouping is applied manually for the same reason.
 *
 * Output is intentionally locale-independent: `1,234.56`. Localised display
 * formatting is a presentation concern for a later phase, and must never be
 * used as a storage or round-trip representation.
 */
export function formatMoney(money: Money, options: FormatMoneyOptions = {}): string {
  const style = options.style ?? 'group';
  const signDisplay = options.signDisplay ?? 'auto';

  const meta = getCurrency(money.currency);
  const decimals = minorUnitsFor(money.currency);
  const scale = minorUnitScale(money.currency);

  const negative = money.amountMinor < 0n;
  const magnitude = negative ? -money.amountMinor : money.amountMinor;

  const integerValue = magnitude / scale;
  const fractionValue = magnitude % scale;

  let integerText = integerValue.toString();
  if (style !== 'plain') {
    integerText = groupDigits(integerText);
  }

  const fractionText = decimals > 0 ? `.${fractionValue.toString().padStart(decimals, '0')}` : '';

  const sign = negative ? '-' : signDisplay === 'always' ? '+' : '';
  const numeric = `${sign}${integerText}${fractionText}`;

  switch (style) {
    case 'symbol':
      // Symbol precedes the sign for negatives in most conventions this
      // product targets: -$12.34, not $-12.34.
      return negative ? `-${meta.symbol}${integerText}${fractionText}` : `${meta.symbol}${numeric}`;
    case 'code':
      return `${numeric} ${meta.code}`;
    case 'plain':
    case 'group':
    default:
      return numeric;
  }
}

/**
 * Returns the exact decimal string for a Money, with no grouping and no
 * currency marker — `"-1234.56"`. This is the canonical round-trip form:
 * `parseMoney(toDecimalString(m), m.currency)` reproduces `m` exactly.
 */
export function toDecimalString(money: Money): string {
  return formatMoney(money, { style: 'plain' });
}

function groupDigits(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }
  const parts: string[] = [];
  let index = digits.length;
  while (index > 3) {
    parts.unshift(digits.slice(index - 3, index));
    index -= 3;
  }
  parts.unshift(digits.slice(0, index));
  return parts.join(',');
}
