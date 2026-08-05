import type { BillingCurrency, BillingInterval } from '@/lib/billing';

export type PaymentProviderStatus = 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface CreatePaymentInput {
  readonly providerIdempotencyKey: string;
  readonly billingTransactionId: string;
  readonly amountMinor: bigint;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly metadata: Readonly<{
    billingTransactionId: string;
    workspaceId: string;
  }>;
}

export interface RetrievePaymentInput {
  readonly providerCheckoutId: string;
}

export interface ProviderPayment {
  readonly providerCheckoutId: string;
  readonly providerPaymentId: string | null;
  readonly status: PaymentProviderStatus;
  readonly failureCode: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
}

export interface PaymentProvider {
  readonly kind: string;
  createOrRetrievePayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  retrievePayment(input: RetrievePaymentInput): Promise<ProviderPayment>;
}

export type PaymentProviderErrorCode =
  'provider_idempotency_conflict' | 'provider_payment_not_found';

export class PaymentProviderError extends Error {
  readonly code: PaymentProviderErrorCode;

  constructor(code: PaymentProviderErrorCode, message: string) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
  }
}
