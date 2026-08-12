import { MAX_SAFE_MINOR } from '@/lib/money';

export const BASIS_POINTS_SCALE = 10_000;
export const PREPARED_VAT_RATE_BASIS_POINTS = 700;

export interface ExclusiveVatCalculation {
  readonly vatAmountMinor: bigint;
  readonly totalMinor: bigint;
}

export function assertValidVatRateBasisPoints(
  rateBasisPoints: unknown,
): asserts rateBasisPoints is number {
  if (
    typeof rateBasisPoints !== 'number' ||
    !Number.isInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > BASIS_POINTS_SCALE
  ) {
    throw new RangeError('VAT rate must be an integer from 0 through 10000 basis points.');
  }
}

/**
 * Calculates exclusive VAT once on the final non-negative taxable subtotal.
 *
 * Round-half-up is performed entirely with integer arithmetic:
 *   (subtotalMinor * rateBasisPoints + 5000) / 10000
 *
 * PostgreSQL BIGINT guards apply to values that will be stored (subtotal,
 * VAT, and total). The bigint intermediate is exact and is never persisted.
 */
export function calculateExclusiveVat(
  subtotalMinor: bigint,
  rateBasisPoints: number,
): ExclusiveVatCalculation {
  assertStorableNonNegativeSubtotal(subtotalMinor);
  assertValidVatRateBasisPoints(rateBasisPoints);

  const vatAmountMinor =
    (subtotalMinor * BigInt(rateBasisPoints) + 5_000n) / BigInt(BASIS_POINTS_SCALE);

  if (vatAmountMinor > MAX_SAFE_MINOR) {
    throw new RangeError('VAT amount exceeds the PostgreSQL BIGINT range.');
  }
  if (subtotalMinor > MAX_SAFE_MINOR - vatAmountMinor) {
    throw new RangeError('Checkout total exceeds the PostgreSQL BIGINT range.');
  }

  return Object.freeze({
    vatAmountMinor,
    totalMinor: subtotalMinor + vatAmountMinor,
  });
}

export function assertStorableNonNegativeSubtotal(subtotalMinor: bigint): void {
  if (subtotalMinor < 0n) {
    throw new RangeError('Checkout subtotal cannot be negative.');
  }
  if (subtotalMinor > MAX_SAFE_MINOR) {
    throw new RangeError('Checkout subtotal exceeds the PostgreSQL BIGINT range.');
  }
}

/**
 * Exact operator-facing rate percentage <-> basis-points conversion — the
 * ONE helper either direction uses (Phase 11F), so Admin input parsing and
 * Admin display formatting can never drift from each other or reintroduce a
 * second ad hoc formula. Basis points are 1/100 of one percentage point, so
 * the input grammar allows at most two decimal digits; anything else (three+
 * decimals, scientific notation, a comma decimal, a sign, whitespace-only,
 * empty) is rejected outright rather than coerced. Parsing is pure string ->
 * integer arithmetic — never `Number.parseFloat`/division on a fraction —
 * so there is no floating-point rounding step to get wrong.
 */
const RATE_PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function parseExactVatRatePercent(input: string): number {
  const match = RATE_PERCENT_PATTERN.exec(input.trim());
  if (match === null) {
    throw new RangeError(
      'VAT rate must be a plain decimal percentage with at most two decimal places (e.g. "7", "7.5", "7.25").',
    );
  }
  const wholeDigits = match[1];
  if (wholeDigits === undefined) {
    throw new RangeError('VAT rate must be a plain decimal percentage.');
  }
  const fractionDigits = (match[2] ?? '').padEnd(2, '0');
  const basisPoints = Number.parseInt(wholeDigits, 10) * 100 + Number.parseInt(fractionDigits, 10);
  assertValidVatRateBasisPoints(basisPoints);
  return basisPoints;
}

/** The display-side inverse of `parseExactVatRatePercent` — always exactly two decimal places (e.g. `700 -> "7.00"`, `10000 -> "100.00"`), for Admin read models and the rate input's pre-filled value. Not the same helper as customer-facing pricing copy's own trailing-zero-trimmed `ratePercent` (`src/server/billing/presentation.ts`), which is a distinct, unrelated presentational choice this module does not touch. */
export function formatExactVatRatePercent(rateBasisPoints: number): string {
  assertValidVatRateBasisPoints(rateBasisPoints);
  const whole = Math.trunc(rateBasisPoints / 100);
  const fraction = rateBasisPoints % 100;
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}
