import {
  isCurrencyCode,
  MAX_SAFE_MINOR,
  MIN_SAFE_MINOR,
  parseMoney,
  toDecimalString,
} from '@/lib/money';
import { parseInstant, toIsoUtc, wallClockIn, wallClockToInstant } from '@/lib/time';

export type TradeFormValueResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly code: string };

/**
 * Converts human-readable account money to the action layer's minor-unit
 * string. Unknown account currencies use an explicit raw-minor fallback;
 * they are never guessed to have two decimal places.
 */
export function parseTradeMoneyInput(
  input: string,
  currency: string,
  options: { readonly allowNegative?: boolean; readonly allowZero?: boolean } = {},
): TradeFormValueResult {
  let amount: bigint;

  if (isCurrencyCode(currency)) {
    const parsed = parseMoney(input, currency);
    if (!parsed.ok) return { ok: false, code: parsed.error.code };
    amount = parsed.value.amountMinor;
  } else {
    const trimmed = input.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false, code: 'raw_minor_required' };
    amount = BigInt(trimmed);
    if (amount < MIN_SAFE_MINOR || amount > MAX_SAFE_MINOR) {
      return { ok: false, code: 'exceeds_safe_range' };
    }
  }

  if (!options.allowNegative && amount < 0n) return { ok: false, code: 'negative_not_allowed' };
  if (!options.allowZero && amount === 0n) return { ok: false, code: 'zero_not_allowed' };
  return { ok: true, value: amount.toString() };
}

export function tradeMoneyInputValue(minor: string | null, currency: string): string {
  if (minor === null) return '';
  if (!isCurrencyCode(currency)) return minor;
  const amount = BigInt(minor);
  return toDecimalString({ amountMinor: amount, currency });
}

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Converts a datetime-local wall clock in the persisted IANA zone to UTC. */
export function datetimeLocalToIso(input: string, timezone: string): TradeFormValueResult {
  const match = DATETIME_LOCAL_PATTERN.exec(input);
  if (match === null) return { ok: false, code: 'invalid_datetime' };
  const resolved = wallClockToInstant(
    {
      year: Number.parseInt(match[1] as string, 10),
      month: Number.parseInt(match[2] as string, 10),
      day: Number.parseInt(match[3] as string, 10),
      hour: Number.parseInt(match[4] as string, 10),
      minute: Number.parseInt(match[5] as string, 10),
      second: 0,
    },
    timezone,
  );
  if (!resolved.ok) return { ok: false, code: resolved.error.code };
  const iso = toIsoUtc(resolved.value);
  return iso.ok ? { ok: true, value: iso.value } : { ok: false, code: iso.error.code };
}

/** Formats a stored UTC instant for a datetime-local control in the persisted zone. */
export function instantToDatetimeLocal(input: string | null, timezone: string): string {
  if (input === null) return '';
  const parsed = parseInstant(input);
  if (!parsed.ok) return '';
  const wall = wallClockIn(parsed.value, timezone);
  if (!wall.ok) return '';
  const value = wall.value;
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
}
