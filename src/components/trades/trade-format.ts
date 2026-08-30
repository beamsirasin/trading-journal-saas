import Decimal from 'decimal.js';

import { formatMoney, isCurrencyCode } from '@/lib/money';
import { formatInstant, parseInstant } from '@/lib/time';

export function formatR(value: string | null): string | null {
  if (value === null) return null;
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return null;
    const rounded = decimal.toDecimalPlaces(2);
    const text = rounded.toFixed(2);
    return `${rounded.gt(0) ? '+' : ''}${text}R`;
  } catch {
    return null;
  }
}

export function formatTradeMoney(minor: string | null, currency: string): string | null {
  if (minor === null || !/^-?\d+$/.test(minor)) return null;
  if (!isCurrencyCode(currency)) return `${minor} ${currency} minor units`;
  return formatMoney({ amountMinor: BigInt(minor), currency }, { style: 'code' });
}

export function formatTradeInstant(
  value: string | null,
  timezone: string,
  locale: string,
): string | null {
  if (value === null) return null;
  const parsed = parseInstant(value);
  if (!parsed.ok) return null;
  const formatted = formatInstant(parsed.value, timezone, { style: 'datetime', locale });
  return formatted.ok ? formatted.value : null;
}

/**
 * The same instant, to the DAY only.
 *
 * For compact record lists where the clock time is noise rather than
 * information — the Dashboard's Recent Trades preview, whose whole job is to
 * say when something happened, not at what minute. Resolved in the same
 * workspace timezone and through the same `formatInstant` as
 * `formatTradeInstant` above, so the two can never disagree about which local
 * day an instant belongs to (CLAUDE.md §7).
 */
export function formatTradeDay(
  value: string | null,
  timezone: string,
  locale: string,
): string | null {
  if (value === null) return null;
  const parsed = parseInstant(value);
  if (!parsed.ok) return null;
  const formatted = formatInstant(parsed.value, timezone, { style: 'date', locale });
  return formatted.ok ? formatted.value : null;
}
