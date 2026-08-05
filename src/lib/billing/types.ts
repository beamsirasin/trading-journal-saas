import type { PlanKey } from '@/config/plan-catalog';

export type BillingCurrency = 'THB' | 'USD';
export type BillingInterval = 'monthly';
export type AppliedTaxMode = 'disabled' | 'exclusive';

export interface PlanPrice {
  readonly planKey: PlanKey;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly amountMinor: bigint;
}

export type PriceBook = Readonly<
  Record<PlanKey, Readonly<Record<BillingInterval, Readonly<Record<BillingCurrency, bigint>>>>>
>;

/** Trusted server configuration, never a customer-request payload. */
export interface VatConfiguration {
  readonly enabled: boolean;
  readonly rateBasisPoints: number;
}

export interface CheckoutQuote {
  readonly planKey: PlanKey;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly subtotalMinor: bigint;
  readonly vatEnabled: boolean;
  readonly appliedVatRateBasisPoints: number;
  readonly vatAmountMinor: bigint;
  readonly totalMinor: bigint;
  readonly taxMode: AppliedTaxMode;
}

export interface QuoteCheckoutInput {
  readonly planKey: PlanKey;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  /** Must come from trusted server configuration, not from a customer request. */
  readonly vatConfiguration: VatConfiguration;
}
