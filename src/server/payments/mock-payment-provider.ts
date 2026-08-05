import { createHash } from 'node:crypto';

import {
  PaymentProviderError,
  type CreatePaymentInput,
  type PaymentProvider,
  type ProviderPayment,
  type RetrievePaymentInput,
} from './payment-provider';

export type MockPaymentOutcome =
  | 'immediate_success'
  | 'immediate_decline'
  | 'processing_then_success'
  | 'processing_then_failure'
  | 'canceled';

export interface MockPaymentProviderConfiguration {
  readonly outcome: MockPaymentOutcome;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
  readonly failureCode?: string;
}

interface StoredMockPayment {
  readonly fingerprint: string;
  readonly providerCheckoutId: string;
  readonly providerPaymentId: string;
  retrievalCount: number;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function fingerprint(input: CreatePaymentInput): string {
  return [
    input.billingTransactionId,
    input.amountMinor.toString(),
    input.currency,
    input.billingInterval,
    input.metadata.billingTransactionId,
    input.metadata.workspaceId,
  ].join('|');
}

/**
 * Deterministic, instance-scoped test provider. Outcome configuration is
 * supplied only when constructing the trusted adapter; it is absent from the
 * checkout request and provider request contracts.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly kind = 'mock';
  readonly #configuration: MockPaymentProviderConfiguration;
  readonly #paymentsByKey = new Map<string, StoredMockPayment>();
  readonly #paymentsByCheckoutId = new Map<string, StoredMockPayment>();

  constructor(configuration: MockPaymentProviderConfiguration) {
    this.#configuration = configuration;
  }

  get paymentCount(): number {
    return this.#paymentsByKey.size;
  }

  async createOrRetrievePayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const expectedFingerprint = fingerprint(input);
    const existing = this.#paymentsByKey.get(input.providerIdempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== expectedFingerprint) {
        throw new PaymentProviderError(
          'provider_idempotency_conflict',
          'Provider idempotency key was reused with conflicting trusted values',
        );
      }
      return this.#creationResult(existing);
    }

    const stored: StoredMockPayment = {
      fingerprint: expectedFingerprint,
      providerCheckoutId: stableId('mock_checkout', input.providerIdempotencyKey),
      providerPaymentId: stableId('mock_payment', input.providerIdempotencyKey),
      retrievalCount: 0,
    };
    this.#paymentsByKey.set(input.providerIdempotencyKey, stored);
    this.#paymentsByCheckoutId.set(stored.providerCheckoutId, stored);
    return this.#creationResult(stored);
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<ProviderPayment> {
    const stored = this.#paymentsByCheckoutId.get(input.providerCheckoutId);
    if (stored === undefined) {
      throw new PaymentProviderError(
        'provider_payment_not_found',
        'Mock provider payment was not found',
      );
    }
    stored.retrievalCount += 1;
    return this.#retrievalResult(stored);
  }

  #creationResult(stored: StoredMockPayment): ProviderPayment {
    switch (this.#configuration.outcome) {
      case 'immediate_success':
        return this.#result(stored, 'succeeded');
      case 'immediate_decline':
        return this.#result(stored, 'failed');
      case 'canceled':
        return this.#result(stored, 'canceled');
      case 'processing_then_success':
      case 'processing_then_failure':
        return this.#result(stored, 'processing');
    }
  }

  #retrievalResult(stored: StoredMockPayment): ProviderPayment {
    switch (this.#configuration.outcome) {
      case 'processing_then_success':
        return this.#result(stored, stored.retrievalCount >= 1 ? 'succeeded' : 'processing');
      case 'processing_then_failure':
        return this.#result(stored, stored.retrievalCount >= 1 ? 'failed' : 'processing');
      case 'immediate_success':
        return this.#result(stored, 'succeeded');
      case 'immediate_decline':
        return this.#result(stored, 'failed');
      case 'canceled':
        return this.#result(stored, 'canceled');
    }
  }

  #result(stored: StoredMockPayment, status: ProviderPayment['status']): ProviderPayment {
    return Object.freeze({
      providerCheckoutId: stored.providerCheckoutId,
      providerPaymentId: status === 'processing' ? null : stored.providerPaymentId,
      status,
      failureCode:
        status === 'failed' ? (this.#configuration.failureCode ?? 'mock_payment_declined') : null,
      periodStart: status === 'succeeded' ? (this.#configuration.periodStart ?? null) : null,
      periodEnd: status === 'succeeded' ? (this.#configuration.periodEnd ?? null) : null,
    });
  }
}
