import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';

import { DEFAULT_VAT_CONFIGURATION } from '@/config/billing.server';
import { getPlanDefinition, isPlanKey, type PlanKey } from '@/config/plan-catalog';
import {
  decideBillingStatusTransition,
  isSupportedBillingCurrency,
  isSupportedBillingInterval,
  quoteCheckout,
  type BillingCurrency,
  type BillingInterval,
  type CheckoutQuote,
  type QuoteCheckoutInput,
  type VatConfiguration,
} from '@/lib/billing';
import { systemClock, type Clock } from '@/lib/time';
import { getDb } from '@/server/db/client';
import {
  billingTransactions,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import type { PaymentProvider, ProviderPayment } from '@/server/payments/payment-provider';

import { insertAuditLog } from './audit-log';
import {
  activatePaidSubscriptionInTransaction,
  applyImmediateUpgradeInTransaction,
  type EntitlementRow,
  type LifecycleExecutor,
} from './subscription-lifecycle';

export type BillingTransactionStatus =
  'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export type CheckoutErrorCode =
  | 'checkout_not_allowed'
  | 'unsupported_plan'
  | 'unsupported_currency'
  | 'unsupported_billing_interval'
  | 'invalid_idempotency_key'
  | 'idempotency_conflict'
  | 'checkout_already_in_progress'
  | 'invalid_provider_result'
  | 'invalid_billing_period'
  | 'stale_provider_result'
  | 'payment_failed'
  | 'transaction_not_found'
  | 'cross_workspace_access_denied';

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;

  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
  }
}

export interface TrustedCheckoutInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly planKey: PlanKey;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly idempotencyKey: string;
}

export interface ReconcileCheckoutInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly billingTransactionId: string;
}

export interface CheckoutDependencies {
  readonly provider: PaymentProvider;
  readonly clock?: Clock;
  readonly vatConfiguration?: VatConfiguration;
  readonly taxJurisdiction?: string | null;
  readonly vatRegistrationNumber?: string | null;
  /** Trusted test seam for proving stored snapshots outlive later price configuration. */
  readonly quote?: (input: QuoteCheckoutInput) => CheckoutQuote;
}

export interface CheckoutResult {
  readonly billingTransactionId: string;
  readonly status: BillingTransactionStatus;
  readonly planKey: PlanKey;
  readonly currency: BillingCurrency;
  readonly billingInterval: BillingInterval;
  readonly subtotalMinor: bigint;
  readonly vatEnabled: boolean;
  readonly appliedVatRateBasisPoints: number;
  readonly vatAmountMinor: bigint;
  readonly totalMinor: bigint;
  readonly providerCheckoutId: string | null;
  readonly providerPaymentId: string | null;
  readonly failureCode: string | null;
  readonly reused: boolean;
  readonly staleProviderResultIgnored: boolean;
}

type BillingRow = typeof billingTransactions.$inferSelect;
type CheckoutIntent = 'activation' | 'upgrade';
type CheckoutExecutor = LifecycleExecutor;

const NON_TERMINAL_STATUSES = ['created', 'pending', 'processing'] as const;
const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PROVIDER_VALUE = /^[A-Za-z0-9_.:-]{1,200}$/;

function checkoutError(code: CheckoutErrorCode, message: string): CheckoutError {
  return new CheckoutError(code, message);
}

function validateCheckoutInput(input: TrustedCheckoutInput): void {
  if (!isPlanKey(input.planKey)) {
    throw checkoutError('unsupported_plan', `Unsupported plan: ${String(input.planKey)}`);
  }
  if (!isSupportedBillingCurrency(input.currency)) {
    throw checkoutError(
      'unsupported_currency',
      `Unsupported billing currency: ${String(input.currency)}`,
    );
  }
  if (!isSupportedBillingInterval(input.billingInterval)) {
    throw checkoutError(
      'unsupported_billing_interval',
      `Unsupported billing interval: ${String(input.billingInterval)}`,
    );
  }
  if (!UUID_PATTERN.test(input.idempotencyKey)) {
    throw checkoutError('invalid_idempotency_key', 'Checkout idempotency key must be a UUID');
  }
}

function isBillingStatus(value: unknown): value is BillingTransactionStatus {
  return (
    value === 'created' ||
    value === 'pending' ||
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'canceled'
  );
}

function isTerminal(status: BillingTransactionStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function statusOf(row: BillingRow): BillingTransactionStatus {
  if (!isBillingStatus(row.status)) {
    throw checkoutError('invalid_provider_result', 'Stored billing status is invalid');
  }
  return row.status;
}

function assertSafeProviderResult(
  result: ProviderPayment,
  now: Date,
  currentEnd: Date | null,
): void {
  if (!SAFE_PROVIDER_VALUE.test(result.providerCheckoutId)) {
    throw checkoutError('invalid_provider_result', 'Provider checkout identifier is invalid');
  }
  if (result.providerPaymentId !== null && !SAFE_PROVIDER_VALUE.test(result.providerPaymentId)) {
    throw checkoutError('invalid_provider_result', 'Provider payment identifier is invalid');
  }
  if (
    result.status !== 'processing' &&
    result.status !== 'succeeded' &&
    result.status !== 'failed' &&
    result.status !== 'canceled'
  ) {
    throw checkoutError('invalid_provider_result', 'Provider status is invalid');
  }
  if (
    result.status === 'failed' &&
    (result.failureCode === null || !SAFE_PROVIDER_VALUE.test(result.failureCode))
  ) {
    throw checkoutError('invalid_provider_result', 'Provider failure code is invalid');
  }
  if (result.status !== 'succeeded') return;
  if (
    result.providerPaymentId === null ||
    result.periodStart === null ||
    result.periodEnd === null
  ) {
    throw checkoutError(
      'invalid_billing_period',
      'A successful provider payment requires identifiers and a billing period',
    );
  }
  const start = result.periodStart.getTime();
  const end = result.periodEnd.getTime();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    start > now.getTime() ||
    end <= now.getTime()
  ) {
    throw checkoutError('invalid_billing_period', 'Provider billing period is invalid');
  }
  if (currentEnd !== null && end < currentEnd.getTime()) {
    throw checkoutError('invalid_billing_period', 'Provider billing period would shorten access');
  }
}

function resultFromRow(
  row: BillingRow,
  options: { readonly reused: boolean; readonly staleProviderResultIgnored?: boolean },
): CheckoutResult {
  if (!isPlanKey(row.planKey) || !isSupportedBillingCurrency(row.billingCurrency)) {
    throw checkoutError('invalid_provider_result', 'Stored checkout snapshot is malformed');
  }
  if (!isSupportedBillingInterval(row.billingInterval)) {
    throw checkoutError('invalid_provider_result', 'Stored checkout interval is malformed');
  }
  return {
    billingTransactionId: row.id,
    status: statusOf(row),
    planKey: row.planKey,
    currency: row.billingCurrency,
    billingInterval: row.billingInterval,
    subtotalMinor: row.subtotalMinor,
    vatEnabled: row.vatEnabled,
    appliedVatRateBasisPoints: row.appliedVatRateBasisPoints,
    vatAmountMinor: row.vatAmountMinor,
    totalMinor: row.totalMinor,
    providerCheckoutId: row.providerCheckoutId,
    providerPaymentId: row.providerPaymentId,
    failureCode: row.failureCode,
    reused: options.reused,
    staleProviderResultIgnored: options.staleProviderResultIgnored ?? false,
  };
}

async function lockWorkspaceAndEntitlement(
  tx: CheckoutExecutor,
  workspaceId: string,
): Promise<EntitlementRow> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  if (workspace === undefined) {
    throw checkoutError('cross_workspace_access_denied', 'Workspace access denied');
  }
  const [entitlement] = await tx
    .select()
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, workspaceId))
    .for('update');
  if (entitlement === undefined) {
    throw checkoutError('checkout_not_allowed', 'Workspace entitlement is unavailable');
  }
  return entitlement;
}

async function assertActiveMembership(
  tx: CheckoutExecutor,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [membership] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (membership === undefined) {
    throw checkoutError('cross_workspace_access_denied', 'Workspace access denied');
  }
}

function determineCheckoutIntent(
  entitlement: EntitlementRow,
  input: Pick<TrustedCheckoutInput, 'planKey' | 'currency' | 'billingInterval'>,
  now: Date,
): CheckoutIntent {
  if (
    entitlement.status === 'trialing' &&
    (entitlement.trialStartedAt === null ||
      entitlement.trialEndsAt === null ||
      entitlement.trialStartedAt.getTime() >= entitlement.trialEndsAt.getTime())
  ) {
    throw checkoutError('checkout_not_allowed', 'Trial entitlement is malformed');
  }
  if (
    entitlement.status === 'trialing' ||
    entitlement.status === 'expired' ||
    entitlement.status === 'canceled'
  ) {
    return 'activation';
  }
  if (entitlement.status === 'past_due') {
    throw checkoutError('checkout_not_allowed', 'Past-due subscriptions cannot start checkout');
  }
  if (entitlement.status !== 'active') {
    throw checkoutError('checkout_not_allowed', 'Checkout is not allowed for this lifecycle');
  }

  const pendingPairValid =
    (entitlement.pendingPlanKey === null && entitlement.pendingPlanEffectiveAt === null) ||
    (entitlement.pendingPlanKey !== null && entitlement.pendingPlanEffectiveAt !== null);
  const currentPlanKey = entitlement.planKey;
  const currentCurrency = entitlement.billingCurrency;
  const currentPeriodStartedAt = entitlement.currentPeriodStartedAt;
  const currentPeriodEndsAt = entitlement.currentPeriodEndsAt;
  const activeShapeValid =
    isPlanKey(currentPlanKey) &&
    isSupportedBillingCurrency(currentCurrency) &&
    entitlement.billingInterval === 'monthly' &&
    currentPeriodStartedAt !== null &&
    currentPeriodEndsAt !== null &&
    currentPeriodStartedAt.getTime() < currentPeriodEndsAt.getTime() &&
    now.getTime() >= currentPeriodStartedAt.getTime() &&
    pendingPairValid &&
    (!entitlement.cancelAtPeriodEnd || currentPeriodEndsAt !== null);
  if (!activeShapeValid) {
    throw checkoutError('checkout_not_allowed', 'Active subscription state is malformed');
  }
  if (now.getTime() >= currentPeriodEndsAt.getTime()) return 'activation';

  if (input.currency !== currentCurrency) {
    throw checkoutError(
      'checkout_not_allowed',
      'Currency cannot change during an active lifecycle',
    );
  }
  if (input.billingInterval !== entitlement.billingInterval) {
    throw checkoutError('checkout_not_allowed', 'Billing interval cannot change');
  }
  const currentLimit = getPlanDefinition(currentPlanKey).activeTradingAccountLimit;
  const targetLimit = getPlanDefinition(input.planKey).activeTradingAccountLimit;
  if (targetLimit <= currentLimit) {
    throw checkoutError('checkout_not_allowed', 'Active checkout requires a larger plan');
  }
  return 'upgrade';
}

function snapshotMatches(row: BillingRow, input: TrustedCheckoutInput): boolean {
  return (
    row.planKey === input.planKey &&
    row.billingCurrency === input.currency &&
    row.billingInterval === input.billingInterval
  );
}

async function auditBilling(
  tx: CheckoutExecutor,
  row: BillingRow,
  action:
    | 'billing.checkout_created'
    | 'billing.checkout_processing'
    | 'billing.checkout_succeeded'
    | 'billing.checkout_failed'
    | 'billing.checkout_canceled'
    | 'billing.checkout_reconciled',
  actorUserId?: string,
  providerResult?: ProviderPayment,
): Promise<void> {
  await insertAuditLog(tx, {
    action,
    workspaceId: row.workspaceId,
    ...(actorUserId === undefined ? {} : { actorUserId }),
    entityType: 'billing_transaction',
    entityId: row.id,
    metadata: {
      billingTransactionId: row.id,
      planKey: row.planKey,
      currency: row.billingCurrency,
      subtotalMinor: row.subtotalMinor.toString(),
      vatAmountMinor: row.vatAmountMinor.toString(),
      totalMinor: row.totalMinor.toString(),
      ...(row.providerKind === null ? {} : { providerKind: row.providerKind }),
      ...(providerResult === undefined
        ? {}
        : {
            providerCheckoutId: providerResult.providerCheckoutId,
            ...(providerResult.providerPaymentId === null
              ? {}
              : { providerPaymentId: providerResult.providerPaymentId }),
            status: providerResult.status,
            ...(providerResult.failureCode === null
              ? {}
              : { failureCode: providerResult.failureCode }),
          }),
    },
  });
}

interface PreparedCheckout {
  readonly row: BillingRow;
  readonly intent: CheckoutIntent | null;
  readonly reused: boolean;
}

async function prepareCheckout(
  input: TrustedCheckoutInput,
  dependencies: CheckoutDependencies,
): Promise<PreparedCheckout> {
  validateCheckoutInput(input);
  const db = getDb();
  const now = (dependencies.clock ?? systemClock).now();

  return db.transaction(async (tx) => {
    const entitlement = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    await assertActiveMembership(tx, input.workspaceId, input.userId);

    const [existing] = await tx
      .select()
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.workspaceId, input.workspaceId),
          eq(billingTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (!snapshotMatches(existing, input)) {
        throw checkoutError(
          'idempotency_conflict',
          'Checkout idempotency key was reused with a conflicting request',
        );
      }
      return { row: existing, intent: null, reused: true };
    }

    const [otherNonTerminal] = await tx
      .select({ id: billingTransactions.id })
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.workspaceId, input.workspaceId),
          inArray(billingTransactions.status, [...NON_TERMINAL_STATUSES]),
          ne(billingTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (otherNonTerminal !== undefined) {
      throw checkoutError(
        'checkout_already_in_progress',
        'Another checkout is already in progress for this workspace',
      );
    }

    const intent = determineCheckoutIntent(entitlement, input, now);
    const quote = (dependencies.quote ?? quoteCheckout)({
      planKey: input.planKey,
      currency: input.currency,
      billingInterval: input.billingInterval,
      vatConfiguration: dependencies.vatConfiguration ?? DEFAULT_VAT_CONFIGURATION,
    });
    const vatEnabled = quote.vatEnabled;
    const [created] = await tx
      .insert(billingTransactions)
      .values({
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        planKey: quote.planKey,
        billingCurrency: quote.currency,
        billingInterval: quote.billingInterval,
        subtotalMinor: quote.subtotalMinor,
        vatEnabled,
        appliedVatRateBasisPoints: quote.appliedVatRateBasisPoints,
        vatAmountMinor: quote.vatAmountMinor,
        totalMinor: quote.totalMinor,
        taxMode: quote.taxMode,
        taxJurisdiction: vatEnabled ? (dependencies.taxJurisdiction ?? null) : null,
        vatRegistrationNumber: vatEnabled ? (dependencies.vatRegistrationNumber ?? null) : null,
        providerKind: dependencies.provider.kind,
        status: 'created',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (created === undefined) {
      throw checkoutError('payment_failed', 'Checkout snapshot could not be created');
    }
    await auditBilling(tx, created, 'billing.checkout_created', input.userId);
    return { row: created, intent, reused: false };
  });
}

async function finalizeProviderResult(
  prepared: PreparedCheckout,
  providerResult: ProviderPayment,
  input: { readonly workspaceId: string; readonly actorUserId?: string },
  dependencies: CheckoutDependencies,
  reconciled: boolean,
): Promise<CheckoutResult> {
  const db = getDb();
  const now = (dependencies.clock ?? systemClock).now();

  return db.transaction(async (tx) => {
    const entitlement = await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    const [row] = await tx
      .select()
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.id, prepared.row.id),
          eq(billingTransactions.workspaceId, input.workspaceId),
        ),
      )
      .for('update');
    if (row === undefined) {
      throw checkoutError('transaction_not_found', 'Billing transaction was not found');
    }

    const currentStatus = statusOf(row);
    if (isTerminal(currentStatus)) {
      const transition = decideBillingStatusTransition(currentStatus, providerResult.status);
      return resultFromRow(row, {
        reused: true,
        staleProviderResultIgnored: transition === 'ignore_stale',
      });
    }
    if (
      (row.providerCheckoutId !== null &&
        row.providerCheckoutId !== providerResult.providerCheckoutId) ||
      (row.providerPaymentId !== null &&
        providerResult.providerPaymentId !== null &&
        row.providerPaymentId !== providerResult.providerPaymentId)
    ) {
      throw checkoutError('invalid_provider_result', 'Provider identifiers conflict with storage');
    }

    const intent =
      providerResult.status === 'succeeded'
        ? (prepared.intent ??
          determineCheckoutIntent(
            entitlement,
            {
              planKey: prepared.row.planKey as PlanKey,
              currency: prepared.row.billingCurrency as BillingCurrency,
              billingInterval: prepared.row.billingInterval as BillingInterval,
            },
            now,
          ))
        : null;
    assertSafeProviderResult(
      providerResult,
      now,
      intent === 'upgrade' ? entitlement.currentPeriodEndsAt : null,
    );

    const common = {
      providerCheckoutId: providerResult.providerCheckoutId,
      providerPaymentId: providerResult.providerPaymentId,
      failureCode: providerResult.failureCode,
      updatedAt: now,
    };
    if (providerResult.status === 'processing') {
      const [updated] = await tx
        .update(billingTransactions)
        .set({ ...common, status: 'processing' })
        .where(eq(billingTransactions.id, row.id))
        .returning();
      if (updated === undefined) throw checkoutError('transaction_not_found', 'Checkout vanished');
      if (currentStatus !== 'processing') {
        await auditBilling(
          tx,
          updated,
          'billing.checkout_processing',
          input.actorUserId,
          providerResult,
        );
      }
      if (reconciled) {
        await auditBilling(
          tx,
          updated,
          'billing.checkout_reconciled',
          input.actorUserId,
          providerResult,
        );
      }
      return resultFromRow(updated, { reused: prepared.reused });
    }

    if (providerResult.status === 'succeeded') {
      if (intent === null) {
        throw checkoutError('checkout_not_allowed', 'Successful checkout has no lifecycle intent');
      }
      const periodStart = providerResult.periodStart as Date;
      const periodEnd = providerResult.periodEnd as Date;
      const transitionInput = {
        workspaceId: input.workspaceId,
        ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
        planKey: prepared.row.planKey as PlanKey,
        billingCurrency: prepared.row.billingCurrency as BillingCurrency,
        billingInterval: prepared.row.billingInterval as BillingInterval,
        periodStartedAt: periodStart,
        periodEndsAt: periodEnd,
        providerKind: dependencies.provider.kind,
      };
      if (intent === 'activation') {
        await activatePaidSubscriptionInTransaction(tx, entitlement, transitionInput, now);
      } else {
        await applyImmediateUpgradeInTransaction(tx, entitlement, transitionInput, now);
      }
      const [updated] = await tx
        .update(billingTransactions)
        .set({ ...common, status: 'succeeded', completedAt: now, failedAt: null })
        .where(eq(billingTransactions.id, row.id))
        .returning();
      if (updated === undefined) throw checkoutError('transaction_not_found', 'Checkout vanished');
      await auditBilling(
        tx,
        updated,
        'billing.checkout_succeeded',
        input.actorUserId,
        providerResult,
      );
      if (reconciled) {
        await auditBilling(
          tx,
          updated,
          'billing.checkout_reconciled',
          input.actorUserId,
          providerResult,
        );
      }
      return resultFromRow(updated, { reused: prepared.reused });
    }

    const terminalAction =
      providerResult.status === 'failed'
        ? ('billing.checkout_failed' as const)
        : ('billing.checkout_canceled' as const);
    const [updated] = await tx
      .update(billingTransactions)
      .set({
        ...common,
        status: providerResult.status,
        completedAt: providerResult.status === 'canceled' ? now : null,
        failedAt: providerResult.status === 'failed' ? now : null,
      })
      .where(eq(billingTransactions.id, row.id))
      .returning();
    if (updated === undefined) throw checkoutError('transaction_not_found', 'Checkout vanished');
    await auditBilling(tx, updated, terminalAction, input.actorUserId, providerResult);
    if (reconciled) {
      await auditBilling(
        tx,
        updated,
        'billing.checkout_reconciled',
        input.actorUserId,
        providerResult,
      );
    }
    return resultFromRow(updated, { reused: prepared.reused });
  });
}

export async function startCheckout(
  input: TrustedCheckoutInput,
  dependencies: CheckoutDependencies,
): Promise<CheckoutResult> {
  const prepared = await prepareCheckout(input, dependencies);
  if (isTerminal(statusOf(prepared.row))) {
    return resultFromRow(prepared.row, { reused: true });
  }
  if (prepared.row.providerKind !== dependencies.provider.kind) {
    throw checkoutError('invalid_provider_result', 'Checkout provider does not match its snapshot');
  }

  let providerResult: ProviderPayment;
  try {
    providerResult = await dependencies.provider.createOrRetrievePayment({
      providerIdempotencyKey: `billing:${prepared.row.id}`,
      billingTransactionId: prepared.row.id,
      amountMinor: prepared.row.totalMinor,
      currency: prepared.row.billingCurrency as BillingCurrency,
      billingInterval: prepared.row.billingInterval as BillingInterval,
      metadata: {
        billingTransactionId: prepared.row.id,
        workspaceId: prepared.row.workspaceId,
      },
    });
  } catch {
    throw checkoutError('payment_failed', 'The payment provider could not process checkout');
  }

  return finalizeProviderResult(
    prepared,
    providerResult,
    { workspaceId: input.workspaceId, actorUserId: input.userId },
    dependencies,
    false,
  );
}

export async function reconcileCheckout(
  input: ReconcileCheckoutInput,
  dependencies: CheckoutDependencies,
): Promise<CheckoutResult> {
  const db = getDb();
  const prepared = await db.transaction(async (tx): Promise<PreparedCheckout> => {
    await lockWorkspaceAndEntitlement(tx, input.workspaceId);
    await assertActiveMembership(tx, input.workspaceId, input.userId);
    const [row] = await tx
      .select()
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.id, input.billingTransactionId),
          eq(billingTransactions.workspaceId, input.workspaceId),
        ),
      )
      .for('update');
    if (row === undefined) {
      throw checkoutError('transaction_not_found', 'Billing transaction was not found');
    }
    return { row, intent: null, reused: true };
  });

  if (isTerminal(statusOf(prepared.row))) {
    return resultFromRow(prepared.row, { reused: true });
  }
  if (prepared.row.providerKind !== dependencies.provider.kind) {
    throw checkoutError('invalid_provider_result', 'Checkout provider does not match its snapshot');
  }
  if (prepared.row.providerCheckoutId === null) {
    throw checkoutError('invalid_provider_result', 'Checkout has no provider reference');
  }

  let providerResult: ProviderPayment;
  try {
    providerResult = await dependencies.provider.retrievePayment({
      providerCheckoutId: prepared.row.providerCheckoutId,
    });
  } catch {
    throw checkoutError('payment_failed', 'The payment provider could not retrieve checkout');
  }
  return finalizeProviderResult(
    prepared,
    providerResult,
    { workspaceId: input.workspaceId, actorUserId: input.userId },
    dependencies,
    true,
  );
}
