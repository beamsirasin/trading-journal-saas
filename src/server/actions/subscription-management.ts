'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveWorkspaceContext, UnauthenticatedError } from '@/server/auth/dal';
import {
  customerCancelScheduledCancellation,
  customerCancelScheduledDowngrade,
  customerScheduleCancellationAtPeriodEnd,
  customerSchedulePlanDowngrade,
  SubscriptionLifecycleError,
} from '@/server/services/subscription-lifecycle';

const scheduleDowngradeSchema = z
  .object({ targetPlanKey: z.enum(['starter', 'trader', 'professional']) })
  .strict();
const emptyActionSchema = z.object({}).strict();

export type SubscriptionManagementActionCode =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'downgrade_not_allowed'
  | 'cancellation_not_allowed'
  | 'boundary_passed'
  | 'checkout_in_progress'
  | 'malformed_subscription'
  | 'past_due'
  | 'unexpected';

export type SubscriptionManagementActionResult =
  | { readonly ok: true; readonly changed: boolean; readonly effectiveAt?: string }
  | { readonly ok: false; readonly code: SubscriptionManagementActionCode };

function revalidateSubscriptionPages(): void {
  for (const locale of ['en', 'th']) {
    revalidatePath(`/${locale}/app/plan`);
    revalidatePath(`/${locale}/app/settings`);
    revalidatePath(`/${locale}/app/billing`);
  }
}

function mapError(
  error: unknown,
  operation: 'downgrade' | 'cancellation',
): SubscriptionManagementActionResult {
  if (error instanceof UnauthenticatedError) return { ok: false, code: 'unauthenticated' };
  if (!(error instanceof SubscriptionLifecycleError)) return { ok: false, code: 'unexpected' };
  switch (error.code) {
    case 'forbidden':
      return { ok: false, code: 'forbidden' };
    case 'checkout_in_progress':
      return { ok: false, code: 'checkout_in_progress' };
    case 'past_due_restriction':
      return { ok: false, code: 'past_due' };
    case 'stale_period':
    case 'stale_transition':
      return { ok: false, code: 'boundary_passed' };
    case 'entitlement_unavailable':
    case 'unsupported_plan':
    case 'unsupported_currency':
    case 'unsupported_billing_interval':
    case 'invalid_billing_period':
    case 'currency_change_not_allowed':
      return { ok: false, code: 'malformed_subscription' };
    case 'invalid_lifecycle_transition':
      return {
        ok: false,
        code: operation === 'downgrade' ? 'downgrade_not_allowed' : 'cancellation_not_allowed',
      };
  }
}

async function context() {
  const { workspaceId, userId } = await getActiveWorkspaceContext();
  return { workspaceId, actorUserId: userId };
}

export async function schedulePlanDowngradeAction(
  input: unknown,
): Promise<SubscriptionManagementActionResult> {
  const parsed = scheduleDowngradeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };
  try {
    const result = await customerSchedulePlanDowngrade({
      ...(await context()),
      targetPlanKey: parsed.data.targetPlanKey,
    });
    revalidateSubscriptionPages();
    return { ok: true, changed: result.changed, effectiveAt: result.effectiveAt.toISOString() };
  } catch (error) {
    return mapError(error, 'downgrade');
  }
}

export async function cancelPlanDowngradeAction(
  input: unknown,
): Promise<SubscriptionManagementActionResult> {
  if (!emptyActionSchema.safeParse(input).success) return { ok: false, code: 'validation' };
  try {
    const result = await customerCancelScheduledDowngrade(await context());
    revalidateSubscriptionPages();
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error, 'downgrade');
  }
}

export async function scheduleSubscriptionCancellationAction(
  input: unknown,
): Promise<SubscriptionManagementActionResult> {
  if (!emptyActionSchema.safeParse(input).success) return { ok: false, code: 'validation' };
  try {
    const result = await customerScheduleCancellationAtPeriodEnd(await context());
    revalidateSubscriptionPages();
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error, 'cancellation');
  }
}

export async function cancelSubscriptionCancellationAction(
  input: unknown,
): Promise<SubscriptionManagementActionResult> {
  if (!emptyActionSchema.safeParse(input).success) return { ok: false, code: 'validation' };
  try {
    const result = await customerCancelScheduledCancellation(await context());
    revalidateSubscriptionPages();
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error, 'cancellation');
  }
}
