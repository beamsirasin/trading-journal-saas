import { getPlanDefinition, isPlanKey, type PlanKey } from '@/config/plan-catalog';
import { TRIAL_ACCOUNT_LIMIT } from '@/config/plans';
import type { BillingCurrency, BillingInterval } from '@/lib/billing/types';

/** Pure, deterministic entitlement and workspace-access resolution. */

export type EntitlementStatus = 'trialing' | 'active' | 'expired' | 'canceled';
export type PersistedEntitlementStatus = EntitlementStatus | 'past_due';
export type AccessMode = 'writable' | 'over_limit' | 'read_only';
export type { PlanKey } from '@/config/plan-catalog';

/** The persisted `workspace_entitlements` row, as read under lock. */
export interface EntitlementRecord {
  readonly workspaceId: string;
  readonly status: PersistedEntitlementStatus;
  readonly planKey: PlanKey | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartedAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly billingCurrency: BillingCurrency | null;
  readonly billingInterval: BillingInterval | null;
  readonly pendingPlanKey: PlanKey | null;
  readonly pendingPlanEffectiveAt: Date | null;
}

export { TRIAL_ACCOUNT_LIMIT };

function planAccountLimit(planKey: PlanKey | null): number | null {
  if (planKey === null || !isPlanKey(planKey)) return null;
  return getPlanDefinition(planKey).activeTradingAccountLimit;
}

function isSupportedCurrency(value: unknown): value is BillingCurrency {
  return value === 'THB' || value === 'USD';
}

function isSupportedInterval(value: unknown): value is BillingInterval {
  return value === 'monthly';
}

export type EntitlementBlockReason =
  | 'trial_expired'
  | 'subscription_expired'
  | 'subscription_past_due'
  | 'subscription_canceled'
  | 'malformed_entitlement'
  | 'account_limit_reached'
  | 'workspace_over_limit'
  | 'entitlement_unavailable'
  | 'unknown_plan';

export interface EffectiveEntitlement {
  readonly workspaceId: string;
  readonly persistedStatus: PersistedEntitlementStatus;
  readonly effectiveStatus: EntitlementStatus;
  /** Persisted current plan, retained for compatibility and history display. */
  readonly planKey: PlanKey | null;
  /** Plan used for authorization now, including a due pending downgrade. */
  readonly effectivePlanKey: PlanKey | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartedAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly effectivePeriodEnd: Date | null;
  readonly billingCurrency: BillingCurrency | null;
  readonly billingInterval: BillingInterval | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly pendingPlanKey: PlanKey | null;
  readonly pendingPlanEffectiveAt: Date | null;
  readonly pendingPlanDue: boolean;
  readonly accountLimit: number | null;
  readonly activeAccountCount: number;
  readonly remainingAccountSlots: number;
  readonly canCreateAccount: boolean;
  readonly canRestoreAccount: boolean;
  readonly trialExpired: boolean;
  readonly overLimit: boolean;
  readonly accessMode: AccessMode;
  /** Why workspace access is restricted; null for a fully writable workspace. */
  readonly denialReason: EntitlementBlockReason | null;
  /** Create/restore-specific reason retained for existing callers and UI. */
  readonly blockReason: EntitlementBlockReason | null;
}

export function resolveEffectiveEntitlement(
  record: EntitlementRecord,
  activeAccountCount: number,
  now: Date,
): EffectiveEntitlement {
  const nowMs = now.getTime();
  const pendingPairValid =
    (record.pendingPlanKey === null && record.pendingPlanEffectiveAt === null) ||
    (record.pendingPlanKey !== null && record.pendingPlanEffectiveAt !== null);
  const pendingPlanDue =
    pendingPairValid &&
    record.pendingPlanKey !== null &&
    record.pendingPlanEffectiveAt !== null &&
    nowMs >= record.pendingPlanEffectiveAt.getTime();
  const effectivePlanKey = pendingPlanDue ? record.pendingPlanKey : record.planKey;
  const effectivePlanValid = effectivePlanKey !== null && isPlanKey(effectivePlanKey);

  let effectiveStatus: EntitlementStatus;
  let accountLimit: number | null;
  let denialReason: EntitlementBlockReason | null = null;

  if (record.status === 'trialing') {
    const trialValid =
      record.trialStartedAt !== null &&
      record.trialEndsAt !== null &&
      record.trialStartedAt.getTime() < record.trialEndsAt.getTime();
    const trialExpired = record.trialEndsAt !== null && nowMs >= record.trialEndsAt.getTime();

    accountLimit = TRIAL_ACCOUNT_LIMIT;
    if (!trialValid) {
      effectiveStatus = 'expired';
      denialReason = 'malformed_entitlement';
    } else if (trialExpired) {
      effectiveStatus = 'expired';
      denialReason = 'trial_expired';
    } else {
      effectiveStatus = 'trialing';
    }
  } else if (record.status === 'active') {
    const periodValid =
      record.currentPeriodStartedAt !== null &&
      record.currentPeriodEndsAt !== null &&
      record.currentPeriodStartedAt.getTime() < record.currentPeriodEndsAt.getTime() &&
      nowMs >= record.currentPeriodStartedAt.getTime();
    const paidShapeValid =
      periodValid &&
      effectivePlanValid &&
      isSupportedCurrency(record.billingCurrency) &&
      isSupportedInterval(record.billingInterval) &&
      pendingPairValid &&
      (!record.cancelAtPeriodEnd || record.currentPeriodEndsAt !== null);
    const periodEnded =
      record.currentPeriodEndsAt !== null && nowMs >= record.currentPeriodEndsAt.getTime();

    accountLimit = effectivePlanValid ? planAccountLimit(effectivePlanKey) : null;
    if (!paidShapeValid) {
      effectiveStatus = 'expired';
      denialReason =
        effectivePlanKey !== null && !effectivePlanValid ? 'unknown_plan' : 'malformed_entitlement';
    } else if (periodEnded && record.cancelAtPeriodEnd) {
      effectiveStatus = 'canceled';
      denialReason = 'subscription_canceled';
    } else if (periodEnded) {
      effectiveStatus = 'expired';
      denialReason = 'subscription_expired';
    } else {
      effectiveStatus = 'active';
    }
  } else if (record.status === 'past_due') {
    effectiveStatus = 'canceled';
    accountLimit = effectivePlanValid ? planAccountLimit(effectivePlanKey) : null;
    denialReason = 'subscription_past_due';
  } else if (record.status === 'canceled') {
    effectiveStatus = 'canceled';
    accountLimit = effectivePlanValid ? planAccountLimit(effectivePlanKey) : TRIAL_ACCOUNT_LIMIT;
    denialReason = 'subscription_canceled';
  } else {
    effectiveStatus = 'expired';
    accountLimit = effectivePlanValid ? planAccountLimit(effectivePlanKey) : TRIAL_ACCOUNT_LIMIT;
    denialReason = effectivePlanKey === null ? 'trial_expired' : 'subscription_expired';
  }

  const overLimit = accountLimit !== null && activeAccountCount > accountLimit;
  const remainingAccountSlots =
    accountLimit === null ? 0 : Math.max(0, accountLimit - activeAccountCount);
  const accessMode: AccessMode =
    denialReason !== null ? 'read_only' : overLimit ? 'over_limit' : 'writable';
  if (accessMode === 'over_limit') denialReason = 'workspace_over_limit';

  const blockReason: EntitlementBlockReason | null =
    accessMode === 'read_only'
      ? denialReason
      : overLimit
        ? 'workspace_over_limit'
        : remainingAccountSlots <= 0
          ? 'account_limit_reached'
          : null;

  return {
    workspaceId: record.workspaceId,
    persistedStatus: record.status,
    effectiveStatus,
    planKey: record.planKey,
    effectivePlanKey,
    trialStartedAt: record.trialStartedAt,
    trialEndsAt: record.trialEndsAt,
    currentPeriodStartedAt: record.currentPeriodStartedAt,
    currentPeriodEndsAt: record.currentPeriodEndsAt,
    effectivePeriodEnd:
      record.status === 'trialing' ? record.trialEndsAt : record.currentPeriodEndsAt,
    billingCurrency: record.billingCurrency,
    billingInterval: record.billingInterval,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
    canceledAt: record.canceledAt,
    pendingPlanKey: record.pendingPlanKey,
    pendingPlanEffectiveAt: record.pendingPlanEffectiveAt,
    pendingPlanDue,
    accountLimit,
    activeAccountCount,
    remainingAccountSlots,
    canCreateAccount: accessMode === 'writable' && remainingAccountSlots > 0,
    canRestoreAccount: accessMode === 'writable' && remainingAccountSlots > 0,
    trialExpired: record.status === 'trialing' && effectiveStatus === 'expired',
    overLimit,
    accessMode,
    denialReason,
    blockReason,
  };
}

export interface EntitlementGate {
  readonly allowed: boolean;
  readonly blockReason: EntitlementBlockReason | null;
}

export function resolveEntitlementGate(entitlement: EffectiveEntitlement | null): EntitlementGate {
  if (entitlement === null) {
    return { allowed: false, blockReason: 'entitlement_unavailable' };
  }
  return { allowed: entitlement.canCreateAccount, blockReason: entitlement.blockReason };
}

export type WorkspaceMutationOperation =
  | 'ordinary_write'
  | 'create_trading_account'
  | 'restore_trading_account'
  | 'archive_trading_account';

export type MutationDenialReason =
  EntitlementBlockReason | 'read_only_workspace' | 'over_limit_workspace';

export type MutationAuthorization =
  { readonly allowed: true } | { readonly allowed: false; readonly code: MutationDenialReason };

/** One operation-specific mutation matrix for every server-side caller. */
export function authorizeWorkspaceMutation(
  entitlement: EffectiveEntitlement | null,
  operation: WorkspaceMutationOperation,
): MutationAuthorization {
  if (entitlement === null) {
    return {
      allowed: false,
      code:
        operation === 'create_trading_account' || operation === 'restore_trading_account'
          ? 'entitlement_unavailable'
          : 'read_only_workspace',
    };
  }

  if (entitlement.accessMode === 'read_only') {
    return {
      allowed: false,
      code:
        operation === 'create_trading_account' || operation === 'restore_trading_account'
          ? (entitlement.denialReason ?? 'entitlement_unavailable')
          : 'read_only_workspace',
    };
  }

  if (entitlement.accessMode === 'over_limit') {
    if (operation === 'archive_trading_account') return { allowed: true };
    return {
      allowed: false,
      code: operation === 'ordinary_write' ? 'over_limit_workspace' : 'workspace_over_limit',
    };
  }

  if (
    (operation === 'create_trading_account' || operation === 'restore_trading_account') &&
    entitlement.remainingAccountSlots <= 0
  ) {
    return { allowed: false, code: 'account_limit_reached' };
  }

  return { allowed: true };
}

export class WorkspaceMutationError extends Error {
  readonly code: MutationDenialReason;

  constructor(code: MutationDenialReason) {
    super(`Workspace mutation denied: ${code}`);
    this.name = 'WorkspaceMutationError';
    this.code = code;
  }
}

export function assertWorkspaceMutationAllowed(
  entitlement: EffectiveEntitlement | null,
  operation: WorkspaceMutationOperation,
): void {
  const decision = authorizeWorkspaceMutation(entitlement, operation);
  if (!decision.allowed) throw new WorkspaceMutationError(decision.code);
}

export interface TrialRemaining {
  readonly expired: boolean;
  readonly days: number;
  readonly lessThanOneDay: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeTrialRemaining(trialEndsAt: Date, now: Date): TrialRemaining {
  const remainingMs = trialEndsAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { expired: true, days: 0, lessThanOneDay: false };
  }
  const days = Math.floor(remainingMs / MS_PER_DAY);
  return { expired: false, days, lessThanOneDay: days < 1 };
}
