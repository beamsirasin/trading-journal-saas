import Decimal from 'decimal.js';

import { BASE_CURRENCY_MAX_LENGTH, BASE_CURRENCY_MIN_LENGTH } from './constants';

/**
 * Pure validators — no React, no database, no server-only import. Reused
 * identically by the client form's immediate feedback and the server
 * action's authoritative check (never re-implemented per call site).
 */

const BASE_CURRENCY_PATTERN = new RegExp(
  `^[A-Z0-9]{${BASE_CURRENCY_MIN_LENGTH},${BASE_CURRENCY_MAX_LENGTH}}$`,
);

/**
 * Not limited to the closed, fiat-only `CurrencyCode` registry
 * (`src/lib/money/currencies.ts`) — see `trading-accounts.ts` schema
 * comment for why. Uppercase alphanumeric only: this single whitelist
 * already excludes whitespace, HTML, and control characters by construction
 * rather than needing a separate check for each.
 */
export function isValidBaseCurrency(value: unknown): value is string {
  return typeof value === 'string' && BASE_CURRENCY_PATTERN.test(value);
}

const HTML_MARKUP_PATTERN = /[<>]/;

/**
 * Defence in depth for free-text fields (account name, broker, platform) —
 * React already escapes render output, but nothing here should ever store a
 * C0/DEL control character or raw angle-bracket markup either. Checked by
 * character code rather than a control-character regex range, which is easy
 * to mistype or have silently mangled by an intermediate tool into literal
 * bytes instead of an escape sequence.
 */
export function hasNoControlOrHtmlCharacters(value: string): boolean {
  if (HTML_MARKUP_PATTERN.test(value)) {
    return false;
  }
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * Deliberately stricter than `src/lib/money/parseMoney`: no thousands
 * grouping, no leading `+`/`-` sign (neither a balance nor a percentage in
 * this form is ever negative), no scientific notation. A plain, unambiguous
 * decimal string only — exactly what a numeric HTML input naturally
 * produces.
 */
const PLAIN_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/** Parses a strictly-shaped non-negative decimal string. Never returns a JS `number` — callers compare using `Decimal`'s own methods. */
export function parsePlainDecimal(value: unknown): Decimal | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!PLAIN_DECIMAL_PATTERN.test(trimmed)) {
    return null;
  }
  try {
    return new Decimal(trimmed);
  } catch {
    return null;
  }
}

/** `startingBalance` — an opening reference figure only; no arithmetic is performed on it this phase. */
export function isValidStartingBalance(value: unknown): boolean {
  const decimal = parsePlainDecimal(value);
  return decimal !== null && decimal.isFinite() && decimal.greaterThanOrEqualTo(0);
}

/** `riskPerTradePercent` / `maximumDailyLossPercent` — strictly between 0 (exclusive) and 100 (inclusive) when provided at all. */
export function isValidPercent(value: unknown): boolean {
  const decimal = parsePlainDecimal(value);
  return (
    decimal !== null &&
    decimal.isFinite() &&
    decimal.greaterThan(0) &&
    decimal.lessThanOrEqualTo(100)
  );
}
