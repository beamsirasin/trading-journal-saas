import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { getPlanDefinition, isPlanKey, type PlanKey } from '@/config/plan-catalog';
import type { BillingCurrency, BillingInterval } from '@/lib/billing/types';
import { systemClock, type Clock } from '@/lib/time';
import { getDb, type Database } from '@/server/db/client';
import {
  billingTransactions,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';

export type SubscriptionLifecycleErrorCode =
  | 'entitlement_unavailable'
  | 'invalid_lifecycle_transition'
  | 'unsupported_plan'
  | 'unsupported_currency'
  | 'unsupported_billing_interval'
  | 'invalid_billing_period'
  | 'currency_change_not_allowed'
  | 'stale_period'
  | 'stale_transition'
  | 'checkout_in_progress'
  | 'forbidden'
  | 'past_due_restriction';

export class SubscriptionLifecycleError extends Error {
  readonly code: SubscriptionLifecycleErrorCode;

  constructor(code: SubscriptionLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'SubscriptionLifecycleError';
    this.code = code;
  }
}

interface TrustedTransitionContext {
  readonly workspaceId: string;
  readonly actorUserId?: string;
}

interface TrustedPaidPeriod {
  readonly billingCurrency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly periodStartedAt: Date;
  readonly periodEndsAt: Date;
}

export interface ActivatePaidSubscriptionInput extends TrustedTransitionContext, TrustedPaidPeriod {
  readonly planKey: PlanKey;
  readonly providerKind?: string | null;
  readonly providerCustomerId?: string | null;
  readonly providerSubscriptionId?: string | null;
}

export type ApplyImmediateUpgradeInput = ActivatePaidSubscriptionInput;

export interface SchedulePlanDowngradeInput extends TrustedTransitionContext {
  readonly targetPlanKey: PlanKey;
}

export interface CustomerTransitionContext {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

export interface RecoverSubscriptionInput extends TrustedTransitionContext, TrustedPaidPeriod {}

export type EntitlementRow = typeof workspaceEntitlements.$inferSelect;
export type LifecycleExecutor = Pick<Database, 'select' | 'update' | 'insert'>;
type Executor = LifecycleExecutor;

function lifecycleError(
  code: SubscriptionLifecycleErrorCode,
  message: string,
): SubscriptionLifecycleError {
  return new SubscriptionLifecycleError(code, message);
}

function validatePlan(planKey: unknown): asserts planKey is PlanKey {
  if (!isPlanKey(planKey)) {
    throw lifecycleError('unsupported_plan', `Unsupported plan: ${String(planKey)}`);
  }
}

function validateCurrency(currency: unknown): asserts currency is BillingCurrency {
  if (currency !== 'THB' && currency !== 'USD') {
    throw lifecycleError(
      'unsupported_currency',
      `Unsupported billing currency: ${String(currency)}`,
    );
  }
}

function validateInterval(interval: unknown): asserts interval is BillingInterval {
  if (interval !== 'monthly') {
    throw lifecycleError(
      'unsupported_billing_interval',
      `Unsupported billing interval: ${String(interval)}`,
    );
  }
}

function validatePaidPeriod(period: TrustedPaidPeriod, now: Date): void {
  validateCurrency(period.billingCurrency);
  validateInterval(period.billingInterval);
  const start = period.periodStartedAt.getTime();
  const end = period.periodEndsAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start > now.getTime()) {
    throw lifecycleError('invalid_billing_period', 'The trusted billing period is invalid');
  }
  if (end <= now.getTime()) {
    throw lifecycleError('stale_period', 'The trusted billing period has already ended');
  }
}

function requireActivePaid(row: EntitlementRow): void {
  if (row.status === 'past_due') {
    throw lifecycleError('past_due_restriction', 'Past-due subscriptions cannot be managed');
  }
  if (
    row.status !== 'active' ||
    !isPlanKey(row.planKey) ||
    (row.billingCurrency !== 'THB' && row.billingCurrency !== 'USD') ||
    row.billingInterval !== 'monthly' ||
    row.currentPeriodStartedAt === null ||
    row.currentPeriodEndsAt === null ||
    row.currentPeriodStartedAt.getTime() >= row.currentPeriodEndsAt.getTime()
  ) {
    throw lifecycleError(
      'invalid_lifecycle_transition',
      'Transition requires a valid active paid subscription',
    );
  }
}

async function lockWorkspaceAndEntitlement(
  tx: Executor,
  workspaceId: string,
): Promise<EntitlementRow> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  if (workspace === undefined) {
    throw lifecycleError('entitlement_unavailable', 'Workspace does not exist');
  }

  const [entitlement] = await tx
    .select()
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, workspaceId))
    .for('update');
  if (entitlement === undefined) {
    throw lifecycleError('entitlement_unavailable', 'Workspace entitlement does not exist');
  }
  return entitlement;
}

async function auditLifecycle(
  tx: Executor,
  input: TrustedTransitionContext,
  action:
    | 'subscription.activated'
    | 'subscription.upgraded'
    | 'subscription.downgrade_scheduled'
    | 'subscription.downgrade_canceled'
    | 'subscription.cancellation_scheduled'
    | 'subscription.cancellation_canceled'
    | 'subscription.past_due'
    | 'subscription.recovered'
    | 'subscription.expired'
    | 'subscription.canceled'
    | 'subscription.pending_plan_materialized',
): Promise<void> {
  await insertAuditLog(tx, {
    action,
    workspaceId: input.workspaceId,
    ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
    entityType: 'workspace_entitlements',
    entityId: input.workspaceId,
  });
}

export async function activatePaidSubscription(
  input: ActivatePaidSubscriptionInput,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    return activatePaidSubscriptionInTransaction(tx, row, input, clock.now());
  });
}

/** Transaction-aware Phase 04D transition used by trusted payment finalization. */
export async function activatePaidSubscriptionInTransaction(
  tx: LifecycleExecutor,
  row: EntitlementRow,
  input: ActivatePaidSubscriptionInput,
  now: Date,
): Promise<{ readonly changed: boolean }> {
  validatePlan(input.planKey);
  validatePaidPeriod(input, now);

  const exactRetry =
    row.status === 'active' &&
    row.planKey === input.planKey &&
    row.billingCurrency === input.billingCurrency &&
    row.billingInterval === input.billingInterval &&
    row.currentPeriodStartedAt?.getTime() === input.periodStartedAt.getTime() &&
    row.currentPeriodEndsAt?.getTime() === input.periodEndsAt.getTime();
  if (exactRetry) return { changed: false };

  const activePeriodEnded =
    row.status === 'active' &&
    row.currentPeriodEndsAt !== null &&
    now.getTime() >= row.currentPeriodEndsAt.getTime();
  if ((row.status === 'active' && !activePeriodEnded) || row.status === 'past_due') {
    throw lifecycleError(
      'invalid_lifecycle_transition',
      'Use upgrade or recovery for an existing paid lifecycle',
    );
  }

  await tx
    .update(workspaceEntitlements)
    .set({
      status: 'active',
      planKey: input.planKey,
      currentPeriodStartedAt: input.periodStartedAt,
      currentPeriodEndsAt: input.periodEndsAt,
      billingCurrency: input.billingCurrency,
      billingInterval: input.billingInterval,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
      providerKind: input.providerKind ?? null,
      providerCustomerId: input.providerCustomerId ?? null,
      providerSubscriptionId: input.providerSubscriptionId ?? null,
      // A real, trusted paid activation is the one event that makes this
      // truthfully 'paid' provenance (`workspace_entitlements.source`'s
      // schema comment) — regardless of whether the row arrived here from a
      // trial, an expired trial, or a lapsed/canceled prior subscription.
      source: 'paid',
      updatedAt: now,
    })
    .where(eq(workspaceEntitlements.id, row.id));
  await auditLifecycle(tx, input, 'subscription.activated');
  return { changed: true };
}

export async function applyImmediateUpgrade(
  input: ApplyImmediateUpgradeInput,
  clock: Clock = systemClock,
): Promise<{ readonly changed: true }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    return applyImmediateUpgradeInTransaction(tx, row, input, clock.now());
  });
}

/** Transaction-aware Phase 04D transition used by trusted payment finalization. */
export async function applyImmediateUpgradeInTransaction(
  tx: LifecycleExecutor,
  row: EntitlementRow,
  input: ApplyImmediateUpgradeInput,
  now: Date,
): Promise<{ readonly changed: true }> {
  requireActivePaid(row);
  validatePlan(input.planKey);
  validatePaidPeriod(input, now);
  if (input.billingCurrency !== row.billingCurrency) {
    throw lifecycleError(
      'currency_change_not_allowed',
      'Currency cannot change during an active billing lifecycle',
    );
  }
  const currentLimit = getPlanDefinition(row.planKey as PlanKey).activeTradingAccountLimit;
  const targetLimit = getPlanDefinition(input.planKey).activeTradingAccountLimit;
  if (targetLimit <= currentLimit) {
    throw lifecycleError(
      'invalid_lifecycle_transition',
      'Immediate upgrade requires a strictly larger account allowance',
    );
  }
  if (
    row.currentPeriodEndsAt !== null &&
    input.periodEndsAt.getTime() < row.currentPeriodEndsAt.getTime()
  ) {
    throw lifecycleError('stale_period', 'Upgrade cannot shorten the current paid period');
  }

  await tx
    .update(workspaceEntitlements)
    .set({
      planKey: input.planKey,
      currentPeriodStartedAt: input.periodStartedAt,
      currentPeriodEndsAt: input.periodEndsAt,
      billingInterval: input.billingInterval,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
      providerKind: input.providerKind,
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: input.providerSubscriptionId,
      updatedAt: now,
    })
    .where(eq(workspaceEntitlements.id, row.id));
  await auditLifecycle(tx, input, 'subscription.upgraded');
  return { changed: true };
}

export async function schedulePlanDowngrade(
  input: SchedulePlanDowngradeInput,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean; readonly effectiveAt: Date }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    return schedulePlanDowngradeInTransaction(tx, row, input, clock.now());
  });
}

export async function schedulePlanDowngradeInTransaction(
  tx: LifecycleExecutor,
  row: EntitlementRow,
  input: SchedulePlanDowngradeInput,
  now: Date,
): Promise<{ readonly changed: boolean; readonly effectiveAt: Date }> {
  requireActivePaid(row);
  validatePlan(input.targetPlanKey);
  if (row.currentPeriodEndsAt === null || now.getTime() >= row.currentPeriodEndsAt.getTime()) {
    throw lifecycleError('stale_transition', 'The current paid period has already ended');
  }
  if (row.cancelAtPeriodEnd) {
    throw lifecycleError(
      'invalid_lifecycle_transition',
      'A downgrade cannot be scheduled while cancellation is scheduled',
    );
  }
  const currentLimit = getPlanDefinition(row.planKey as PlanKey).activeTradingAccountLimit;
  const targetLimit = getPlanDefinition(input.targetPlanKey).activeTradingAccountLimit;
  if (targetLimit >= currentLimit) {
    throw lifecycleError(
      'invalid_lifecycle_transition',
      'Scheduled downgrade requires a strictly smaller account allowance',
    );
  }
  if (
    row.pendingPlanKey === input.targetPlanKey &&
    row.pendingPlanEffectiveAt?.getTime() === row.currentPeriodEndsAt.getTime()
  ) {
    return { changed: false, effectiveAt: row.currentPeriodEndsAt };
  }

  await tx
    .update(workspaceEntitlements)
    .set({
      pendingPlanKey: input.targetPlanKey,
      pendingPlanEffectiveAt: row.currentPeriodEndsAt,
      updatedAt: now,
    })
    .where(eq(workspaceEntitlements.id, row.id));
  await auditLifecycle(tx, input, 'subscription.downgrade_scheduled');
  return { changed: true, effectiveAt: row.currentPeriodEndsAt };
}

export async function cancelScheduledDowngrade(
  input: TrustedTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    return cancelScheduledDowngradeInTransaction(tx, row, input, clock.now());
  });
}

export async function cancelScheduledDowngradeInTransaction(
  tx: LifecycleExecutor,
  row: EntitlementRow,
  input: TrustedTransitionContext,
  now: Date,
): Promise<{ readonly changed: boolean }> {
  requireActivePaid(row);
  if (row.currentPeriodEndsAt === null || now.getTime() >= row.currentPeriodEndsAt.getTime()) {
    throw lifecycleError('stale_transition', 'The downgrade boundary has already passed');
  }
  if (row.pendingPlanKey === null) return { changed: false };
  await tx
    .update(workspaceEntitlements)
    .set({ pendingPlanKey: null, pendingPlanEffectiveAt: null, updatedAt: now })
    .where(eq(workspaceEntitlements.id, row.id));
  await auditLifecycle(tx, input, 'subscription.downgrade_canceled');
  return { changed: true };
}

export async function scheduleCancellationAtPeriodEnd(
  input: TrustedTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    return scheduleCancellationAtPeriodEndInTransaction(tx, row, input, clock.now());
  });
}

export async function scheduleCancellationAtPeriodEndInTransaction(
  tx: LifecycleExecutor,
  row: EntitlementRow,
  input: TrustedTransitionContext,
  now: Date,
): Promise<{ readonly changed: boolean }> {
  requireActivePaid(row);
  if (row.currentPeriodEndsAt === null || now.getTime() >= row.currentPeriodEndsAt.getTime()) {
    throw lifecycleError('stale_transition', 'The cancellation boundary has already passed');
  }
  if (row.cancelAtPeriodEnd && row.pendingPlanKey === null) return { changed: false };
  await tx
    .update(workspaceEntitlements)
    .set({
      cancelAtPeriodEnd: true,
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
      updatedAt: now,
    })
    .where(eq(workspaceEntitlements.id, row.id));
  if (!row.cancelAtPeriodEnd) {
    await auditLifecycle(tx, input, 'subscription.cancellation_scheduled');
  }
  return { changed: true };
}

export async function cancelScheduledCancellation(
  input: TrustedTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    return cancelScheduledCancellationInTransaction(tx, row, input, clock.now());
  });
}

export async function cancelScheduledCancellationInTransaction(
  tx: LifecycleExecutor,
  row: EntitlementRow,
  input: TrustedTransitionContext,
  now: Date,
): Promise<{ readonly changed: boolean }> {
  requireActivePaid(row);
  if (row.currentPeriodEndsAt === null || now.getTime() >= row.currentPeriodEndsAt.getTime()) {
    throw lifecycleError('stale_transition', 'The cancellation boundary has already passed');
  }
  if (!row.cancelAtPeriodEnd) return { changed: false };
  await tx
    .update(workspaceEntitlements)
    .set({ cancelAtPeriodEnd: false, updatedAt: now })
    .where(eq(workspaceEntitlements.id, row.id));
  await auditLifecycle(tx, input, 'subscription.cancellation_canceled');
  return { changed: true };
}

type CustomerTransition<T> = (tx: LifecycleExecutor, row: EntitlementRow, now: Date) => Promise<T>;

async function runCustomerTransition<T>(
  input: CustomerTransitionContext,
  transition: CustomerTransition<T>,
  clock: Clock,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    // Lock ordering is shared with checkout finalization: workspace first,
    // entitlement second. The workspace lock serializes this decision with a
    // concurrent checkout before either flow can change lifecycle state.
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    const [membership] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.actorUserId),
          eq(workspaceMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (membership === undefined) {
      throw lifecycleError('forbidden', 'Active workspace membership is required');
    }

    const [checkout] = await tx
      .select({ id: billingTransactions.id })
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.workspaceId, input.workspaceId),
          inArray(billingTransactions.status, ['created', 'pending', 'processing']),
        ),
      )
      .limit(1)
      .for('update');
    if (checkout !== undefined) {
      throw lifecycleError(
        'checkout_in_progress',
        'A non-terminal checkout must finish before subscription management can continue',
      );
    }
    return transition(tx, row, clock.now());
  });
}

export async function customerSchedulePlanDowngrade(
  input: CustomerTransitionContext & { readonly targetPlanKey: PlanKey },
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean; readonly effectiveAt: Date }> {
  return runCustomerTransition(
    input,
    (tx, row, now) => schedulePlanDowngradeInTransaction(tx, row, input, now),
    clock,
  );
}

export async function customerCancelScheduledDowngrade(
  input: CustomerTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return runCustomerTransition(
    input,
    (tx, row, now) => cancelScheduledDowngradeInTransaction(tx, row, input, now),
    clock,
  );
}

export async function customerScheduleCancellationAtPeriodEnd(
  input: CustomerTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return runCustomerTransition(
    input,
    (tx, row, now) => scheduleCancellationAtPeriodEndInTransaction(tx, row, input, now),
    clock,
  );
}

export async function customerCancelScheduledCancellation(
  input: CustomerTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return runCustomerTransition(
    input,
    (tx, row, now) => cancelScheduledCancellationInTransaction(tx, row, input, now),
    clock,
  );
}

export async function markSubscriptionPastDue(
  input: TrustedTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    const now = clock.now();
    if (row.status === 'past_due') return { changed: false };
    requireActivePaid(row);
    await tx
      .update(workspaceEntitlements)
      .set({ status: 'past_due', updatedAt: now })
      .where(eq(workspaceEntitlements.id, row.id));
    await auditLifecycle(tx, input, 'subscription.past_due');
    return { changed: true };
  });
}

export async function recoverSubscription(
  input: RecoverSubscriptionInput,
  clock: Clock = systemClock,
): Promise<{ readonly changed: true }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    const now = clock.now();
    if (row.status !== 'past_due' || !isPlanKey(row.planKey)) {
      throw lifecycleError('invalid_lifecycle_transition', 'Recovery requires a past-due plan');
    }
    validatePaidPeriod(input, now);
    if (input.billingCurrency !== row.billingCurrency) {
      throw lifecycleError('currency_change_not_allowed', 'Currency cannot change during recovery');
    }
    await tx
      .update(workspaceEntitlements)
      .set({
        status: 'active',
        currentPeriodStartedAt: input.periodStartedAt,
        currentPeriodEndsAt: input.periodEndsAt,
        billingInterval: input.billingInterval,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        pendingPlanKey: null,
        pendingPlanEffectiveAt: null,
        updatedAt: now,
      })
      .where(eq(workspaceEntitlements.id, row.id));
    await auditLifecycle(tx, input, 'subscription.recovered');
    return { changed: true };
  });
}

export async function markSubscriptionExpired(
  input: TrustedTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    const now = clock.now();
    if (row.status === 'expired') return { changed: false };
    if (row.status !== 'active' && row.status !== 'past_due') {
      throw lifecycleError('invalid_lifecycle_transition', 'Only a paid subscription can expire');
    }
    await tx
      .update(workspaceEntitlements)
      .set({ status: 'expired', cancelAtPeriodEnd: false, updatedAt: now })
      .where(eq(workspaceEntitlements.id, row.id));
    await auditLifecycle(tx, input, 'subscription.expired');
    return { changed: true };
  });
}

export async function materializeDueLifecycleState(
  input: TrustedTransitionContext,
  clock: Clock = systemClock,
): Promise<{ readonly changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const row = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    const now = clock.now();
    let changed = false;
    let nextPlanKey = row.planKey;
    let pendingPlanKey = row.pendingPlanKey;
    let pendingPlanEffectiveAt = row.pendingPlanEffectiveAt;
    let status = row.status;
    let cancelAtPeriodEnd = row.cancelAtPeriodEnd;
    let canceledAt = row.canceledAt;

    if (
      pendingPlanKey !== null &&
      pendingPlanEffectiveAt !== null &&
      now.getTime() >= pendingPlanEffectiveAt.getTime()
    ) {
      // Cancellation wins over a historical state that somehow contains
      // both flags. New customer scheduling clears the pending downgrade,
      // but this keeps boundary resolution deterministic for older rows.
      if (!cancelAtPeriodEnd) {
        nextPlanKey = pendingPlanKey;
        await auditLifecycle(tx, input, 'subscription.pending_plan_materialized');
      }
      pendingPlanKey = null;
      pendingPlanEffectiveAt = null;
      changed = true;
    }

    if (
      status === 'active' &&
      row.currentPeriodEndsAt !== null &&
      now.getTime() >= row.currentPeriodEndsAt.getTime()
    ) {
      if (cancelAtPeriodEnd) {
        status = 'canceled';
        canceledAt = now;
        await auditLifecycle(tx, input, 'subscription.canceled');
      } else {
        status = 'expired';
        await auditLifecycle(tx, input, 'subscription.expired');
      }
      cancelAtPeriodEnd = false;
      changed = true;
    }

    if (!changed) return { changed: false };
    await tx
      .update(workspaceEntitlements)
      .set({
        status,
        planKey: nextPlanKey,
        pendingPlanKey,
        pendingPlanEffectiveAt,
        cancelAtPeriodEnd,
        canceledAt,
        updatedAt: now,
      })
      .where(eq(workspaceEntitlements.id, row.id));
    return { changed: true };
  });
}
