import type { PlanKey } from '@/config/plan-catalog';
import type {
  AccessMode,
  EntitlementStatus,
  PersistedEntitlementStatus,
} from '@/lib/entitlements/resolve';

import type { BillingCurrency, BillingInterval } from './types';

export interface SubscriptionPlanOption {
  readonly id: PlanKey;
  readonly name: string;
  readonly activeTradingAccountLimit: number;
  readonly priceFormatted: string;
}

export interface DowngradeOption extends SubscriptionPlanOption {
  readonly effectiveAt: string;
  readonly willBeOverLimit: boolean;
}

export interface PendingDowngradePresentation {
  readonly plan: SubscriptionPlanOption;
  readonly effectiveAt: string;
  readonly willBeOverLimit: boolean;
}

export type SubscriptionManagementBlockReason =
  'past_due' | 'malformed' | 'checkout_in_progress' | null;

/** JSON/React-safe, server-authoritative customer subscription model. */
export interface SubscriptionManagementPresentation {
  readonly persistedStatus: PersistedEntitlementStatus;
  readonly effectiveStatus: EntitlementStatus;
  readonly accessMode: AccessMode;
  readonly currentPlan: SubscriptionPlanOption | null;
  readonly billingCurrency: BillingCurrency | null;
  readonly billingInterval: BillingInterval | null;
  readonly trialEndsAt: string | null;
  readonly currentPeriodEndsAt: string | null;
  readonly activeAccountCount: number;
  readonly accountLimit: number | null;
  readonly overLimit: boolean;
  readonly hasNonTerminalCheckout: boolean;
  readonly blockReason: SubscriptionManagementBlockReason;
  readonly upgradeOptions: readonly SubscriptionPlanOption[];
  readonly downgradeOptions: readonly DowngradeOption[];
  readonly pendingDowngrade: PendingDowngradePresentation | null;
  readonly cancellationScheduled: boolean;
  readonly canCancelPendingDowngrade: boolean;
  readonly canScheduleCancellation: boolean;
  readonly canReverseCancellation: boolean;
}

export type BillingHistoryStatus =
  'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface BillingHistoryMoney {
  readonly amountMinor: string;
  readonly formatted: string;
}

export interface BillingHistoryItem {
  /** Opaque identifier used only for trusted reconciliation/navigation. */
  readonly transactionId: string;
  readonly createdAt: string;
  readonly completedOrFailedAt: string | null;
  readonly planKey: PlanKey;
  readonly planName: string;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly subtotal: BillingHistoryMoney;
  readonly vat: null | {
    readonly ratePercent: string;
    readonly amount: BillingHistoryMoney;
  };
  readonly total: BillingHistoryMoney;
  readonly status: BillingHistoryStatus;
  readonly failureMessageKey: 'payment_failed' | null;
  readonly canResumeProcessing: boolean;
}

export interface BillingHistoryPresentation {
  readonly items: readonly BillingHistoryItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
}
