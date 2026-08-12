import 'server-only';

import { eq } from 'drizzle-orm';

import {
  AdminSubscriptionMutationError,
  evaluateComplimentaryGrant,
  evaluateComplimentaryRevoke,
  evaluateTrialExtension,
  type AdminMutationResult,
  type ExtendTrialInput,
  type GrantComplimentaryPlanInput,
  type RevokeComplimentaryPlanInput,
} from '@/lib/entitlements/admin-transitions';
import { systemClock, type Clock } from '@/lib/time';
import { lockActivePlatformAdminGrant, requirePlatformAdmin } from '@/server/auth/admin-dal';
import { getDb } from '@/server/db/client';
import { workspaceEntitlements } from '@/server/db/schema';
import {
  insertAdminAuditLog,
  type AdminAuditStateSnapshot,
} from '@/server/services/admin-audit-log';
import {
  lockWorkspaceAndEntitlement,
  SubscriptionLifecycleError,
  type EntitlementRow,
  type LifecycleExecutor,
} from '@/server/services/subscription-lifecycle';

/**
 * The Phase 11E Admin Subscription Support transitions — exactly three:
 * `extendTrialByAdmin`, `grantComplimentaryPlan`, `revokeComplimentaryPlan`.
 * No generic `adminPatchEntitlement`/`adminSetStatus`/`adminSetPlan` exists
 * or may be added — every state change here goes through a named,
 * invariant-enforcing transition, the same posture `subscription-
 * lifecycle.ts` already established for the customer-facing transitions
 * this file deliberately mirrors (lock ordering, decide-then-write split,
 * audit written in the SAME transaction as the state change).
 *
 * The eligibility/validation DECISIONS live in `src/lib/entitlements/
 * admin-transitions.ts` — pure, unit-testable, no I/O. This file is the
 * thin transactional shell around them: it locks the real row, calls the
 * pure evaluator, and performs the write + audit insert atomically.
 *
 * Two authorization layers, per Phase 11E's own "do not rely only on the
 * layout" instruction:
 *   1. `requirePlatformAdmin()` — a pre-transaction fail-fast check.
 *   2. `lockActivePlatformAdminGrant(tx, ...)` — a ROW-LOCKED recheck inside
 *      the SAME transaction that mutates the entitlement and writes the
 *      audit row, so a grant revoked between step 1 and the transaction
 *      reaching this point (or concurrently, mid-transaction) is never
 *      honored. The locked grant's own id — never a browser-supplied
 *      `adminGrantId`/`adminUserId` — becomes `admin_audit_log.actor_admin_id`.
 *
 * No new Entitlement resolver/state machine exists here — `resolveEffective
 * Entitlement` (`src/lib/entitlements/resolve.ts`) remains the only reader of
 * "what does this row mean," untouched by this file. These transitions only
 * ever WRITE `workspace_entitlements` in the same structural shapes the
 * existing resolver already understands.
 */

export {
  AdminSubscriptionMutationError,
  type AdminSubscriptionMutationErrorCode,
} from '@/lib/entitlements/admin-transitions';
export type {
  AdminMutationResult,
  ExtendTrialInput,
  GrantComplimentaryPlanInput,
  RevokeComplimentaryPlanInput,
} from '@/lib/entitlements/admin-transitions';

function snapshot(row: EntitlementRow): AdminAuditStateSnapshot {
  return {
    status: row.status,
    planKey: row.planKey,
    source: row.source,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    periodStart: row.currentPeriodStartedAt?.toISOString() ?? null,
    periodEnd: row.currentPeriodEndsAt?.toISOString() ?? null,
  };
}

/**
 * Shared prologue for every Admin mutation: pre-transaction admin check,
 * open the transaction, row-lock-recheck the SAME admin's grant, then lock
 * Workspace+entitlement in the canonical order. Throws
 * `AdminSubscriptionMutationError` for every failure this file's public
 * functions need to distinguish; never lets a raw Postgres/Drizzle error or
 * `SubscriptionLifecycleError` escape uncategorized.
 */
async function withAdminMutation<T>(
  workspaceId: string,
  run: (tx: LifecycleExecutor, row: EntitlementRow, now: Date, adminGrantId: string) => Promise<T>,
  clock: Clock,
): Promise<T> {
  const preCheck = await requirePlatformAdmin();

  try {
    return await getDb().transaction(async (tx) => {
      const lockedGrant = await lockActivePlatformAdminGrant(tx, preCheck.user.id);
      if (lockedGrant === null) {
        throw new AdminSubscriptionMutationError(
          'admin_required',
          'Platform admin authority was revoked before this action completed.',
        );
      }

      let row: EntitlementRow;
      try {
        row = await lockWorkspaceAndEntitlement(tx, workspaceId);
      } catch (error) {
        if (
          error instanceof SubscriptionLifecycleError &&
          error.code === 'entitlement_unavailable'
        ) {
          throw new AdminSubscriptionMutationError(
            'not_found',
            'Workspace or its entitlement record was not found.',
          );
        }
        throw error;
      }

      return run(tx, row, clock.now(), lockedGrant.adminGrantId);
    });
  } catch (error) {
    if (error instanceof AdminSubscriptionMutationError) throw error;
    throw new AdminSubscriptionMutationError('unexpected_error', 'The admin mutation failed.');
  }
}

// ---------------------------------------------------------------------------
// Extend Trial
// ---------------------------------------------------------------------------

export async function extendTrialByAdmin(
  input: ExtendTrialInput,
  clock: Clock = systemClock,
): Promise<AdminMutationResult> {
  return withAdminMutation(
    input.workspaceId,
    async (tx, row, now, adminGrantId) => {
      const decision = evaluateTrialExtension(row, input, now);
      if (!decision.changed) return { changed: false };

      const before = snapshot(row);
      await tx
        .update(workspaceEntitlements)
        .set({ trialEndsAt: decision.nextTrialEndsAt, updatedAt: now })
        .where(eq(workspaceEntitlements.id, row.id));
      const after: AdminAuditStateSnapshot = {
        status: row.status,
        planKey: row.planKey,
        source: row.source,
        trialEndsAt: decision.nextTrialEndsAt.toISOString(),
      };

      await insertAdminAuditLog(tx, {
        actor: { actorKind: 'platform_admin', actorAdminId: adminGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: input.workspaceId,
        reasonCode: input.reasonCode,
        ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
        beforeState: before,
        afterState: after,
      });

      return { changed: true };
    },
    clock,
  );
}

// ---------------------------------------------------------------------------
// Grant Complimentary Plan
// ---------------------------------------------------------------------------

export async function grantComplimentaryPlan(
  input: GrantComplimentaryPlanInput,
  clock: Clock = systemClock,
): Promise<AdminMutationResult> {
  return withAdminMutation(
    input.workspaceId,
    async (tx, row, now, adminGrantId) => {
      const decision = evaluateComplimentaryGrant(row, input);
      if (!decision.changed) return { changed: false };

      const before = snapshot(row);
      if (decision.fresh) {
        // No commercial period, currency, or interval: complimentary access
        // is an Admin-granted allowance, not a payment. `trialStartedAt`/
        // `trialEndsAt` are deliberately omitted from this `.set()` so the
        // original trial baseline survives untouched for a future revoke.
        await tx
          .update(workspaceEntitlements)
          .set({
            status: 'active',
            planKey: input.planKey,
            source: 'complimentary',
            currentPeriodStartedAt: null,
            currentPeriodEndsAt: null,
            billingCurrency: null,
            billingInterval: null,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            pendingPlanKey: null,
            pendingPlanEffectiveAt: null,
            providerKind: null,
            providerCustomerId: null,
            providerSubscriptionId: null,
            updatedAt: now,
          })
          .where(eq(workspaceEntitlements.id, row.id));
      } else {
        // Already complimentary — only the plan allowance changes; the
        // existing (null) period/billing-shape fields are left as they are.
        await tx
          .update(workspaceEntitlements)
          .set({ planKey: input.planKey, updatedAt: now })
          .where(eq(workspaceEntitlements.id, row.id));
      }
      const after: AdminAuditStateSnapshot = {
        status: 'active',
        planKey: input.planKey,
        source: 'complimentary',
        periodStart: null,
        periodEnd: null,
      };

      await insertAdminAuditLog(tx, {
        actor: { actorKind: 'platform_admin', actorAdminId: adminGrantId },
        action: 'subscription.complimentary_granted',
        subjectWorkspaceId: input.workspaceId,
        reasonCode: input.reasonCode,
        ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
        beforeState: before,
        afterState: after,
      });

      return { changed: true };
    },
    clock,
  );
}

// ---------------------------------------------------------------------------
// Revoke Complimentary Plan
// ---------------------------------------------------------------------------

export async function revokeComplimentaryPlan(
  input: RevokeComplimentaryPlanInput,
  clock: Clock = systemClock,
): Promise<AdminMutationResult> {
  return withAdminMutation(
    input.workspaceId,
    async (tx, row, now, adminGrantId) => {
      const decision = evaluateComplimentaryRevoke(row, input);
      if (decision === 'noop') return { changed: false };

      const before = snapshot(row);
      await tx
        .update(workspaceEntitlements)
        .set({
          source: 'trial',
          planKey: null,
          status: 'trialing',
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          billingCurrency: null,
          billingInterval: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          pendingPlanKey: null,
          pendingPlanEffectiveAt: null,
          providerKind: null,
          providerCustomerId: null,
          providerSubscriptionId: null,
          updatedAt: now,
        })
        .where(eq(workspaceEntitlements.id, row.id));
      const after: AdminAuditStateSnapshot = {
        status: 'trialing',
        planKey: null,
        source: 'trial',
        trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
        periodStart: null,
        periodEnd: null,
      };

      await insertAdminAuditLog(tx, {
        actor: { actorKind: 'platform_admin', actorAdminId: adminGrantId },
        action: 'subscription.complimentary_revoked',
        subjectWorkspaceId: input.workspaceId,
        reasonCode: input.reasonCode,
        ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
        beforeState: before,
        afterState: after,
      });

      return { changed: true };
    },
    clock,
  );
}
