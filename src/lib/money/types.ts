/**
 * Money primitives — framework independent.
 *
 * No React, Next.js, Drizzle, or database coupling. Plain data in, plain data
 * out, so this module can be tested exhaustively and reused anywhere.
 */

import type { CurrencyCode } from './currencies';

/**
 * A monetary amount, stored as an integer count of the currency's smallest
 * unit ("minor units"): 1234n USD = $12.34, 1234n JPY = ¥1234.
 *
 * `bigint` is used rather than `number` because binary floating point cannot
 * represent most decimal fractions exactly, and a rounding error in a P&L
 * figure is a real defect rather than a cosmetic one.
 */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/**
 * Why a result type instead of exceptions: parsing user input fails routinely
 * and the caller must handle it. A discriminated union makes that failure
 * visible in the type, so it cannot be ignored by accident.
 */
export type MoneyResult<T> = { ok: true; value: T } | { ok: false; error: MoneyError };

export type MoneyErrorCode =
  /** Input was empty, or whitespace only. */
  | 'empty'
  /** Input contained characters that are not part of a decimal number. */
  | 'malformed'
  /** Both `.` and `,` were used in a way that makes the decimal separator ambiguous. */
  | 'ambiguous_separators'
  /** Digit grouping was present but malformed, e.g. `1,00,0`. */
  | 'invalid_grouping'
  /** More decimal places than the currency supports, and rounding was not requested. */
  | 'too_many_decimal_places'
  /** Magnitude exceeds what a PostgreSQL BIGINT column can store. */
  | 'exceeds_safe_range'
  /** The currency code is not in the supported registry. */
  | 'unknown_currency'
  /** An operation combined two different currencies. */
  | 'currency_mismatch';

export interface MoneyError {
  readonly code: MoneyErrorCode;
  /** Human-readable, safe to show a developer. Not localised for end users. */
  readonly message: string;
}

export const ok = <T>(value: T): MoneyResult<T> => ({ ok: true, value });

export const err = <T = never>(code: MoneyErrorCode, message: string): MoneyResult<T> => ({
  ok: false,
  error: { code, message },
});

/**
 * How to handle input with more decimal places than the currency allows.
 *
 * `reject` is the default everywhere. Silent rounding of money is how cents
 * disappear, so rounding must always be an explicit choice at the call site.
 */
export type ExcessDecimalPolicy =
  /** Return `too_many_decimal_places`. */
  | 'reject'
  /** Round away from zero at the midpoint: 2.345 -> 2.35, -2.345 -> -2.35. */
  | 'round-half-up'
  /** Discard extra digits toward zero: 2.349 -> 2.34, -2.349 -> -2.34. */
  | 'truncate';

export interface ParseMoneyOptions {
  /** Default: `'reject'`. */
  readonly onExcessDecimals?: ExcessDecimalPolicy;
  /**
   * Whether `,` may be used as a thousands separator. Default: `true`.
   * Grouping is validated, not merely stripped — see `parseMoney`.
   */
  readonly allowGrouping?: boolean;
}

/**
 * PostgreSQL `BIGINT` range. Amounts are validated against this because that
 * is where they will be stored; exceeding it would fail at write time, or
 * worse, silently wrap in a less careful driver.
 */
export const MAX_SAFE_MINOR = 9_223_372_036_854_775_807n;
export const MIN_SAFE_MINOR = -9_223_372_036_854_775_808n;
