import {
  getCurrency,
  isCurrencyCode,
  minorUnitScale,
  minorUnitsFor,
  type CurrencyCode,
} from './currencies';
import {
  err,
  MAX_SAFE_MINOR,
  MIN_SAFE_MINOR,
  ok,
  type ExcessDecimalPolicy,
  type Money,
  type MoneyResult,
  type ParseMoneyOptions,
} from './types';

/**
 * Parsing policy — deliberately strict, and documented because "be liberal in
 * what you accept" is the wrong instinct for money.
 *
 * ACCEPTED
 *   "1234.56"      plain decimal
 *   "1,234.56"     `,` as a thousands separator, in well-formed 3-digit groups
 *   "-1234.56"     leading sign, `-` or `+`
 *   ".5"           leading decimal point, read as 0.5
 *   "5."           trailing decimal point, read as 5
 *   "  12.30  "    surrounding whitespace
 *
 * REJECTED
 *   "1.234,56"     European convention — ambiguous against "1.234"
 *   "1,23"         malformed grouping
 *   "1.2.3"        multiple decimal points
 *   "12.345" (USD) more decimals than the currency has, unless a rounding
 *                  policy is passed explicitly
 *   "(12.34)"      accounting negatives — not supported, see below
 *   "$12.34"       currency symbols — the currency is a separate argument
 *
 * The European case matters: "1.234" means 1234 in Germany and 1.234 in the
 * US. Guessing would silently corrupt an amount by a factor of 1000, so it is
 * refused instead. A locale-aware parser can be added later behind an explicit
 * locale argument.
 *
 * NOT SUPPORTED YET: accounting parentheses, unicode minus (U+2212), NBSP or
 * apostrophe grouping, exponent notation, and currency symbols in the string.
 */

const SIGN_PATTERN = /^[+-]/;
const ALLOWED_BODY = /^[0-9.,]+$/;
const DIGITS_ONLY = /^[0-9]*$/;

export function parseMoney(
  input: string,
  currency: CurrencyCode,
  options: ParseMoneyOptions = {},
): MoneyResult<Money> {
  if (!isCurrencyCode(currency)) {
    return err('unknown_currency', `Unknown currency code: ${String(currency)}`);
  }

  const policy: ExcessDecimalPolicy = options.onExcessDecimals ?? 'reject';
  const allowGrouping = options.allowGrouping ?? true;

  const trimmed = input.trim();
  if (trimmed === '') {
    return err('empty', 'Amount is empty.');
  }

  let negative = false;
  let body = trimmed;
  const signMatch = SIGN_PATTERN.exec(body);
  if (signMatch) {
    negative = signMatch[0] === '-';
    body = body.slice(1);
  }

  if (body === '' || !ALLOWED_BODY.test(body)) {
    return err('malformed', `"${input}" is not a valid decimal amount.`);
  }

  const dotCount = (body.match(/\./g) ?? []).length;
  const commaCount = (body.match(/,/g) ?? []).length;

  if (dotCount > 1) {
    return err('malformed', `"${input}" contains more than one decimal point.`);
  }

  if (commaCount > 0) {
    if (!allowGrouping) {
      return err('malformed', `"${input}" contains a thousands separator, which is not allowed.`);
    }
    // A comma appearing after the decimal point means the string uses `,` as
    // the decimal separator. Refuse rather than guess.
    if (dotCount === 1 && body.lastIndexOf(',') > body.indexOf('.')) {
      return err(
        'ambiguous_separators',
        `"${input}" mixes '.' and ',' ambiguously. Use '.' as the decimal separator.`,
      );
    }
  }

  const dotIndex = body.indexOf('.');
  const rawInteger = dotIndex === -1 ? body : body.slice(0, dotIndex);
  const rawFraction = dotIndex === -1 ? '' : body.slice(dotIndex + 1);

  if (rawFraction.includes(',')) {
    return err('malformed', `"${input}" contains a separator in its decimal places.`);
  }
  if (!DIGITS_ONLY.test(rawFraction)) {
    return err('malformed', `"${input}" has non-numeric decimal places.`);
  }

  const integerDigits = rawInteger.includes(',')
    ? validateAndStripGrouping(rawInteger)
    : rawInteger;

  if (integerDigits === null) {
    return err('invalid_grouping', `"${input}" has malformed digit grouping.`);
  }
  if (!DIGITS_ONLY.test(integerDigits)) {
    return err('malformed', `"${input}" is not a valid decimal amount.`);
  }
  if (integerDigits === '' && rawFraction === '') {
    return err('malformed', `"${input}" contains no digits.`);
  }

  const decimals = minorUnitsFor(currency);
  const fractionResult = fitFraction(rawFraction, decimals, policy, input, currency);
  if (!fractionResult.ok) {
    return fractionResult;
  }

  const { digits: fractionDigits, carry } = fractionResult.value;

  const scale = minorUnitScale(currency);
  const integerPart = integerDigits === '' ? 0n : BigInt(integerDigits);
  const fractionPart = fractionDigits === '' ? 0n : BigInt(fractionDigits);

  let magnitude = integerPart * scale + fractionPart + carry;
  if (negative) {
    magnitude = -magnitude;
  }

  if (magnitude > MAX_SAFE_MINOR || magnitude < MIN_SAFE_MINOR) {
    return err(
      'exceeds_safe_range',
      `${input} ${currency} exceeds the storable range for a 64-bit integer amount.`,
    );
  }

  // Normalise -0 to 0 so that equality checks behave.
  return ok({ amountMinor: magnitude === 0n ? 0n : magnitude, currency });
}

/**
 * Validates `,` grouping and returns the bare digits, or `null` if the groups
 * are malformed. Grouping is checked rather than merely stripped: silently
 * accepting "1,23,4" would mean accepting input the user clearly mistyped.
 */
function validateAndStripGrouping(integerPart: string): string | null {
  const groups = integerPart.split(',');
  if (groups.length < 2) {
    return null;
  }

  const [first, ...rest] = groups;
  if (first === undefined || first.length === 0 || first.length > 3) {
    return null;
  }
  if (!DIGITS_ONLY.test(first)) {
    return null;
  }
  for (const group of rest) {
    if (group.length !== 3 || !DIGITS_ONLY.test(group)) {
      return null;
    }
  }

  return groups.join('');
}

interface FittedFraction {
  /** Exactly `decimals` digits, zero-padded. */
  readonly digits: string;
  /** 1n when rounding pushed the value up a minor unit, else 0n. */
  readonly carry: bigint;
}

function fitFraction(
  rawFraction: string,
  decimals: number,
  policy: ExcessDecimalPolicy,
  originalInput: string,
  currency: CurrencyCode,
): MoneyResult<FittedFraction> {
  if (rawFraction.length <= decimals) {
    return ok({ digits: rawFraction.padEnd(decimals, '0'), carry: 0n });
  }

  if (policy === 'reject') {
    const meta = getCurrency(currency);
    return err(
      'too_many_decimal_places',
      `"${originalInput}" has ${rawFraction.length} decimal places but ${meta.code} supports ${decimals}. ` +
        `Pass onExcessDecimals to round explicitly.`,
    );
  }

  const kept = rawFraction.slice(0, decimals);
  if (policy === 'truncate') {
    return ok({ digits: kept, carry: 0n });
  }

  // round-half-up, on the magnitude — the sign is applied by the caller, so
  // this rounds away from zero symmetrically for negative amounts.
  const nextDigit = rawFraction.charAt(decimals);
  const roundsUp = nextDigit >= '5';
  return ok({ digits: kept, carry: roundsUp ? 1n : 0n });
}

/**
 * Builds a Money from an already-integral minor-unit value, validating range.
 * Use this at the database boundary, never `parseMoney`.
 */
export function fromMinorUnits(amountMinor: bigint, currency: CurrencyCode): MoneyResult<Money> {
  if (!isCurrencyCode(currency)) {
    return err('unknown_currency', `Unknown currency code: ${String(currency)}`);
  }
  if (amountMinor > MAX_SAFE_MINOR || amountMinor < MIN_SAFE_MINOR) {
    return err('exceeds_safe_range', `${amountMinor} exceeds the storable 64-bit integer range.`);
  }
  return ok({ amountMinor, currency });
}
