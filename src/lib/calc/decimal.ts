import Decimal from 'decimal.js';

/**
 * A locally cloned Decimal constructor, scoped to `src/lib/calc/` only.
 * Every other module in this repository that imports `decimal.js` gets the
 * library's own default global configuration, untouched — this file never
 * calls `Decimal.set(...)` on that global default, which would silently
 * change rounding/precision for every unrelated import in the same process.
 *
 * `precision: 50` (significant digits) comfortably covers the widest
 * persisted primitive this engine reads — `NUMERIC(20,10)` instrument
 * prices — with room to spare for an unrounded intermediate division,
 * so no significant digit is ever lost before the one deliberate rounding
 * step at the end of each calculation (see `toCanonicalR` below).
 *
 * `rounding: ROUND_HALF_UP` matches this repository's one other documented
 * rounding convention: `src/lib/trading-accounts/validation.ts`'s
 * `parsePlainDecimal`-adjacent money parsing
 * (`src/lib/money/parse.ts`'s `fitFraction`) documents "round-half-up, on
 * the magnitude ... rounds away from zero symmetrically for negative
 * amounts" — decimal.js's `ROUND_HALF_UP` is precisely that definition, so
 * this engine does not introduce a second, different rounding convention
 * (e.g. banker's rounding) alongside the one the money module already
 * established.
 */
export const CalcDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
});

export type CalcDecimalValue = InstanceType<typeof CalcDecimal>;

/**
 * No thousands grouping, no scientific notation, an optional leading sign —
 * exactly what a `NUMERIC` column or a plain numeric form field produces.
 * Mirrors `src/lib/trading-accounts/validation.ts`'s `parsePlainDecimal`
 * exactly (same regex-then-construct-then-catch shape), broadened to accept
 * a sign: R values and net P&L are routinely negative, unlike the
 * non-negative-only balance/percentage fields that helper validates.
 */
const SIGNED_DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/**
 * Parses a decimal-safe string into a `CalcDecimal`, or `null` if the input
 * is not a well-formed plain decimal. Never returns a JS `number` — callers
 * compare and compute using the returned `Decimal`'s own methods.
 */
export function parseCalcDecimal(value: unknown): CalcDecimalValue | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!SIGNED_DECIMAL_PATTERN.test(trimmed)) return null;
  try {
    const decimal = new CalcDecimal(trimmed);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

/**
 * Converts a `bigint` (minor-unit money, or any exact integer ratio input)
 * to a `CalcDecimal` through exact string conversion. `bigint` never passes
 * through a JS `number` on the way to `Decimal` — the entire reason this
 * function exists rather than callers writing `Number(bigintValue)` — so a
 * large monetary amount never silently loses precision by crossing
 * `Number.MAX_SAFE_INTEGER`.
 */
export function bigintToCalcDecimal(value: bigint): CalcDecimalValue {
  return new CalcDecimal(value.toString());
}

/**
 * The one canonical rounding step for a persisted/snapshot R value —
 * `NUMERIC(12,4)`, four decimal places, `ROUND_HALF_UP`. Every exported
 * R-producing function in `trade.ts` calls this exactly once, at its own
 * final return, on a full-precision unrounded `CalcDecimal` — never before,
 * and never on an already-rounded intermediate (a second rounding pass on a
 * value that was already rounded once is how compounding rounding error
 * quietly enters a "deterministic" pipeline).
 *
 * Normalizes negative zero (`-0.0000`) to `'0.0000'` — `Decimal#toFixed`
 * alone does not.
 */
export function toCanonicalR(value: CalcDecimalValue): string {
  const rounded = value.toDecimalPlaces(4, CalcDecimal.ROUND_HALF_UP);
  if (rounded.isZero()) return '0.0000';
  return rounded.toFixed(4);
}
