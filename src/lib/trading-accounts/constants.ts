/**
 * Trading-account constants — framework independent, shared by the
 * onboarding form (client) and the server action/service (server) so
 * neither side can drift from the other's idea of "valid".
 */

export const ACCOUNT_MODES = ['live', 'demo', 'prop', 'backtest'] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

export function isAccountMode(value: unknown): value is AccountMode {
  return typeof value === 'string' && (ACCOUNT_MODES as readonly string[]).includes(value);
}

/**
 * Drives the base-currency `<select>`'s suggested options only — the stored
 * value is validated purely by shape (`isValidBaseCurrency`), not against
 * this list, so a currency this product hasn't anticipated is never
 * rejected merely for being absent here. Deliberately not fiat-only: this
 * product does not limit accounts to a settlement-currency registry.
 */
export const SUGGESTED_BASE_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'THB',
  'USDT',
  'USDC',
  'BTC',
  'ETH',
] as const;

export const NAME_MAX_LENGTH = 80;
export const OPTIONAL_TEXT_MAX_LENGTH = 80;
export const BASE_CURRENCY_MIN_LENGTH = 2;
export const BASE_CURRENCY_MAX_LENGTH = 10;

export const DEFAULT_BASE_CURRENCY = 'USD';
export const DEFAULT_RISK_PER_TRADE_PERCENT = '1';
export const DEFAULT_MAXIMUM_DAILY_LOSS_PERCENT = '3';
