import 'server-only';

import { fillUtc30DayCounts, resolveUtc30DayWindow } from '@/lib/admin/date-window';
import {
  resolveEffectiveEntitlement,
  type EntitlementRecord,
  type EntitlementStatus,
  type PersistedEntitlementStatus,
  type PlanKey,
} from '@/lib/entitlements/resolve';
import { systemClock, type Clock } from '@/lib/time';
import { requirePlatformAdmin } from '@/server/auth/admin-dal';
import {
  countAllUsers,
  countAllWorkspaces,
  countTradesCreatedByUtcDay,
  countUsersCreatedByUtcDay,
  listAllEntitlementRows,
  type AdminEntitlementRow,
} from '@/server/dal/admin/metrics';
import { getDb } from '@/server/db/client';

/**
 * The Phase 11C Admin Overview dashboard — read-only, aggregate-only, no
 * mutation. `requirePlatformAdmin()` is re-checked HERE, not only in the
 * `/admin` route layout (Phase 11's own "the layout guard alone is not
 * sufficient" instruction) — this is the function any future admin page or
 * service calls, so the authoritative check belongs at this boundary, not
 * merely upstream of it.
 */

export type EffectiveStatusCount = {
  readonly status: EntitlementStatus;
  readonly count: number;
};
export type PlanDistributionCount = {
  readonly plan: PlanKey | 'none';
  readonly count: number;
};
export type EntitlementSourceCount = {
  readonly source: 'trial' | 'paid' | 'complimentary';
  readonly count: number;
};
export type DayActivityCount = { readonly day: string; readonly count: number };

/**
 * A strict, JSON-serializable DTO — no `Date`, no `bigint`, no DB row, no
 * session/grant object (Phase 11C's own contract). Every field here is
 * either a plain number, a plain string, or an array of one of those two
 * shapes. This is what crosses the server/client boundary into React.
 */
export interface AdminOverviewDashboard {
  readonly generatedAt: string;
  readonly totals: {
    readonly users: number;
    readonly workspaces: number;
  };
  readonly subscriptions: {
    readonly byEffectiveStatus: readonly EffectiveStatusCount[];
    readonly byPlan: readonly PlanDistributionCount[];
    /**
     * A supporting breakdown, not a headline metric — exists solely so
     * `byPlan`'s counts are never misread as "paying customers" (Phase 11's
     * own "do not call complimentary Workspaces Paid subscribers" rule). A
     * Professional-plan complimentary grant counts under `byPlan`'s
     * `professional` bucket AND under `bySource`'s `complimentary` bucket —
     * both true simultaneously, neither hidden.
     */
    readonly bySource: readonly EntitlementSourceCount[];
  };
  readonly activity: {
    readonly newUsers30d: readonly DayActivityCount[];
    readonly tradesLogged30d: readonly DayActivityCount[];
  };
}

const EFFECTIVE_STATUSES: readonly EntitlementStatus[] = [
  'trialing',
  'active',
  'expired',
  'canceled',
];
/** `'none'` is a trial that never selected a plan — never silently assigned `starter` (Phase 11's own locked rule). */
const PLAN_BUCKETS: readonly (PlanKey | 'none')[] = ['starter', 'trader', 'professional', 'none'];
const ENTITLEMENT_SOURCES: readonly ('trial' | 'paid' | 'complimentary')[] = [
  'trial',
  'paid',
  'complimentary',
];

/**
 * Row -> canonical `EntitlementRecord`, the exact input shape `src/server/
 * services/entitlement.ts`'s `toRecord` already builds for the same table —
 * duplicated here rather than imported because that function is `Executor`-
 * typed for the entitlement service's own transaction boundary, not this
 * DAL's plain `Database` read. Casts mirror that function's own (the DB
 * CHECK constraints are the actual guarantee these values are closed).
 */
function toEntitlementRecord(row: AdminEntitlementRow): EntitlementRecord {
  return {
    workspaceId: row.workspaceId,
    status: row.status as PersistedEntitlementStatus,
    planKey: row.planKey as PlanKey | null,
    trialStartedAt: row.trialStartedAt,
    trialEndsAt: row.trialEndsAt,
    currentPeriodStartedAt: row.currentPeriodStartedAt,
    currentPeriodEndsAt: row.currentPeriodEndsAt,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt,
    billingCurrency: row.billingCurrency as EntitlementRecord['billingCurrency'],
    billingInterval: row.billingInterval as EntitlementRecord['billingInterval'],
    pendingPlanKey: row.pendingPlanKey as PlanKey | null,
    pendingPlanEffectiveAt: row.pendingPlanEffectiveAt,
    source: row.source as 'trial' | 'paid' | 'complimentary',
  };
}

export async function getAdminOverviewDashboard(
  clock: Clock = systemClock,
): Promise<AdminOverviewDashboard> {
  await requirePlatformAdmin();

  const db = getDb();
  const now = clock.now();
  const window = resolveUtc30DayWindow(now);

  const [totalUsers, totalWorkspaces, entitlementRows, newUsersRaw, tradesRaw] = await Promise.all([
    countAllUsers(db),
    countAllWorkspaces(db),
    listAllEntitlementRows(db),
    countUsersCreatedByUtcDay(db, window.startInclusive, window.endExclusive),
    countTradesCreatedByUtcDay(db, window.startInclusive, window.endExclusive),
  ]);

  const statusCounts = new Map<EntitlementStatus, number>(EFFECTIVE_STATUSES.map((s) => [s, 0]));
  const planCounts = new Map<PlanKey | 'none', number>(PLAN_BUCKETS.map((p) => [p, 0]));
  const sourceCounts = new Map<'trial' | 'paid' | 'complimentary', number>(
    ENTITLEMENT_SOURCES.map((s) => [s, 0]),
  );

  for (const row of entitlementRows) {
    // `activeAccountCount: 0` is deliberate, not a shortcut that happens to
    // work: `resolveEffectiveEntitlement`'s `effectiveStatus`/
    // `effectivePlanKey` never read it (only `overLimit`/`accessMode`/
    // `blockReason`/slot counts do, none of which this dashboard reads) —
    // see that function's own implementation. Avoiding a second per-
    // workspace trading-account-count query here is exactly the "avoid N+1"
    // instruction, not a correctness compromise.
    const effective = resolveEffectiveEntitlement(toEntitlementRecord(row), 0, now);

    statusCounts.set(
      effective.effectiveStatus,
      (statusCounts.get(effective.effectiveStatus) ?? 0) + 1,
    );

    const planBucket: PlanKey | 'none' = effective.effectivePlanKey ?? 'none';
    planCounts.set(planBucket, (planCounts.get(planBucket) ?? 0) + 1);

    const sourceBucket = row.source as 'trial' | 'paid' | 'complimentary';
    sourceCounts.set(sourceBucket, (sourceCounts.get(sourceBucket) ?? 0) + 1);
  }

  return {
    generatedAt: now.toISOString(),
    totals: { users: totalUsers, workspaces: totalWorkspaces },
    subscriptions: {
      byEffectiveStatus: EFFECTIVE_STATUSES.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      byPlan: PLAN_BUCKETS.map((plan) => ({ plan, count: planCounts.get(plan) ?? 0 })),
      bySource: ENTITLEMENT_SOURCES.map((source) => ({
        source,
        count: sourceCounts.get(source) ?? 0,
      })),
    },
    activity: {
      newUsers30d: fillUtc30DayCounts(window, newUsersRaw),
      tradesLogged30d: fillUtc30DayCounts(window, tradesRaw),
    },
  };
}
