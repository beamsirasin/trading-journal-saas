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
