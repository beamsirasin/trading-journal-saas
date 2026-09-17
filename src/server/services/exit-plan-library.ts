import 'server-only';

import { and, eq, ne } from 'drizzle-orm';

import { normalizeRequiredText } from '@/lib/strategies/validation';
import { systemClock, type Clock } from '@/lib/time';
import { getDb, type Database } from '@/server/db/client';
import { exitPlans } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import {
  acquireWorkspaceWriteAccess,
  lockStrategyRow,
  lockWorkspaceAndVerifyMembership,
  resolveMutationDenial,
  type WorkspaceAccessDenial,
} from './strategy-management';

/**
 * SAVED EXIT PLAN LIBRARY (Add Trade contract §5).
 *
 * The library a trader chooses from in At Entry, and the Strategy default At
 * Entry inherits. Every function takes `workspaceId`/`userId` already derived
 * from the session and re-verifies membership and entitlement itself, in the
 * canonical lock order `strategy-management.ts` documents: workspace row →
 * membership → entitlement → Strategy row → the plan rows.
 *
 * WHAT THIS NEVER DOES: touch a Trade. A Trade snapshots a plan's name and
 * instructions when it adopts one, so editing or archiving a plan here changes
 * only what future Trades are offered — never what an earlier Trade says its
 * plan was. `trades.exit_plan_id` stays as provenance.
 *
 * Plans are archived, never deleted. Archiving also removes a plan as a
 * Strategy default, because an archived plan can no longer be offered, and a
 * default nobody can inherit would only be a stale pointer.
 *
 * Written as the one service a future centralized library page reuses; the
 * At Entry management view is simply its first caller.
 */

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'query'>;
type ExitPlanRow = typeof exitPlans.$inferSelect;

export type ExitPlanLibraryErrorCode =
  | WorkspaceAccessDenial
  | 'exit_plan_not_found'
  | 'exit_plan_archived'
  | 'strategy_not_found'
  | 'strategy_archived'
  | 'blank_name'
  | 'blank_instructions';

type Failure = { readonly ok: false; readonly code: ExitPlanLibraryErrorCode };

async function lockExitPlanRow(
  tx: Executor,
  workspaceId: string,
  exitPlanId: string,
): Promise<{ readonly ok: true; readonly plan: ExitPlanRow } | Failure> {
  const [plan] = await tx
    .select()
    .from(exitPlans)
    .where(and(eq(exitPlans.id, exitPlanId), eq(exitPlans.workspaceId, workspaceId)))
    .for('update');
  if (plan === undefined) return { ok: false, code: 'exit_plan_not_found' };
  return { ok: true, plan };
}

function normalizeWording(
  name: string,
  instructions: string,
): { readonly ok: true; readonly name: string; readonly instructions: string } | Failure {
  const normalizedName = normalizeRequiredText(name);
  if (!normalizedName.ok) return { ok: false, code: 'blank_name' };
  const normalizedInstructions = normalizeRequiredText(instructions);
  if (!normalizedInstructions.ok) return { ok: false, code: 'blank_instructions' };
  return { ok: true, name: normalizedName.value, instructions: normalizedInstructions.value };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateExitPlanInput {
  readonly mutationKey: string;
  readonly name: string;
  readonly instructions: string;
}

export type CreateExitPlanResult =
  { readonly ok: true; readonly exitPlanId: string; readonly alreadyCreated: boolean } | Failure;

/**
 * Idempotent on `(workspace_id, mutation_key)`, exactly like `createStrategy`:
 * membership is checked before the replay lookup, entitlement only for a
 * genuinely new key, so a create whose response was lost stays replayable.
 */
export async function createExitPlan(
  workspaceId: string,
  userId: string,
  input: CreateExitPlanInput,
  clock: Clock = systemClock,
): Promise<CreateExitPlanResult> {
  return getDb().transaction(async (tx) => {
    const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
    if (membershipDenial !== null) return { ok: false, code: membershipDenial };

    const existing = await tx.query.exitPlans.findFirst({
      where: and(
        eq(exitPlans.workspaceId, workspaceId),
        eq(exitPlans.mutationKey, input.mutationKey),
      ),
    });
    if (existing !== undefined) return { ok: true, exitPlanId: existing.id, alreadyCreated: true };

    const denial = await resolveMutationDenial(tx, workspaceId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const wording = normalizeWording(input.name, input.instructions);
    if (!wording.ok) return wording;

    const [created] = await tx
      .insert(exitPlans)
      .values({
        workspaceId,
        mutationKey: input.mutationKey,
        name: wording.name,
        instructions: wording.instructions,
      })
      .returning({ id: exitPlans.id });
    if (created === undefined) throw new Error('createExitPlan: insert returned no row');

    await insertAuditLog(tx, {
      action: 'exit_plan.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'exit_plan',
      entityId: created.id,
    });

    return { ok: true, exitPlanId: created.id, alreadyCreated: false };
  });
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface UpdateExitPlanInput {
  readonly name: string;
  readonly instructions: string;
}

export type UpdateExitPlanResult =
  { readonly ok: true; readonly changedFields: readonly string[] } | Failure;

/** Edits the library definition only. Trades that already adopted this plan keep their snapshot. */
export async function updateExitPlan(
  workspaceId: string,
  userId: string,
  exitPlanId: string,
  input: UpdateExitPlanInput,
  clock: Clock = systemClock,
): Promise<UpdateExitPlanResult> {
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const wording = normalizeWording(input.name, input.instructions);
    if (!wording.ok) return wording;

    const lock = await lockExitPlanRow(tx, workspaceId, exitPlanId);
    if (!lock.ok) return lock;
    if (lock.plan.isArchived) return { ok: false, code: 'exit_plan_archived' };

    const changedFields: string[] = [];
    if (wording.name !== lock.plan.name) changedFields.push('name');
    if (wording.instructions !== lock.plan.instructions) changedFields.push('instructions');
    if (changedFields.length === 0) return { ok: true, changedFields };

    await tx
      .update(exitPlans)
      .set({ name: wording.name, instructions: wording.instructions, updatedAt: clock.now() })
      .where(eq(exitPlans.id, exitPlanId));

    await insertAuditLog(tx, {
      action: 'exit_plan.updated',
      workspaceId,
      actorUserId: userId,
      entityType: 'exit_plan',
      entityId: exitPlanId,
      metadata: { changedFields },
    });

    return { ok: true, changedFields };
  });
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export type ArchiveExitPlanResult = { readonly ok: true } | Failure;

/** Idempotent. Also removes the plan as a Strategy default (see the module comment). */
export async function archiveExitPlan(
  workspaceId: string,
  userId: string,
  exitPlanId: string,
  clock: Clock = systemClock,
): Promise<ArchiveExitPlanResult> {
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const lock = await lockExitPlanRow(tx, workspaceId, exitPlanId);
    if (!lock.ok) return lock;
    if (lock.plan.isArchived) return { ok: true };

    await tx
      .update(exitPlans)
      .set({ isArchived: true, strategyId: null, updatedAt: clock.now() })
      .where(eq(exitPlans.id, exitPlanId));

    await insertAuditLog(tx, {
      action: 'exit_plan.archived',
      workspaceId,
      actorUserId: userId,
      entityType: 'exit_plan',
      entityId: exitPlanId,
      ...(lock.plan.strategyId === null ? {} : { metadata: { strategyId: lock.plan.strategyId } }),
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Strategy default
// ---------------------------------------------------------------------------

export type SetExitPlanStrategyDefaultResult =
  | {
      readonly ok: true;
      /** The plan that was this Strategy's default before, when a different one was. */
      readonly replacedExitPlanId: string | null;
    }
  | Failure;

/**
 * Makes an active plan the default for an active Strategy in the same
 * workspace, REPLACING that Strategy's current default in the same
 * transaction. A plan is the default for at most one Strategy, so a plan
 * already defaulting elsewhere moves here.
 *
 * The old default is cleared before the new one is set, which is what keeps
 * `exit_plans_strategy_default_idx` (one active default per Strategy)
 * satisfied at every statement, not only at commit.
 */
export async function setExitPlanStrategyDefault(
  workspaceId: string,
  userId: string,
  exitPlanId: string,
  strategyId: string,
  clock: Clock = systemClock,
): Promise<SetExitPlanStrategyDefaultResult> {
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

    const lock = await lockExitPlanRow(tx, workspaceId, exitPlanId);
    if (!lock.ok) return lock;
    if (lock.plan.isArchived) return { ok: false, code: 'exit_plan_archived' };
    if (lock.plan.strategyId === strategyId) return { ok: true, replacedExitPlanId: null };

    const displaced = await tx
      .update(exitPlans)
      .set({ strategyId: null, updatedAt: clock.now() })
      .where(
        and(
          eq(exitPlans.workspaceId, workspaceId),
          eq(exitPlans.strategyId, strategyId),
          eq(exitPlans.isArchived, false),
          ne(exitPlans.id, exitPlanId),
        ),
      )
      .returning({ id: exitPlans.id });
    const replacedExitPlanId = displaced[0]?.id ?? null;

    await tx
      .update(exitPlans)
      .set({ strategyId, updatedAt: clock.now() })
      .where(eq(exitPlans.id, exitPlanId));

    await insertAuditLog(tx, {
      action: 'exit_plan.default_set',
      workspaceId,
      actorUserId: userId,
      entityType: 'exit_plan',
      entityId: exitPlanId,
      metadata: {
        strategyId,
        ...(replacedExitPlanId === null ? {} : { replacedExitPlanId }),
      },
    });

    return { ok: true, replacedExitPlanId };
  });
}

export type RemoveExitPlanStrategyDefaultResult = { readonly ok: true } | Failure;

/** Idempotent. The plan stays in the library; the Strategy simply has no default. */
export async function removeExitPlanStrategyDefault(
  workspaceId: string,
  userId: string,
  exitPlanId: string,
  clock: Clock = systemClock,
): Promise<RemoveExitPlanStrategyDefaultResult> {
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const lock = await lockExitPlanRow(tx, workspaceId, exitPlanId);
    if (!lock.ok) return lock;
    if (lock.plan.strategyId === null) return { ok: true };

    await tx
      .update(exitPlans)
      .set({ strategyId: null, updatedAt: clock.now() })
      .where(eq(exitPlans.id, exitPlanId));

    await insertAuditLog(tx, {
      action: 'exit_plan.default_removed',
      workspaceId,
      actorUserId: userId,
      entityType: 'exit_plan',
      entityId: exitPlanId,
      metadata: { strategyId: lock.plan.strategyId },
    });

    return { ok: true };
  });
}
