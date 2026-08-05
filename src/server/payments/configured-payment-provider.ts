import 'server-only';

import { assertPaymentProviderAvailable } from '@/config/billing-capability.server';

import { MockPaymentProvider, type MockPaymentOutcome } from './mock-payment-provider';
import type { PaymentProvider } from './payment-provider';

const configuredProviders = new Map<MockPaymentOutcome, PaymentProvider>();

function oneMonthAfter(start: Date): Date {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

/** Trusted server factory. Browser input can neither select nor configure the mock outcome. */
function providerForOutcome(outcome: MockPaymentOutcome): PaymentProvider {
  let configuredProvider = configuredProviders.get(outcome);
  if (configuredProvider === undefined) {
    const periodStart = new Date();
    configuredProvider = new MockPaymentProvider({
      outcome,
      periodStart,
      periodEnd: oneMonthAfter(periodStart),
    });
    configuredProviders.set(outcome, configuredProvider);
  }
  return configuredProvider;
}

/**
 * The one factory `checkoutAction`/`reconcileCheckoutAction` call for a
 * provider instance. `assertPaymentProviderAvailable` is the actual
 * production gate — it throws `PaymentProviderUnavailableError` (mapped to a
 * safe `payment_provider_unavailable` customer error) for any caller without
 * mock-checkout capability, so normal production traffic never reaches a
 * provider at all, let alone one that can create a billing transaction.
 */
export async function getConfiguredPaymentProvider(userId: string): Promise<PaymentProvider> {
  const { trustedOutcome } = await assertPaymentProviderAvailable(userId);
  return providerForOutcome(trustedOutcome ?? 'immediate_success');
}
