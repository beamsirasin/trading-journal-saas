import type { CurrencyCode } from './currencies';
import { err, MAX_SAFE_MINOR, MIN_SAFE_MINOR, ok, type Money, type MoneyResult } from './types';

/**
 * Arithmetic on minor units is exact — `bigint` addition cannot lose a cent.
 * The only failure modes are mixing currencies and exceeding storage range,
 * so both are surfaced as errors rather than assumed away.
 *
 * Multiplication and division are deliberately absent. Position sizing and
 * R-multiples need a documented rounding rule and belong in the calculation
 * engine (`src/lib/calc/`, Phase 07C/D), not in a general-purpose money
 * helper.
 */

function guardRange(amountMinor: bigint, currency: CurrencyCode): MoneyResult<Money> {
  if (amountMinor > MAX_SAFE_MINOR || amountMinor < MIN_SAFE_MINOR) {
    return err('exceeds_safe_range', `Result ${amountMinor} exceeds the storable 64-bit range.`);
  }
  return ok({ amountMinor: amountMinor === 0n ? 0n : amountMinor, currency });
}

export function add(a: Money, b: Money): MoneyResult<Money> {
  if (a.currency !== b.currency) {
    return err('currency_mismatch', `Cannot add ${a.currency} to ${b.currency}.`);
  }
  return guardRange(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): MoneyResult<Money> {
  if (a.currency !== b.currency) {
    return err('currency_mismatch', `Cannot subtract ${b.currency} from ${a.currency}.`);
  }
  return guardRange(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(money: Money): MoneyResult<Money> {
  return guardRange(-money.amountMinor, money.currency);
}

export function absolute(money: Money): MoneyResult<Money> {
  const magnitude = money.amountMinor < 0n ? -money.amountMinor : money.amountMinor;
  return guardRange(magnitude, money.currency);
}

/**
 * Sums a list. An empty list has no currency to attribute a zero to, so the
 * currency must be supplied — returning "0 of some currency" would be a lie.
 */
export function sum(amounts: readonly Money[], currency: CurrencyCode): MoneyResult<Money> {
  let total = 0n;
  for (const money of amounts) {
    if (money.currency !== currency) {
      return err('currency_mismatch', `Cannot sum ${money.currency} into ${currency}.`);
    }
    total += money.amountMinor;
  }
  return guardRange(total, currency);
}

export function isZero(money: Money): boolean {
  return money.amountMinor === 0n;
}

export function isNegative(money: Money): boolean {
  return money.amountMinor < 0n;
}

export function isPositive(money: Money): boolean {
  return money.amountMinor > 0n;
}

/** -1 when a < b, 0 when equal, 1 when a > b. Errors on mixed currencies. */
export function compare(a: Money, b: Money): MoneyResult<-1 | 0 | 1> {
  if (a.currency !== b.currency) {
    return err('currency_mismatch', `Cannot compare ${a.currency} with ${b.currency}.`);
  }
  if (a.amountMinor < b.amountMinor) return ok(-1);
  if (a.amountMinor > b.amountMinor) return ok(1);
  return ok(0);
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function zero(currency: CurrencyCode): Money {
  return { amountMinor: 0n, currency };
}
