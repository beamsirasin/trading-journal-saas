import 'server-only';

import { DEFAULT_VAT_CONFIGURATION } from '@/config/billing.server';
import { PLAN_DEFINITIONS, SHARED_BILLING_FEATURE_KEYS, type PlanKey } from '@/config/plan-catalog';
import {
  BILLING_CURRENCIES,
  getDefaultBillingCurrency,
  getPlanPrice,
  quoteCheckout,
  type BillingCurrency,
  type VatConfiguration,
} from '@/lib/billing';
import type {
  BillingMoneyPresentation,
  BillingPlanPresentation,
  BillingPresentation,
  CheckoutQuotePresentation,
  VatPresentation,
} from '@/lib/billing/presentation-types';
import { formatMoney } from '@/lib/money';

type BillingLocale = BillingPresentation['locale'];

function money(amountMinor: bigint, currency: BillingCurrency): BillingMoneyPresentation {
  return Object.freeze({
    currency,
    amountMinor: amountMinor.toString(),
    formatted: formatMoney({ amountMinor, currency }, { style: 'symbol' }),
  });
}

function ratePercent(rateBasisPoints: number): string {
  const whole = Math.trunc(rateBasisPoints / 100);
  const fraction = rateBasisPoints % 100;
  return fraction === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(2, '0')}`;
}

function vat(configuration: VatConfiguration): VatPresentation {
  return Object.freeze({
    enabled: configuration.enabled,
    rateBasisPoints: configuration.rateBasisPoints,
    ratePercent: ratePercent(configuration.rateBasisPoints),
  });
}

function plan(definition: (typeof PLAN_DEFINITIONS)[number]): BillingPlanPresentation {
  return Object.freeze({
    id: definition.id,
    name: definition.name,
    activeTradingAccountLimit: definition.activeTradingAccountLimit,
    featured: definition.featured,
    prices: Object.freeze({
      THB: money(getPlanPrice(definition.id, 'THB', 'monthly').amountMinor, 'THB'),
      USD: money(getPlanPrice(definition.id, 'USD', 'monthly').amountMinor, 'USD'),
    }),
  });
}

/** The only server boundary that turns billing configuration into browser-safe display data. */
export function getBillingPresentation(
  locale: BillingLocale,
  configuration: VatConfiguration = DEFAULT_VAT_CONFIGURATION,
): BillingPresentation {
  return Object.freeze({
    locale,
    supportedCurrencies: BILLING_CURRENCIES,
    defaultCurrency: getDefaultBillingCurrency(locale),
    billingInterval: 'monthly',
    plans: Object.freeze(PLAN_DEFINITIONS.map(plan)),
    sharedFeatureKeys: SHARED_BILLING_FEATURE_KEYS,
    vat: vat(configuration),
  });
}

/** Fresh trusted quotation for checkout; no customer-supplied money enters this function. */
export function getCheckoutQuotePresentation(
  locale: BillingLocale,
  planKey: PlanKey,
  currency: BillingCurrency,
  configuration: VatConfiguration = DEFAULT_VAT_CONFIGURATION,
): CheckoutQuotePresentation {
  const presentation = getBillingPresentation(locale, configuration);
  const selectedPlan = presentation.plans.find((candidate) => candidate.id === planKey);
  if (selectedPlan === undefined) throw new RangeError(`Unsupported plan key: ${planKey}`);
  const quote = quoteCheckout({
    planKey,
    currency,
    billingInterval: 'monthly',
    vatConfiguration: configuration,
  });

  return Object.freeze({
    plan: selectedPlan,
    currency,
    billingInterval: 'monthly',
    subtotal: money(quote.subtotalMinor, currency),
    vat: Object.freeze({ ...vat(configuration), amount: money(quote.vatAmountMinor, currency) }),
    total: money(quote.totalMinor, currency),
  });
}

/** Converts a trusted service result without ever serializing bigint into a client boundary. */
export function presentCheckoutMoney(
  amountMinor: bigint,
  currency: BillingCurrency,
): BillingMoneyPresentation {
  return money(amountMinor, currency);
}
