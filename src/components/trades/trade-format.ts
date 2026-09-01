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

/**
 * `1 : 3.00` — one Trade's PLANNED reward per one unit of planned risk.
 *
 * Reads the canonical persisted `trades.planned_r` and does nothing but
 * present it: no ratio is computed here, because `plannedR` already IS
 * `plannedReward / plannedRisk` (CLAUDE.md §6), resolved once by the calc
 * engine when the plan was recorded.
 *
 * SPELLED AS A RATIO, DELIBERATELY. A bare `3.00` in a table that also
 * carries Actual R and System R columns is indistinguishable from an R value;
 * the leading `1` is what names the unit, and it is the form a trader plans
 * in. The spacing matches the Dashboard's Avg Planned RR card exactly
 * (`lib/dashboard/basic-kpi.ts`) so the same quantity never appears in two
 * different shapes across the product. It is a numeric format, not a
 * sentence, so it is not translated.
 *
 * `null` — never `1 : 0.00` — for a Trade whose plan set no Target. A plan
 * with no reward leg is a plan that was never fully made, not a plan to make
 * nothing.
 */
export function formatPlannedRr(plannedR: string | null): string | null {
  if (plannedR === null) return null;
  try {
    const decimal = new Decimal(plannedR);
    if (!decimal.isFinite()) return null;
    return `1 : ${decimal.toDecimalPlaces(2).toFixed(2)}`;
  } catch {
    return null;
  }
}
