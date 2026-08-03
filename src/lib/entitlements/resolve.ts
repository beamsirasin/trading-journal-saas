import { PLANS, type Plan } from '@/config/plans';

/**
 * Pure, deterministic entitlement resolution — no I/O, no db (same discipline
 * as `lib/calc/`, CLAUDE.md §3). Takes a persisted row, a live account count,
 * and an explicit `now`, and returns one immutable snapshot every caller
 * (server actions, UI) reads from. Nothing here trusts a client-supplied
 * plan, status or count — those always come from the workspace-scoped
 * database read in `src/server/services/entitlement.ts`.
 */

export type EntitlementStatus = 'trialing' | 'active' | 'expired' | 'canceled';
export type PlanKey = Plan['id'];

/** The persisted `workspace_entitlements` row, as read under lock. */
export interface EntitlementRecord {
  readonly workspaceId: string;
  readonly status: EntitlementStatus;
  readonly planKey: PlanKey | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
}

/**
 * The trial unlocks the highest currently-configured plan allowance, so a
 * trialing workspace never needs to know which paid plan it will eventually
 * pick before evaluating whether it can create another account.
 */
export const TRIAL_ACCOUNT_LIMIT = Math.max(...PLANS.map((plan) => plan.tradingAccounts));

function planAccountLimit(planKey: PlanKey | null): number | null {
  if (planKey === null) return null;
  const plan = PLANS.find((candidate) => candidate.id === planKey);
  return plan?.tradingAccounts ?? null;
}

export type EntitlementBlockReason =
  | 'trial_expired'
  | 'subscription_canceled'
  | 'account_limit_reached'
  | 'workspace_over_limit'
  | 'entitlement_unavailable'
  | 'unknown_plan';

export interface EffectiveEntitlement {
  readonly workspaceId: string;
  readonly persistedStatus: EntitlementStatus;
  /** `persistedStatus`, except a trial past `trialEndsAt` is reported `expired` even with no persisted transition. */
  readonly effectiveStatus: EntitlementStatus;
  readonly planKey: PlanKey | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  /** `null` only when `planKey` fails to resolve against `PLANS` — fail closed, never a guessed number. */
  readonly accountLimit: number | null;
  readonly activeAccountCount: number;
  readonly remainingAccountSlots: number;
  readonly canCreateAccount: boolean;
  readonly canRestoreAccount: boolean;
  readonly trialExpired: boolean;
  readonly overLimit: boolean;
  /** `null` when creation/restoration is allowed; otherwise the reason a caller should surface. */
  readonly blockReason: EntitlementBlockReason | null;
}

export function resolveEffectiveEntitlement(
  record: EntitlementRecord,
  activeAccountCount: number,
  now: Date,
): EffectiveEntitlement {
  const trialTimedOut =
    record.status === 'trialing' &&
    record.trialEndsAt !== null &&
    now.getTime() >= record.trialEndsAt.getTime();

  const effectiveStatus: EntitlementStatus = trialTimedOut ? 'expired' : record.status;

  const planUnknown = record.planKey !== null && planAccountLimit(record.planKey) === null;

  let accountLimit: number | null;
  if (effectiveStatus === 'trialing') {
    accountLimit = TRIAL_ACCOUNT_LIMIT;
  } else if (planUnknown) {
    accountLimit = null;
  } else if (record.planKey !== null) {
    accountLimit = planAccountLimit(record.planKey);
  } else {
    // Expired/canceled with no plan ever selected (a trial that ran out) —
    // still meaningful to report the trial's own limit for display ("0/10").
    accountLimit = TRIAL_ACCOUNT_LIMIT;
  }

  const overLimit = accountLimit !== null && activeAccountCount > accountLimit;
  const remainingAccountSlots =
    accountLimit === null ? 0 : Math.max(0, accountLimit - activeAccountCount);

  const blockReason = resolveBlockReason({
    effectiveStatus,
    planUnknown,
    overLimit,
    remainingAccountSlots,
  });

  return {
    workspaceId: record.workspaceId,
    persistedStatus: record.status,
    effectiveStatus,
    planKey: record.planKey,
    trialStartedAt: record.trialStartedAt,
    trialEndsAt: record.trialEndsAt,
    accountLimit,
    activeAccountCount,
    remainingAccountSlots,
    canCreateAccount: blockReason === null,
    canRestoreAccount: blockReason === null,
    trialExpired: effectiveStatus === 'expired',
    overLimit,
    blockReason,
  };
}

function resolveBlockReason(input: {
  effectiveStatus: EntitlementStatus;
  planUnknown: boolean;
  overLimit: boolean;
  remainingAccountSlots: number;
}): EntitlementBlockReason | null {
  if (input.planUnknown) return 'unknown_plan';
  if (input.effectiveStatus === 'expired') return 'trial_expired';
  if (input.effectiveStatus === 'canceled') return 'subscription_canceled';
  if (input.overLimit) return 'workspace_over_limit';
  if (input.remainingAccountSlots <= 0) return 'account_limit_reached';
  return null;
}

export interface TrialRemaining {
  readonly expired: boolean;
  /** Whole days remaining, floored, never negative. */
  readonly days: number;
  /** True once fewer than 24 hours remain but the trial is not yet expired — UI special-cases this. */
  readonly lessThanOneDay: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Pure day-count helper backing the trial banner's "N days remaining" / "less than one day remaining" copy. */
export function computeTrialRemaining(trialEndsAt: Date, now: Date): TrialRemaining {
  const remainingMs = trialEndsAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { expired: true, days: 0, lessThanOneDay: false };
  }
  const days = Math.floor(remainingMs / MS_PER_DAY);
  return { expired: false, days, lessThanOneDay: days < 1 };
}
