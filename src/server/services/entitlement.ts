import 'server-only';

import { and, count, eq } from 'drizzle-orm';

import { TRIAL_DAYS } from '@/config/plans';
import {
  resolveEffectiveEntitlement,
  type EffectiveEntitlement,
  type EntitlementRecord,
  type PersistedEntitlementStatus,
  type PlanKey,
} from '@/lib/entitlements/resolve';
import { systemClock, type Clock } from '@/lib/time';
import type { Database } from '@/server/db/client';
import { tradingAccounts, workspaceEntitlements } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';

/**
 * The one authoritative entitlement service — `completeOnboarding`,
 * `createTradingAccount`, and `restoreTradingAccount` are the only callers
 * that may gate a mutation on its result (CLAUDE.md §4's "subscription
 * entitlement, where the action consumes a limited resource"). No public
 * server action mutates `workspace_entitlements` directly; the two writers
 * here (`startTrialInTx`, and a future verified billing webhook) are it.
 */

/** Structurally matches both a Drizzle transaction handle and the plain database. */
type Executor = Pick<Database, 'select' | 'insert'>;

type EntitlementRow = typeof workspaceEntitlements.$inferSelect;

function toRecord(row: EntitlementRow): EntitlementRecord {
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

/**
 * Starts a workspace's one-and-only trial. Call ONLY from
 * `completeOnboarding`'s fresh-completion branch, after the workspace row is
 * already locked `FOR UPDATE` in the same transaction — never from the
 * "already completed" replay branch, so a repeated onboarding completion can
 * never restart or extend the trial.
 *
 * `ON CONFLICT (workspace_id) DO NOTHING` is defence-in-depth idempotency:
 * the workspace-row lock already prevents two concurrent fresh-completions
 * of the SAME workspace, but this guarantees correctness even if a future
 * call site starts a trial without that lock.
 */
export async function startTrialInTx(
  tx: Executor,
  workspaceId: string,
  actorUserId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const inserted = await tx
    .insert(workspaceEntitlements)
    .values({ workspaceId, status: 'trialing', trialStartedAt: now, trialEndsAt })
    .onConflictDoNothing({ target: workspaceEntitlements.workspaceId })
    .returning({ id: workspaceEntitlements.id });

  if (inserted.length > 0) {
    await insertAuditLog(tx, {
      action: 'workspace.trial_started',
      workspaceId,
      actorUserId,
      entityType: 'workspace_entitlements',
      entityId: workspaceId,
    });
  }
}

async function countActiveAccounts(tx: Executor, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(tradingAccounts)
    .where(
      and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
    );
  return row?.value ?? 0;
}

export type EntitlementLockResult =
  | { readonly ok: true; readonly effective: EffectiveEntitlement }
  | { readonly ok: false; readonly code: 'entitlement_unavailable' };

/**
 * Locks the workspace's entitlement row `FOR UPDATE` and resolves the
 * effective entitlement under that lock — the read `createTradingAccount`
 * and `restoreTradingAccount` must perform AFTER their idempotency check but
 * BEFORE deciding whether the mutation is allowed, per the phase brief's
 * required step ordering. Locking here (rather than only locking
 * `workspaces`, which callers already do) is what actually serializes two
 * concurrent creates/restores racing for the same last slot: both block on
 * this row, and PostgreSQL's READ COMMITTED re-read-on-unblock semantics
 * mean the second caller observes the first's committed account count.
 *
 * `ok: false` only when a workspace has no entitlement row at all — this
 * should not happen for any workspace whose onboarding has completed (the
 * migration backfilled every such workspace, and `completeOnboarding`
 * starts one for every new workspace going forward), so callers treat it as
 * a fail-closed anomaly, not a normal state to design UI around.
 */
export async function lockAndResolveEntitlement(
  tx: Executor,
  workspaceId: string,
  clock: Clock = systemClock,
): Promise<EntitlementLockResult> {
  const [row] = await tx
    .select()
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, workspaceId))
    .for('update');

  if (row === undefined) {
    return { ok: false, code: 'entitlement_unavailable' };
  }

  const activeAccountCount = await countActiveAccounts(tx, workspaceId);
  const effective = resolveEffectiveEntitlement(toRecord(row), activeAccountCount, clock.now());
  return { ok: true, effective };
}

/**
 * Read-only resolution for display — no row lock, since nothing here gates a
 * write. Used by `src/server/auth/dal.ts`'s cached resolver for the trial
 * banner, the accounts page, and `/app/plan`. Returns `null` only for the
 * fail-closed anomaly case above (no entitlement row for a workspace whose
 * onboarding is complete).
 */
export async function readEffectiveEntitlement(
  db: Executor,
  workspaceId: string,
  clock: Clock = systemClock,
): Promise<EffectiveEntitlement | null> {
  const [row] = await db
    .select()
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, workspaceId));

  if (row === undefined) {
    return null;
  }

  const activeAccountCount = await countActiveAccounts(db, workspaceId);
  return resolveEffectiveEntitlement(toRecord(row), activeAccountCount, clock.now());
}
