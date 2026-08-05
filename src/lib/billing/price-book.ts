import { getPlanDefinition, type PlanKey } from '@/config/plan-catalog';

import type { BillingCurrency, BillingInterval, PlanPrice, PriceBook } from './types';

export const BILLING_CURRENCIES = Object.freeze([
  'THB',
  'USD',
] as const satisfies readonly BillingCurrency[]);
export const BILLING_INTERVALS = Object.freeze([
  'monthly',
] as const satisfies readonly BillingInterval[]);

/**
 * The sole monetary source of truth for paid-plan prices.
 *
 * Amounts are integer minor units: 14900n THB means THB 149.00. THB and USD
 * are independent fixed price books; there is deliberately no exchange-rate
 * conversion or derived cross-currency price.
 */
export const PRICE_BOOK: PriceBook = Object.freeze({
  starter: Object.freeze({
    monthly: Object.freeze({ THB: 14_900n, USD: 500n }),
  }),
  trader: Object.freeze({
    monthly: Object.freeze({ THB: 29_900n, USD: 900n }),
  }),
  professional: Object.freeze({
    monthly: Object.freeze({ THB: 49_900n, USD: 1_500n }),
  }),
});

export function isSupportedBillingCurrency(value: unknown): value is BillingCurrency {
  return value === 'THB' || value === 'USD';
}

export function assertSupportedBillingCurrency(value: unknown): asserts value is BillingCurrency {
  if (!isSupportedBillingCurrency(value)) {
    throw new RangeError(`Unsupported billing currency: ${String(value)}`);
  }
}

export function isSupportedBillingInterval(value: unknown): value is BillingInterval {
  return value === 'monthly';
}

export function assertSupportedBillingInterval(value: unknown): asserts value is BillingInterval {
  if (!isSupportedBillingInterval(value)) {
    throw new RangeError(`Unsupported billing interval: ${String(value)}`);
  }
}

/** Locale chooses only the initial display default; customers may select either supported currency. */
export function getDefaultBillingCurrency(locale: 'en' | 'th'): BillingCurrency {
  return locale === 'th' ? 'THB' : 'USD';
}

export function getPlanPrice(
  planKey: PlanKey,
  currency: BillingCurrency,
  billingInterval: BillingInterval,
): PlanPrice {
  // Runtime validation remains necessary even though TypeScript protects
  // ordinary internal callers: future request parsing and provider payloads
  // are runtime data and may use casts or plain JavaScript.
  getPlanDefinition(planKey);
  assertSupportedBillingCurrency(currency);
  assertSupportedBillingInterval(billingInterval);

  return Object.freeze({
    planKey,
    currency,
    billingInterval,
    amountMinor: PRICE_BOOK[planKey][billingInterval][currency],
  });
}
