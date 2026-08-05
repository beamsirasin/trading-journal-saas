import type { PlanKey, SharedBillingFeatureKey } from '@/config/plan-catalog';

import type { BillingCurrency, BillingInterval } from './types';

/** JSON/React-safe money. The canonical minor-unit value remains an exact string. */
export interface BillingMoneyPresentation {
  readonly currency: BillingCurrency;
  readonly amountMinor: string;
  readonly formatted: string;
}

export interface BillingPlanPresentation {
  readonly id: PlanKey;
  readonly name: string;
  readonly activeTradingAccountLimit: number;
  readonly featured: boolean;
  readonly prices: Readonly<Record<BillingCurrency, BillingMoneyPresentation>>;
}

export interface VatPresentation {
  readonly enabled: boolean;
  readonly rateBasisPoints: number;
  readonly ratePercent: string;
}

export interface BillingPresentation {
  readonly locale: 'en' | 'th';
  readonly supportedCurrencies: readonly BillingCurrency[];
  readonly defaultCurrency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly plans: readonly BillingPlanPresentation[];
  readonly sharedFeatureKeys: readonly SharedBillingFeatureKey[];
  readonly vat: VatPresentation;
}

export interface CheckoutQuotePresentation {
  readonly plan: BillingPlanPresentation;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly subtotal: BillingMoneyPresentation;
  readonly vat: VatPresentation & { readonly amount: BillingMoneyPresentation };
  readonly total: BillingMoneyPresentation;
}
