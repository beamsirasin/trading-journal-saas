/**
 * Money primitives.
 *
 * Stored representation: integer minor units in a `bigint`, plus an ISO 4217
 * currency code. No floating-point arithmetic occurs anywhere in this module,
 * including during parsing and formatting.
 *
 * See docs/calculation-spec.md §1 for the storage contract and
 * docs/decisions/0002-money-representation.md for why.
 *
 * NOT SUPPORTED HERE (deliberately):
 *   - multiplication, division, percentages  -> `src/lib/calc/` (Phase 07C/D),
 *     where a rounding rule can be specified per formula
 *   - currency conversion / FX rates         -> out of MVP scope
 *   - instrument prices                      -> `src/lib/calc/` uses
 *     `NUMERIC(20,10)` with decimal.js; minor units cannot represent 1.08532
 *   - locale-aware parsing or formatting     -> presentation concern, later
 *   - accounting-style negatives "(12.34)"
 */

export {
  CURRENCIES,
  CURRENCY_CODES,
  getCurrency,
  isCurrencyCode,
  minorUnitScale,
  minorUnitsFor,
  type CurrencyCode,
  type CurrencyMeta,
} from './currencies';

export {
  MAX_SAFE_MINOR,
  MIN_SAFE_MINOR,
  type ExcessDecimalPolicy,
  type Money,
  type MoneyError,
  type MoneyErrorCode,
  type MoneyResult,
  type ParseMoneyOptions,
} from './types';

export { fromMinorUnits, parseMoney } from './parse';

export { formatMoney, toDecimalString, type FormatMoneyOptions } from './format';

export {
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
