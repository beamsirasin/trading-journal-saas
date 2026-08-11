import 'server-only';

import { inArray } from 'drizzle-orm';

import type {
  EntitlementRecord,
  PersistedEntitlementStatus,
  PlanKey,
} from '@/lib/entitlements/resolve';
import type { Database } from '@/server/db/client';
import { workspaceEntitlements } from '@/server/db/schema';

/**
 * The shared entitlement projection every Admin oversight surface needs —
 * originally defined only in `src/server/dal/admin/metrics.ts` (Phase 11C);
 * factored out here in Phase 11D once a second consumer (`users.ts`/
 * `workspaces.ts` oversight) needed the identical shape, so there is one
 * column list to keep in sync with `resolveEffectiveEntitlement`
 * (`src/lib/entitlements/resolve.ts`), not several.
 */
export interface AdminEntitlementRow {
  readonly workspaceId: string;
  readonly status: string;
  readonly planKey: string | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartedAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly billingCurrency: string | null;
  readonly billingInterval: string | null;
  readonly pendingPlanKey: string | null;
  readonly pendingPlanEffectiveAt: Date | null;
  readonly source: string;
}

const ENTITLEMENT_PROJECTION = {
  workspaceId: workspaceEntitlements.workspaceId,
  status: workspaceEntitlements.status,
  planKey: workspaceEntitlements.planKey,
  trialStartedAt: workspaceEntitlements.trialStartedAt,
  trialEndsAt: workspaceEntitlements.trialEndsAt,
  currentPeriodStartedAt: workspaceEntitlements.currentPeriodStartedAt,
  currentPeriodEndsAt: workspaceEntitlements.currentPeriodEndsAt,
  cancelAtPeriodEnd: workspaceEntitlements.cancelAtPeriodEnd,
  canceledAt: workspaceEntitlements.canceledAt,
  billingCurrency: workspaceEntitlements.billingCurrency,
  billingInterval: workspaceEntitlements.billingInterval,
  pendingPlanKey: workspaceEntitlements.pendingPlanKey,
  pendingPlanEffectiveAt: workspaceEntitlements.pendingPlanEffectiveAt,
  source: workspaceEntitlements.source,
} as const;

/** Unfiltered — the Overview dashboard's own whole-table aggregate (Phase 11C). */
export async function listAllEntitlementRows(db: Database): Promise<AdminEntitlementRow[]> {
  return db.select(ENTITLEMENT_PROJECTION).from(workspaceEntitlements);
}

/** Scoped to a bounded set of Workspace IDs — the User/Workspace oversight list-page shape (Phase 11D): one fixed query per page, never one query per row. */
export async function listEntitlementsByWorkspaceIds(
  db: Database,
  workspaceIds: readonly string[],
): Promise<AdminEntitlementRow[]> {
  if (workspaceIds.length === 0) return [];
  return db
    .select(ENTITLEMENT_PROJECTION)
    .from(workspaceEntitlements)
    .where(inArray(workspaceEntitlements.workspaceId, workspaceIds));
}

/**
 * Row -> canonical `EntitlementRecord`, the exact shape `resolveEffectiveEntitlement`
 * needs. Mirrors `src/server/services/admin/metrics.ts`'s own private `toEntitlementRecord`
 * (kept there unchanged rather than migrated, to avoid touching already-verified Phase 11C
 * code); this copy is the one both `user-oversight.ts` and `workspace-oversight.ts` share so
 * a THIRD copy never appears. Casts mirror the DB's own CHECK constraints, the actual
 * guarantee these values are closed.
 */
export function toEntitlementRecord(row: AdminEntitlementRow): EntitlementRecord {
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
  };
}
