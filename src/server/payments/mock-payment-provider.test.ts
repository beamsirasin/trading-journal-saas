import { describe, expect, it } from 'vitest';

import { MockPaymentProvider } from './mock-payment-provider';
import type { CreatePaymentInput, PaymentProviderError } from './payment-provider';

const PERIOD_START = new Date('2026-08-01T00:00:00Z');
const PERIOD_END = new Date('2026-09-01T00:00:00Z');

function request(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    providerIdempotencyKey: 'trusted-provider-key',
    billingTransactionId: '0198a111-1111-7111-8111-111111111111',
    amountMinor: 14_900n,
    currency: 'THB',
    billingInterval: 'monthly',
    metadata: {
      billingTransactionId: '0198a111-1111-7111-8111-111111111111',
      workspaceId: '0198a222-2222-7222-8222-222222222222',
    },
    ...overrides,
  };
}

describe('MockPaymentProvider', () => {
  it('returns deterministic immediate success with the trusted period', async () => {
    const provider = new MockPaymentProvider({
      outcome: 'immediate_success',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    const first = await provider.createOrRetrievePayment(request());
    const retry = await provider.createOrRetrievePayment(request());

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      status: 'succeeded',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(first.providerCheckoutId).toMatch(/^mock_checkout_[a-f0-9]{24}$/);
    expect(first.providerPaymentId).toMatch(/^mock_payment_[a-f0-9]{24}$/);
    expect(provider.paymentCount).toBe(1);
  });

  it('supports immediate decline with a safe configured code', async () => {
    const provider = new MockPaymentProvider({
      outcome: 'immediate_decline',
      failureCode: 'card_declined',
    });
    await expect(provider.createOrRetrievePayment(request())).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'card_declined',
      periodStart: null,
      periodEnd: null,
    });
  });

  it('supports processing followed by success', async () => {
    const provider = new MockPaymentProvider({
      outcome: 'processing_then_success',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    const created = await provider.createOrRetrievePayment(request());
    expect(created.status).toBe('processing');
    await expect(
      provider.retrievePayment({ providerCheckoutId: created.providerCheckoutId }),
    ).resolves.toMatchObject({ status: 'succeeded', periodEnd: PERIOD_END });
  });

  it('supports processing followed by failure', async () => {
    const provider = new MockPaymentProvider({
      outcome: 'processing_then_failure',
      failureCode: 'insufficient_funds',
    });
    const created = await provider.createOrRetrievePayment(request());
    await expect(
      provider.retrievePayment({ providerCheckoutId: created.providerCheckoutId }),
    ).resolves.toMatchObject({ status: 'failed', failureCode: 'insufficient_funds' });
  });

  it('supports cancellation', async () => {
    const provider = new MockPaymentProvider({ outcome: 'canceled' });
    await expect(provider.createOrRetrievePayment(request())).resolves.toMatchObject({
      status: 'canceled',
      failureCode: null,
    });
  });

  it('fails closed when a provider key is reused with conflicting money or currency', async () => {
    const provider = new MockPaymentProvider({ outcome: 'immediate_decline' });
    await provider.createOrRetrievePayment(request());

    for (const conflicting of [request({ amountMinor: 500n }), request({ currency: 'USD' })]) {
      await expect(provider.createOrRetrievePayment(conflicting)).rejects.toMatchObject({
        code: 'provider_idempotency_conflict',
      } satisfies Partial<PaymentProviderError>);
    }
    expect(provider.paymentCount).toBe(1);
  });

  it('ignores customer-like outcome fields because they are outside the provider contract', async () => {
    const provider = new MockPaymentProvider({ outcome: 'immediate_decline' });
    const untrustedShape = {
      ...request(),
      mockOutcome: 'immediate_success',
      forceSuccess: true,
      providerStatus: 'succeeded',
    } as CreatePaymentInput;

    await expect(provider.createOrRetrievePayment(untrustedShape)).resolves.toMatchObject({
      status: 'failed',
    });
  });
});
