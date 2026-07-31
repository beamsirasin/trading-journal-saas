/**
 * Currency registry.
 *
 * `minorUnits` is the ISO 4217 exponent — the number of decimal places the
 * currency uses. It is NOT always 2, which is precisely why a hardcoded `100`
 * anywhere in this codebase is a bug: JPY and KRW have zero decimals, so
 * ¥100 is 100 minor units, not 10,000.
 */

export interface CurrencyMeta {
  readonly code: CurrencyCode;
  /** ISO 4217 exponent: decimal places used by the currency. */
  readonly minorUnits: number;
  /** Symbol for compact display. Not unique across currencies. */
  readonly symbol: string;
  readonly name: string;
}

export const CURRENCIES = {
  THB: { code: 'THB', minorUnits: 2, symbol: '฿', name: 'Thai Baht' },
  USD: { code: 'USD', minorUnits: 2, symbol: '$', name: 'US Dollar' },
  EUR: { code: 'EUR', minorUnits: 2, symbol: '€', name: 'Euro' },
  GBP: { code: 'GBP', minorUnits: 2, symbol: '£', name: 'Pound Sterling' },
  AUD: { code: 'AUD', minorUnits: 2, symbol: 'A$', name: 'Australian Dollar' },
  CAD: { code: 'CAD', minorUnits: 2, symbol: 'C$', name: 'Canadian Dollar' },
  CHF: { code: 'CHF', minorUnits: 2, symbol: 'CHF', name: 'Swiss Franc' },
  SGD: { code: 'SGD', minorUnits: 2, symbol: 'S$', name: 'Singapore Dollar' },
  HKD: { code: 'HKD', minorUnits: 2, symbol: 'HK$', name: 'Hong Kong Dollar' },
  MYR: { code: 'MYR', minorUnits: 2, symbol: 'RM', name: 'Malaysian Ringgit' },
  INR: { code: 'INR', minorUnits: 2, symbol: '₹', name: 'Indian Rupee' },
  NZD: { code: 'NZD', minorUnits: 2, symbol: 'NZ$', name: 'New Zealand Dollar' },
  ZAR: { code: 'ZAR', minorUnits: 2, symbol: 'R', name: 'South African Rand' },
  PHP: { code: 'PHP', minorUnits: 2, symbol: '₱', name: 'Philippine Peso' },

  // Zero-decimal currencies. These are the ones that break naive `* 100` code.
  JPY: { code: 'JPY', minorUnits: 0, symbol: '¥', name: 'Japanese Yen' },
  KRW: { code: 'KRW', minorUnits: 0, symbol: '₩', name: 'South Korean Won' },
  VND: { code: 'VND', minorUnits: 0, symbol: '₫', name: 'Vietnamese Dong' },
  IDR: { code: 'IDR', minorUnits: 0, symbol: 'Rp', name: 'Indonesian Rupiah' },
} as const satisfies Record<string, Omit<CurrencyMeta, 'code'> & { code: string }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

export function getCurrency(code: CurrencyCode): CurrencyMeta {
  return CURRENCIES[code];
}

/**
 * Decimal places for a currency. Always read this rather than assuming 2.
 */
export function minorUnitsFor(code: CurrencyCode): number {
  return CURRENCIES[code].minorUnits;
}

/**
 * 10^minorUnits as a bigint — the divisor between major and minor units.
 * Computed by repeated multiplication rather than `10 ** n` so that no
 * floating-point step is involved at any point.
 */
export function minorUnitScale(code: CurrencyCode): bigint {
  let scale = 1n;
  for (let i = 0; i < CURRENCIES[code].minorUnits; i += 1) {
    scale *= 10n;
  }
  return scale;
}
