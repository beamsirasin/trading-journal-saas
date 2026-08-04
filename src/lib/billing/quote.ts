import { getPlanPrice } from './price-book';
import type { CheckoutQuote, QuoteCheckoutInput, VatConfiguration } from './types';
import {
  assertStorableNonNegativeSubtotal,
  assertValidVatRateBasisPoints,
  calculateExclusiveVat,
} from './vat';

function assertTrustedVatConfiguration(
  configuration: VatConfiguration,
): asserts configuration is VatConfiguration {
  if (typeof configuration.enabled !== 'boolean') {
    throw new TypeError('VAT enabled state must be a boolean.');
  }
  assertValidVatRateBasisPoints(configuration.rateBasisPoints);
}

/**
 * Produces one immutable, deterministic checkout quote from trusted domain
 * inputs. Monetary inputs are intentionally absent: subtotal, VAT, and total
 * are resolved and calculated here rather than accepted from a caller.
 */
export function quoteCheckout(input: QuoteCheckoutInput): CheckoutQuote {
  assertTrustedVatConfiguration(input.vatConfiguration);

  const price = getPlanPrice(input.planKey, input.currency, input.billingInterval);
  const subtotalMinor = price.amountMinor;
  assertStorableNonNegativeSubtotal(subtotalMinor);

  if (!input.vatConfiguration.enabled) {
    return Object.freeze({
      planKey: input.planKey,
      currency: input.currency,
      billingInterval: input.billingInterval,
      subtotalMinor,
      vatEnabled: false,
      appliedVatRateBasisPoints: 0,
      vatAmountMinor: 0n,
      totalMinor: subtotalMinor,
      taxMode: 'disabled',
    });
  }

  const calculation = calculateExclusiveVat(subtotalMinor, input.vatConfiguration.rateBasisPoints);

  return Object.freeze({
    planKey: input.planKey,
    currency: input.currency,
    billingInterval: input.billingInterval,
    subtotalMinor,
    vatEnabled: true,
    appliedVatRateBasisPoints: input.vatConfiguration.rateBasisPoints,
    vatAmountMinor: calculation.vatAmountMinor,
    totalMinor: calculation.totalMinor,
    taxMode: 'exclusive',
  });
}
