'use server';

import { z } from 'zod';

import { type BillingCurrency } from '@/lib/billing';
import type { BillingMoneyPresentation } from '@/lib/billing/presentation-types';
import { getActiveWorkspaceContext, UnauthenticatedError } from '@/server/auth/dal';
import { getConfiguredPaymentProvider } from '@/server/payments/configured-payment-provider';
import {
  CheckoutError,
  reconcileCheckout,
  startCheckout,
  type BillingTransactionStatus,
  type CheckoutResult,
} from '@/server/services/checkout';

import { presentCheckoutMoney } from '../billing/presentation';

const checkoutInputSchema = z
  .object({
    plan: z.enum(['starter', 'trader', 'professional']),
    currency: z.enum(['THB', 'USD']),
    interval: z.literal('monthly'),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

const reconciliationInputSchema = z.object({ billingTransactionId: z.string().uuid() }).strict();

export type CheckoutCustomerError =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_eligible'
  | 'conflict'
  | 'already_processing'
  | 'payment_unavailable'
  | 'unexpected';

export interface CheckoutActionSuccess {
  readonly ok: true;
  readonly billingTransactionId: string;
  readonly status: BillingTransactionStatus;
  readonly plan: 'starter' | 'trader' | 'professional';
  readonly currency: BillingCurrency;
  readonly subtotal: BillingMoneyPresentation;
  readonly vatEnabled: boolean;
  readonly vatRatePercent: string;
  readonly vatAmount: BillingMoneyPresentation;
  readonly total: BillingMoneyPresentation;
  readonly reused: boolean;
}

export type CheckoutActionResult =
  { readonly ok: false; readonly code: CheckoutCustomerError } | CheckoutActionSuccess;

function percentFromBasisPoints(rate: number): string {
  const whole = Math.trunc(rate / 100);
  const fraction = rate % 100;
  return fraction === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(2, '0')}`;
}

function presentResult(result: CheckoutResult): CheckoutActionSuccess {
  return {
    ok: true,
    billingTransactionId: result.billingTransactionId,
    status: result.status,
    plan: result.planKey,
    currency: result.currency,
    subtotal: presentCheckoutMoney(result.subtotalMinor, result.currency),
    vatEnabled: result.vatEnabled,
    vatRatePercent: percentFromBasisPoints(result.appliedVatRateBasisPoints),
    vatAmount: presentCheckoutMoney(result.vatAmountMinor, result.currency),
    total: presentCheckoutMoney(result.totalMinor, result.currency),
    reused: result.reused,
  };
}

function mapError(error: unknown): CheckoutActionResult {
  if (error instanceof UnauthenticatedError) return { ok: false, code: 'unauthenticated' };
  if (!(error instanceof CheckoutError)) return { ok: false, code: 'unexpected' };

  switch (error.code) {
    case 'unsupported_plan':
    case 'unsupported_currency':
    case 'unsupported_billing_interval':
    case 'invalid_idempotency_key':
      return { ok: false, code: 'validation' };
    case 'idempotency_conflict':
      return { ok: false, code: 'conflict' };
    case 'checkout_already_in_progress':
      return { ok: false, code: 'already_processing' };
    case 'checkout_not_allowed':
      return { ok: false, code: 'not_eligible' };
    case 'cross_workspace_access_denied':
    case 'transaction_not_found':
      return { ok: false, code: 'forbidden' };
    case 'payment_failed':
    case 'invalid_provider_result':
    case 'invalid_billing_period':
    case 'stale_provider_result':
      return { ok: false, code: 'payment_unavailable' };
  }
}

export async function checkoutAction(input: unknown): Promise<CheckoutActionResult> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    const result = await startCheckout(
      {
        workspaceId,
        userId,
        planKey: parsed.data.plan,
        currency: parsed.data.currency,
        billingInterval: parsed.data.interval,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      { provider: await getConfiguredPaymentProvider(userId) },
    );
    return presentResult(result);
  } catch (error) {
    return mapError(error);
  }
}

export async function reconcileCheckoutAction(input: unknown): Promise<CheckoutActionResult> {
  const parsed = reconciliationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    const result = await reconcileCheckout(
      { workspaceId, userId, billingTransactionId: parsed.data.billingTransactionId },
      { provider: await getConfiguredPaymentProvider(userId) },
    );
    return presentResult(result);
  } catch (error) {
    return mapError(error);
  }
}
