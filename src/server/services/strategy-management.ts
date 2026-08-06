import 'server-only';

import { and, eq } from 'drizzle-orm';

import { authorizeWorkspaceMutation, type MutationDenialReason } from '@/lib/entitlements/resolve';
import { isStrategyRuleCategory } from '@/lib/strategies/constants';
import {
  normalizeChangeNote,
  normalizeOptionalText,
  normalizeRequiredText,
} from '@/lib/strategies/validation';
import { systemClock, type Clock } from '@/lib/time';
import { getDb, type Database } from '@/server/db/client';
import {
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { lockAndResolveEntitlement } from './entitlement';
import { copyCurrentVersionInTx } from './strategy-versioning';

/**
 * Strategy/Setup/Rule domain services — Phase 06C. No Server Action, page,
 * or DAL exists yet; every function here takes `workspaceId`/`actorUserId`
 * already resolved from the session by a future caller (never client
 * input — CLAUDE.md §4) and independently re-verifies active membership
 * itself, the same defense-in-depth posture `trading-account-management.ts`
 * establishes.
 *
 * ## Canonical transaction lock order
 *
 * Every mutation in this file acquires locks in exactly this order, so
 * nothing here can deadlock against `trading-account-management.ts`,
 * `trading-account.ts`, or `entitlement.ts` — all of them lock the SAME
 * `workspaces` row first, before touching any other table, so lock
 * acquisition order across every workspace-scoped service in this
 * repository is consistent:
 *
 * 1. Owning `workspaces` row `FOR UPDATE` (`acquireWorkspaceWriteAccess`).
 * 2. Active workspace membership verification (same helper; no lock, a
 *    plain read, but always performed immediately after the workspace lock
 *    and before anything else).
 * 3. Canonical entitlement resolution/authorization — `lockAndResolveEntitlement`
 *    (which itself locks `workspace_entitlements` `FOR UPDATE`) plus
 *    `authorizeWorkspaceMutation(entitlement, 'ordinary_write')`. Every
 *    mutation in this domain is an ordinary business write — none of them
 *    consume a limited resource, so `'ordinary_write'` is the only operation
 *    this domain ever passes; ­see CLAUDE.md and the Phase 06A audit for why
 *    this needed no new variant in `resolve.ts`.
 * 4. `strategies` identity row `FOR UPDATE`, where the mutation targets one
 *    (`lockStrategyRow`).
 * 5. The Strategy's *current* `strategy_versions` row `FOR UPDATE`, where
 *    the mutation may read or copy-on-write version content
 *    (`lockCurrentVersionRow`). Reading `current_version_id` only after the
 *    Strategy row is locked (step 4) is what makes a waiting transaction
 *    re-read the true current version once it unblocks, rather than acting
 *    on a stale value read before it queued for the lock.
 * 6. `setups` identity row `FOR UPDATE`, where the mutation targets one
 *    (`lockSetupRow`) — always after the Strategy/Version locks above.
 * 7. Mutation-specific reads and writes.
 *
 * Steps are skipped ("where applicable") when they do not apply — archiving
 * a Strategy never touches step 5 or 6, for instance. No function here ever
 * acquires a later-numbered lock before an earlier one.
 */

/** Structurally matches both a Drizzle transaction handle and the plain database. */
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'query'>;

export type WorkspaceAccessDenial = 'workspace_access_denied' | MutationDenialReason;

/** Lock order step 1: the owning workspace row. Every mutation in this file calls this first. */
async function lockWorkspaceRow(tx: Executor, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  return row !== undefined;
}

/** Lock order step 2: active membership — a plain read, no lock of its own. */
async function verifyActiveMembership(
  tx: Executor,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Lock order step 3: canonical entitlement resolution — every mutation here is `'ordinary_write'`. */
async function resolveMutationDenial(
  tx: Parameters<typeof lockAndResolveEntitlement>[0],
  workspaceId: string,
  clock: Clock,
): Promise<MutationDenialReason | null> {
  const entitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
  const decision = authorizeWorkspaceMutation(
    entitlement.ok ? entitlement.effective : null,
    'ordinary_write',
  );
  return decision.allowed ? null : decision.code;
}

/**
 * Lock order steps 1–2, composed. A trusted `workspaceId` is expected to
 * always resolve to a real row (it comes from the caller's own session-
 * derived active workspace, never client input); a missing row is an
 * unreachable programming error, not a normal denial, so it throws rather
 * than returning a code.
 *
 * Split out from entitlement resolution (step 3) specifically for
 * `createStrategy`/`createSetup`: an idempotent replay of an existing
 * `mutationKey` must still require active membership (never let a removed
 * member retrieve data), but must NOT require current entitlement — a
 * successful create whose response was lost must stay safely replayable
 * even if the workspace later became `read_only`/`over_limit`, since
 * replaying it performs no new write. Every other mutation in this file
 * has no such exception and calls `acquireWorkspaceWriteAccess` below,
 * which still performs steps 1–3 together.
 */
async function lockWorkspaceAndVerifyMembership(
  tx: Executor,
  workspaceId: string,
  userId: string,
): Promise<'workspace_access_denied' | null> {
  const exists = await lockWorkspaceRow(tx, workspaceId);
  if (!exists) {
    throw new Error(`lockWorkspaceAndVerifyMembership: workspace ${workspaceId} not found`);
  }
  const isMember = await verifyActiveMembership(tx, workspaceId, userId);
  if (!isMember) return 'workspace_access_denied';
  return null;
}

/** Lock order steps 1–3, composed — the common case for every mutation without an idempotency-replay exception. */
async function acquireWorkspaceWriteAccess(
  tx: Executor,
  workspaceId: string,
  userId: string,
  clock: Clock,
): Promise<WorkspaceAccessDenial | null> {
  const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
  if (membershipDenial !== null) return membershipDenial;
  return resolveMutationDenial(tx, workspaceId, clock);
}

type StrategyRow = typeof strategies.$inferSelect;
type StrategyVersionRow = typeof strategyVersions.$inferSelect;
type SetupRow = typeof setups.$inferSelect;

type StrategyLockResult =
  | { readonly ok: true; readonly strategy: StrategyRow }
  | { readonly ok: false; readonly code: 'strategy_not_found' };

/** Lock order step 4. */
async function lockStrategyRow(
  tx: Executor,
  workspaceId: string,
  strategyId: string,
): Promise<StrategyLockResult> {
  const [strategy] = await tx
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), eq(strategies.workspaceId, workspaceId)))
    .for('update');
  if (strategy === undefined) return { ok: false, code: 'strategy_not_found' };
  return { ok: true, strategy };
}

type CurrentVersionLockResult =
  | { readonly ok: true; readonly version: StrategyVersionRow }
  | { readonly ok: false; readonly code: 'strategy_current_version_missing' };

/**
 * Lock order step 5. A persisted Strategy with `current_version_id === null`
 * is malformed (only legitimate transiently, inside `createStrategy`'s own
 * transaction, before it commits) — rejected safely here, never thrown as an
 * unexpected error.
 */
async function lockCurrentVersionRow(
  tx: Executor,
  strategy: StrategyRow,
): Promise<CurrentVersionLockResult> {
  if (strategy.currentVersionId === null) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }
  const [version] = await tx
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, strategy.currentVersionId))
    .for('update');
  if (version === undefined) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }
  return { ok: true, version };
}

type SetupLockResult =
  | { readonly ok: true; readonly setup: SetupRow }
  | { readonly ok: false; readonly code: 'setup_not_found' };

/** Lock order step 6. */
async function lockSetupRow(
  tx: Executor,
  workspaceId: string,
  strategyId: string,
  setupId: string,
): Promise<SetupLockResult> {
  const [setup] = await tx
    .select()
    .from(setups)
    .where(
      and(
        eq(setups.id, setupId),
        eq(setups.workspaceId, workspaceId),
        eq(setups.strategyId, strategyId),
      ),
    )
    .for('update');
  if (setup === undefined) return { ok: false, code: 'setup_not_found' };
  return { ok: true, setup };
}

type StrategyVersionWriteContext =
  | { readonly ok: true; readonly strategy: StrategyRow; readonly version: StrategyVersionRow }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing';
    };

/** Composes lock order steps 1–5 — the common case for every mutation that may read or copy-on-write version content. */
async function acquireStrategyVersionWriteContext(
  tx: Executor,
  params: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly strategyId: string;
    readonly clock: Clock;
  },
): Promise<StrategyVersionWriteContext> {
  const { workspaceId, userId, strategyId, clock } = params;
  const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
  if (denial !== null) return { ok: false, code: denial };

  const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
  if (!strategyLock.ok) return strategyLock;
  if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

  const versionLock = await lockCurrentVersionRow(tx, strategyLock.strategy);
  if (!versionLock.ok) return versionLock;

  return { ok: true, strategy: strategyLock.strategy, version: versionLock.version };
}

// ---------------------------------------------------------------------------
// 1. createStrategy
// ---------------------------------------------------------------------------

export interface CreateStrategyInput {
  readonly mutationKey: string;
  readonly name: string;
  readonly description?: string | null;
  readonly notes?: string | null;
}

export type CreateStrategyResult =
  | {
      readonly ok: true;
      readonly strategyId: string;
      readonly versionId: string;
      readonly alreadyCreated: boolean;
    }
  | {
      readonly ok: false;
      readonly code: WorkspaceAccessDenial | 'blank_name' | 'strategy_current_version_missing';
    };

/**
 * Atomically creates a Strategy identity and its Version 1, then points
 * `current_version_id` at it — no committed row is ever observable with a
 * null `current_version_id`, since the update happens before this
 * transaction commits. Workspace-scoped idempotency mirrors
 * `createTradingAccount`'s `INSERT ... ON CONFLICT DO NOTHING` +
 * defensive-re-read pattern on `(workspace_id, mutation_key)`; the workspace
 * row lock (step 1) already serializes concurrent calls for the same
 * workspace, so the conflict branch is a defence-in-depth path, not the
 * primary guarantee.
 *
 * Membership (steps 1–2) is always checked before the idempotency lookup —
 * a removed member can never retrieve or mutate data merely by replaying an
 * old `mutationKey`. Entitlement (step 3) is checked only AFTER the
 * idempotency lookup misses: a genuinely new `mutationKey` still requires
 * `writable` access, but replaying the SAME key that already succeeded
 * performs no new write, so it stays safely replayable even if the
 * workspace has since become `read_only`/`over_limit` — the same reasoning
 * `createTradingAccount` applies to its own account-limit consumption,
 * generalized here since this domain has no limited resource to guard, only
 * the ordinary "is this workspace writable at all" gate.
 */
export async function createStrategy(
  workspaceId: string,
  userId: string,
  input: CreateStrategyInput,
  clock: Clock = systemClock,
): Promise<CreateStrategyResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
    if (membershipDenial !== null) return { ok: false, code: membershipDenial };

    const existing = await tx.query.strategies.findFirst({
      where: and(
        eq(strategies.workspaceId, workspaceId),
        eq(strategies.mutationKey, input.mutationKey),
      ),
    });
    if (existing !== undefined) {
      if (existing.currentVersionId === null) {
        return { ok: false, code: 'strategy_current_version_missing' };
      }
      return {
        ok: true,
        strategyId: existing.id,
        versionId: existing.currentVersionId,
        alreadyCreated: true,
      };
    }

    const denial = await resolveMutationDenial(tx, workspaceId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const name = normalizeRequiredText(input.name);
    if (!name.ok) return { ok: false, code: 'blank_name' };
    const description = normalizeOptionalText(input.description);
    const notes = normalizeOptionalText(input.notes);

    const inserted = await tx
      .insert(strategies)
      .values({ workspaceId, mutationKey: input.mutationKey })
      .onConflictDoNothing({ target: [strategies.workspaceId, strategies.mutationKey] })
      .returning({ id: strategies.id });

    const strategyRow = inserted[0];
    if (strategyRow === undefined) {
      // Unreachable given the workspace-row-serialized idempotency check
      // above — kept as a defensive re-read on an impossible conflict,
      // matching createTradingAccount's own posture.
      const raced = await tx.query.strategies.findFirst({
        where: and(
          eq(strategies.workspaceId, workspaceId),
          eq(strategies.mutationKey, input.mutationKey),
        ),
      });
      if (raced === undefined || raced.currentVersionId === null) {
        throw new Error(
          `createStrategy: conflict reported but no valid row found for mutation key in workspace ${workspaceId}`,
        );
      }
      return {
        ok: true,
        strategyId: raced.id,
        versionId: raced.currentVersionId,
        alreadyCreated: true,
      };
    }

    const [version] = await tx
      .insert(strategyVersions)
      .values({
        workspaceId,
        strategyId: strategyRow.id,
        versionNumber: 1,
        name: name.value,
        description,
        notes,
      })
      .returning({ id: strategyVersions.id });
    if (version === undefined) {
      throw new Error(`createStrategy: failed to insert version 1 for strategy ${strategyRow.id}`);
    }

    await tx
      .update(strategies)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(strategies.id, strategyRow.id));

    await insertAuditLog(tx, {
      action: 'strategy.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'strategy',
      entityId: strategyRow.id,
      metadata: { strategyVersionId: version.id, versionNumber: 1 },
    });

    return { ok: true, strategyId: strategyRow.id, versionId: version.id, alreadyCreated: false };
  });
}

// ---------------------------------------------------------------------------
// 2. updateStrategyContent
// ---------------------------------------------------------------------------

export interface UpdateStrategyContentInput {
  readonly name: string;
  readonly description?: string | null;
  readonly notes?: string | null;
  /** Required only when the current Version is locked. */
  readonly changeNote?: string | null;
}

export type UpdateStrategyContentResult =
  | {
      readonly ok: true;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly copied: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'blank_name'
        | 'change_note_required';
    };

export async function updateStrategyContent(
  workspaceId: string,
  userId: string,
  strategyId: string,
  input: UpdateStrategyContentInput,
  clock: Clock = systemClock,
): Promise<UpdateStrategyContentResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireStrategyVersionWriteContext(tx, {
      workspaceId,
      userId,
      strategyId,
      clock,
    });
    if (!ctx.ok) return ctx;
    const { version } = ctx;

    const name = normalizeRequiredText(input.name);
    if (!name.ok) return { ok: false, code: 'blank_name' };
    const description = normalizeOptionalText(input.description);
    const notes = normalizeOptionalText(input.notes);

    const changedFields = [
      ...(version.name !== name.value ? ['name'] : []),
      ...(version.description !== description ? ['description'] : []),
      ...(version.notes !== notes ? ['notes'] : []),
    ];

    if (version.lockedAt === null) {
      await tx
        .update(strategyVersions)
        .set({ name: name.value, description, notes, updatedAt: new Date() })
        .where(eq(strategyVersions.id, version.id));

      if (changedFields.length > 0) {
        await insertAuditLog(tx, {
          action: 'strategy.updated',
          workspaceId,
          actorUserId: userId,
          entityType: 'strategy',
          entityId: strategyId,
          metadata: { strategyVersionId: version.id, changedFields },
        });
      }
      return {
        ok: true,
        versionId: version.id,
        versionNumber: version.versionNumber,
        copied: false,
      };
    }

    const changeNote = normalizeChangeNote(input.changeNote);
    if (!changeNote.ok) return { ok: false, code: 'change_note_required' };

    const copyResult = await copyCurrentVersionInTx(tx, {
      workspaceId,
      strategyId,
      sourceVersion: version,
      changeNote: changeNote.value,
      actorUserId: userId,
    });
    await tx
      .update(strategyVersions)
      .set({ name: name.value, description, notes, updatedAt: new Date() })
      .where(eq(strategyVersions.id, copyResult.newVersionId));

    if (changedFields.length > 0) {
      await insertAuditLog(tx, {
        action: 'strategy.updated',
        workspaceId,
        actorUserId: userId,
        entityType: 'strategy',
        entityId: strategyId,
        metadata: { strategyVersionId: copyResult.newVersionId, changedFields },
      });
    }

    return {
      ok: true,
      versionId: copyResult.newVersionId,
      versionNumber: copyResult.newVersionNumber,
      copied: true,
    };
  });
}

// ---------------------------------------------------------------------------
// 5. archiveStrategy / restoreStrategy
// ---------------------------------------------------------------------------

export type StrategyLifecycleResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: WorkspaceAccessDenial | 'strategy_not_found' };

/** Never touches `setups.is_archived` — archiving a Strategy and archiving its Setups are independent lifecycles. */
export async function archiveStrategy(
  workspaceId: string,
  userId: string,
  strategyId: string,
  clock: Clock = systemClock,
): Promise<StrategyLifecycleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: true };

    await tx
      .update(strategies)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(strategies.id, strategyId));

    await insertAuditLog(tx, {
      action: 'strategy.archived',
      workspaceId,
      actorUserId: userId,
      entityType: 'strategy',
      entityId: strategyId,
    });

    return { ok: true };
  });
}

export async function restoreStrategy(
  workspaceId: string,
  userId: string,
  strategyId: string,
  clock: Clock = systemClock,
): Promise<StrategyLifecycleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (!strategyLock.strategy.isArchived) return { ok: true };

    await tx
      .update(strategies)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(eq(strategies.id, strategyId));

    await insertAuditLog(tx, {
      action: 'strategy.restored',
      workspaceId,
      actorUserId: userId,
      entityType: 'strategy',
      entityId: strategyId,
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 3. createSetup
// ---------------------------------------------------------------------------

export interface CreateSetupInput {
  readonly mutationKey: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sortOrder: number;
  /** Required only when the current Version is locked. */
  readonly changeNote?: string | null;
}

export type CreateSetupResult =
  | {
      readonly ok: true;
      readonly setupId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly alreadyCreated: boolean;
      readonly copied: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'blank_name'
        | 'change_note_required'
        | 'setup_snapshot_missing';
    };

/**
 * Membership (steps 1–2) is always checked before the idempotency lookup —
 * the same reasoning as `createStrategy`. Entitlement (step 3) and the
 * Strategy/Version locks (steps 4–5) are only acquired after the
 * idempotency lookup misses: a replay of an existing `mutationKey` performs
 * no new write, so it stays safely replayable under `read_only`/`over_limit`
 * and reads (never locks) the Strategy's current version purely to report
 * back where the original snapshot landed.
 */
export async function createSetup(
  workspaceId: string,
  userId: string,
  strategyId: string,
  input: CreateSetupInput,
  clock: Clock = systemClock,
): Promise<CreateSetupResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
    if (membershipDenial !== null) return { ok: false, code: membershipDenial };

    const existingSetup = await tx.query.setups.findFirst({
      where: and(eq(setups.workspaceId, workspaceId), eq(setups.mutationKey, input.mutationKey)),
    });
    if (existingSetup !== undefined) {
      const [strategyRow] = await tx
        .select({ currentVersionId: strategies.currentVersionId })
        .from(strategies)
        .where(and(eq(strategies.id, strategyId), eq(strategies.workspaceId, workspaceId)));
      if (strategyRow === undefined) return { ok: false, code: 'strategy_not_found' };
      if (strategyRow.currentVersionId === null) {
        return { ok: false, code: 'strategy_current_version_missing' };
      }
      const [currentVersion] = await tx
        .select({ id: strategyVersions.id, versionNumber: strategyVersions.versionNumber })
        .from(strategyVersions)
        .where(eq(strategyVersions.id, strategyRow.currentVersionId));
      if (currentVersion === undefined) {
        return { ok: false, code: 'strategy_current_version_missing' };
      }

      const [snapshot] = await tx
        .select()
        .from(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, currentVersion.id),
            eq(strategySetupVersions.setupId, existingSetup.id),
          ),
        );
      if (snapshot === undefined) return { ok: false, code: 'setup_snapshot_missing' };
      return {
        ok: true,
        setupId: existingSetup.id,
        versionId: currentVersion.id,
        versionNumber: currentVersion.versionNumber,
        alreadyCreated: true,
        copied: false,
      };
    }

    const denial = await resolveMutationDenial(tx, workspaceId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };
    const versionLock = await lockCurrentVersionRow(tx, strategyLock.strategy);
    if (!versionLock.ok) return versionLock;
    const version = versionLock.version;

    const name = normalizeRequiredText(input.name);
    if (!name.ok) return { ok: false, code: 'blank_name' };
    const description = normalizeOptionalText(input.description);

    const insertedSetups = await tx
      .insert(setups)
      .values({ workspaceId, strategyId, mutationKey: input.mutationKey })
      .onConflictDoNothing({ target: [setups.workspaceId, setups.mutationKey] })
      .returning({ id: setups.id });

    if (insertedSetups[0] === undefined) {
      const raced = await tx.query.setups.findFirst({
        where: and(eq(setups.workspaceId, workspaceId), eq(setups.mutationKey, input.mutationKey)),
      });
      if (raced === undefined) {
        throw new Error(
          `createSetup: conflict reported but no row found for mutation key in workspace ${workspaceId}`,
        );
      }
      const [snapshot] = await tx
        .select()
        .from(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, version.id),
            eq(strategySetupVersions.setupId, raced.id),
          ),
        );
      if (snapshot === undefined) return { ok: false, code: 'setup_snapshot_missing' };
      return {
        ok: true,
        setupId: raced.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        alreadyCreated: true,
        copied: false,
      };
    }
    const setupId = insertedSetups[0].id;

    let targetVersionId = version.id;
    let targetVersionNumber = version.versionNumber;
    let copied = false;

    if (version.lockedAt !== null) {
      const changeNote = normalizeChangeNote(input.changeNote);
      if (!changeNote.ok) return { ok: false, code: 'change_note_required' };
      const copyResult = await copyCurrentVersionInTx(tx, {
        workspaceId,
        strategyId,
        sourceVersion: version,
        changeNote: changeNote.value,
        actorUserId: userId,
      });
      targetVersionId = copyResult.newVersionId;
      targetVersionNumber = copyResult.newVersionNumber;
      copied = true;
    }

    await tx.insert(strategySetupVersions).values({
      workspaceId,
      strategyId,
      strategyVersionId: targetVersionId,
      setupId,
      name: name.value,
      description,
      sortOrder: input.sortOrder,
    });

    await insertAuditLog(tx, {
      action: 'setup.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'setup',
      entityId: setupId,
      metadata: { strategyId, strategyVersionId: targetVersionId },
    });

    return {
      ok: true,
      setupId,
      versionId: targetVersionId,
      versionNumber: targetVersionNumber,
      alreadyCreated: false,
      copied,
    };
  });
}

// ---------------------------------------------------------------------------
// 4. updateSetupContent
// ---------------------------------------------------------------------------

export interface UpdateSetupContentInput {
  readonly name: string;
  readonly description?: string | null;
  readonly sortOrder: number;
  readonly changeNote?: string | null;
}

export type UpdateSetupContentResult =
  | {
      readonly ok: true;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly copied: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'setup_not_found'
        | 'setup_archived'
        | 'setup_snapshot_missing'
        | 'blank_name'
        | 'change_note_required';
    };

export async function updateSetupContent(
  workspaceId: string,
  userId: string,
  strategyId: string,
  setupId: string,
  input: UpdateSetupContentInput,
  clock: Clock = systemClock,
): Promise<UpdateSetupContentResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireStrategyVersionWriteContext(tx, {
      workspaceId,
      userId,
      strategyId,
      clock,
    });
    if (!ctx.ok) return ctx;
    const { version } = ctx;

    const setupLock = await lockSetupRow(tx, workspaceId, strategyId, setupId);
    if (!setupLock.ok) return setupLock;
    if (setupLock.setup.isArchived) return { ok: false, code: 'setup_archived' };

    const name = normalizeRequiredText(input.name);
    if (!name.ok) return { ok: false, code: 'blank_name' };
    const description = normalizeOptionalText(input.description);

    const [currentSnapshot] = await tx
      .select()
      .from(strategySetupVersions)
      .where(
        and(
          eq(strategySetupVersions.strategyVersionId, version.id),
          eq(strategySetupVersions.setupId, setupId),
        ),
      );
    if (currentSnapshot === undefined) return { ok: false, code: 'setup_snapshot_missing' };

    if (version.lockedAt === null) {
      await tx
        .update(strategySetupVersions)
        .set({ name: name.value, description, sortOrder: input.sortOrder, updatedAt: new Date() })
        .where(eq(strategySetupVersions.id, currentSnapshot.id));

      await insertAuditLog(tx, {
        action: 'setup.updated',
        workspaceId,
        actorUserId: userId,
        entityType: 'setup',
        entityId: setupId,
        metadata: { strategyId, strategyVersionId: version.id, setupVersionId: currentSnapshot.id },
      });
      return {
        ok: true,
        versionId: version.id,
        versionNumber: version.versionNumber,
        copied: false,
      };
    }

    const changeNote = normalizeChangeNote(input.changeNote);
    if (!changeNote.ok) return { ok: false, code: 'change_note_required' };

    const copyResult = await copyCurrentVersionInTx(tx, {
      workspaceId,
      strategyId,
      sourceVersion: version,
      changeNote: changeNote.value,
      actorUserId: userId,
    });

    const [copiedSnapshot] = await tx
      .select()
      .from(strategySetupVersions)
      .where(
        and(
          eq(strategySetupVersions.strategyVersionId, copyResult.newVersionId),
          eq(strategySetupVersions.setupId, setupId),
        ),
      );
    if (copiedSnapshot === undefined) {
      throw new Error('updateSetupContent: copied version is missing the expected setup snapshot');
    }

    await tx
      .update(strategySetupVersions)
      .set({ name: name.value, description, sortOrder: input.sortOrder, updatedAt: new Date() })
      .where(eq(strategySetupVersions.id, copiedSnapshot.id));

    await insertAuditLog(tx, {
      action: 'setup.updated',
      workspaceId,
      actorUserId: userId,
      entityType: 'setup',
      entityId: setupId,
      metadata: {
        strategyId,
        strategyVersionId: copyResult.newVersionId,
        setupVersionId: copiedSnapshot.id,
      },
    });

    return {
      ok: true,
      versionId: copyResult.newVersionId,
      versionNumber: copyResult.newVersionNumber,
      copied: true,
    };
  });
}

// ---------------------------------------------------------------------------
// 6. archiveSetup / restoreSetup
// ---------------------------------------------------------------------------

export type SetupLifecycleResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        WorkspaceAccessDenial | 'strategy_not_found' | 'strategy_archived' | 'setup_not_found';
    };

/** The parent Strategy must be restored first — a Setup's own lifecycle never overrides its Strategy's. */
export async function archiveSetup(
  workspaceId: string,
  userId: string,
  strategyId: string,
  setupId: string,
  clock: Clock = systemClock,
): Promise<SetupLifecycleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

    const setupLock = await lockSetupRow(tx, workspaceId, strategyId, setupId);
    if (!setupLock.ok) return setupLock;
    if (setupLock.setup.isArchived) return { ok: true };

    await tx
      .update(setups)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(setups.id, setupId));

    await insertAuditLog(tx, {
      action: 'setup.archived',
      workspaceId,
      actorUserId: userId,
      entityType: 'setup',
      entityId: setupId,
      metadata: { strategyId },
    });

    return { ok: true };
  });
}

export async function restoreSetup(
  workspaceId: string,
  userId: string,
  strategyId: string,
  setupId: string,
  clock: Clock = systemClock,
): Promise<SetupLifecycleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const strategyLock = await lockStrategyRow(tx, workspaceId, strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

    const setupLock = await lockSetupRow(tx, workspaceId, strategyId, setupId);
    if (!setupLock.ok) return setupLock;
    if (!setupLock.setup.isArchived) return { ok: true };

    await tx
      .update(setups)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(eq(setups.id, setupId));

    await insertAuditLog(tx, {
      action: 'setup.restored',
      workspaceId,
      actorUserId: userId,
      entityType: 'setup',
      entityId: setupId,
      metadata: { strategyId },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 7. Rule operations
// ---------------------------------------------------------------------------

export interface CreateStrategyRuleInput {
  readonly ruleKey: string;
  /** Absent/null = Strategy-level. Present = scoped to that Setup's snapshot in the current Version. */
  readonly setupId?: string | null;
  readonly category: string;
  readonly title: string;
  readonly description?: string | null;
  readonly isRequired?: boolean;
  readonly isPreTradeCheck?: boolean;
  readonly sortOrder?: number;
  readonly changeNote?: string | null;
}

export type CreateStrategyRuleResult =
  | {
      readonly ok: true;
      readonly ruleId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly alreadyCreated: boolean;
      readonly copied: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'setup_not_found'
        | 'setup_archived'
        | 'setup_snapshot_missing'
        | 'invalid_rule_category'
        | 'blank_title'
        | 'change_note_required';
    };

export async function createStrategyRule(
  workspaceId: string,
  userId: string,
  strategyId: string,
  input: CreateStrategyRuleInput,
  clock: Clock = systemClock,
): Promise<CreateStrategyRuleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireStrategyVersionWriteContext(tx, {
      workspaceId,
      userId,
      strategyId,
      clock,
    });
    if (!ctx.ok) return ctx;
    const { version } = ctx;

    if (!isStrategyRuleCategory(input.category))
      return { ok: false, code: 'invalid_rule_category' };
    const title = normalizeRequiredText(input.title);
    if (!title.ok) return { ok: false, code: 'blank_title' };
    const description = normalizeOptionalText(input.description);

    let currentSetupVersionId: string | null = null;
    if (input.setupId !== null && input.setupId !== undefined) {
      const setupLock = await lockSetupRow(tx, workspaceId, strategyId, input.setupId);
      if (!setupLock.ok) return setupLock;
      if (setupLock.setup.isArchived) return { ok: false, code: 'setup_archived' };
      const [snapshot] = await tx
        .select()
        .from(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, version.id),
            eq(strategySetupVersions.setupId, input.setupId),
          ),
        );
      if (snapshot === undefined) return { ok: false, code: 'setup_snapshot_missing' };
      currentSetupVersionId = snapshot.id;
    }

    const [existingRule] = await tx
      .select()
      .from(strategyRules)
      .where(
        and(
          eq(strategyRules.strategyVersionId, version.id),
          eq(strategyRules.ruleKey, input.ruleKey),
        ),
      );
    if (existingRule !== undefined) {
      return {
        ok: true,
        ruleId: existingRule.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        alreadyCreated: true,
        copied: false,
      };
    }

    let targetVersionId = version.id;
    let targetVersionNumber = version.versionNumber;
    let targetSetupVersionId = currentSetupVersionId;
    let copied = false;

    if (version.lockedAt !== null) {
      const changeNote = normalizeChangeNote(input.changeNote);
      if (!changeNote.ok) return { ok: false, code: 'change_note_required' };
      const copyResult = await copyCurrentVersionInTx(tx, {
        workspaceId,
        strategyId,
        sourceVersion: version,
        changeNote: changeNote.value,
        actorUserId: userId,
      });
      targetVersionId = copyResult.newVersionId;
      targetVersionNumber = copyResult.newVersionNumber;
      copied = true;

      if (input.setupId !== null && input.setupId !== undefined) {
        const [copiedSnapshot] = await tx
          .select()
          .from(strategySetupVersions)
          .where(
            and(
              eq(strategySetupVersions.strategyVersionId, targetVersionId),
              eq(strategySetupVersions.setupId, input.setupId),
            ),
          );
        if (copiedSnapshot === undefined) {
          throw new Error(
            'createStrategyRule: copy did not carry forward the expected setup snapshot',
          );
        }
        targetSetupVersionId = copiedSnapshot.id;
      }
    }

    const [inserted] = await tx
      .insert(strategyRules)
      .values({
        workspaceId,
        strategyVersionId: targetVersionId,
        setupVersionId: targetSetupVersionId,
        ruleKey: input.ruleKey,
        category: input.category,
        title: title.value,
        description,
        isRequired: input.isRequired ?? true,
        isPreTradeCheck: input.isPreTradeCheck ?? false,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning({ id: strategyRules.id });
    if (inserted === undefined) {
      throw new Error(`createStrategyRule: failed to insert rule for strategy ${strategyId}`);
    }

    await insertAuditLog(tx, {
      action: 'strategy.rule.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'strategy_rule',
      entityId: inserted.id,
      metadata: {
        strategyId,
        strategyVersionId: targetVersionId,
        ruleKey: input.ruleKey,
        ruleCategory: input.category,
        ruleScope: input.setupId !== null && input.setupId !== undefined ? 'setup' : 'strategy',
      },
    });

    return {
      ok: true,
      ruleId: inserted.id,
      versionId: targetVersionId,
      versionNumber: targetVersionNumber,
      alreadyCreated: false,
      copied,
    };
  });
}

export interface UpdateStrategyRuleInput {
  readonly category: string;
  readonly title: string;
  readonly description?: string | null;
  readonly isRequired?: boolean;
  readonly isPreTradeCheck?: boolean;
  readonly sortOrder?: number;
  readonly changeNote?: string | null;
}

export type UpdateStrategyRuleResult =
  | {
      readonly ok: true;
      readonly ruleId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly copied: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'rule_not_found'
        | 'setup_archived'
        | 'invalid_rule_category'
        | 'blank_title'
        | 'change_note_required';
    };

export async function updateStrategyRule(
  workspaceId: string,
  userId: string,
  strategyId: string,
  ruleKey: string,
  input: UpdateStrategyRuleInput,
  clock: Clock = systemClock,
): Promise<UpdateStrategyRuleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireStrategyVersionWriteContext(tx, {
      workspaceId,
      userId,
      strategyId,
      clock,
    });
    if (!ctx.ok) return ctx;
    const { version } = ctx;

    if (!isStrategyRuleCategory(input.category))
      return { ok: false, code: 'invalid_rule_category' };
    const title = normalizeRequiredText(input.title);
    if (!title.ok) return { ok: false, code: 'blank_title' };
    const description = normalizeOptionalText(input.description);

    const [currentRule] = await tx
      .select()
      .from(strategyRules)
      .where(
        and(eq(strategyRules.strategyVersionId, version.id), eq(strategyRules.ruleKey, ruleKey)),
      );
    if (currentRule === undefined) return { ok: false, code: 'rule_not_found' };

    if (currentRule.setupVersionId !== null) {
      const [setupVersionRow] = await tx
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.id, currentRule.setupVersionId));
      if (setupVersionRow !== undefined) {
        const setupLock = await lockSetupRow(tx, workspaceId, strategyId, setupVersionRow.setupId);
        if (setupLock.ok && setupLock.setup.isArchived)
          return { ok: false, code: 'setup_archived' };
      }
    }

    const patch = {
      category: input.category,
      title: title.value,
      description,
      isRequired: input.isRequired ?? currentRule.isRequired,
      isPreTradeCheck: input.isPreTradeCheck ?? currentRule.isPreTradeCheck,
      sortOrder: input.sortOrder ?? currentRule.sortOrder,
      updatedAt: new Date(),
    };

    if (version.lockedAt === null) {
      await tx.update(strategyRules).set(patch).where(eq(strategyRules.id, currentRule.id));
      await insertAuditLog(tx, {
        action: 'strategy.rule.updated',
        workspaceId,
        actorUserId: userId,
        entityType: 'strategy_rule',
        entityId: currentRule.id,
        metadata: {
          strategyId,
          strategyVersionId: version.id,
          ruleKey,
          ruleCategory: input.category,
        },
      });
      return {
        ok: true,
        ruleId: currentRule.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        copied: false,
      };
    }

    const changeNote = normalizeChangeNote(input.changeNote);
    if (!changeNote.ok) return { ok: false, code: 'change_note_required' };

    const copyResult = await copyCurrentVersionInTx(tx, {
      workspaceId,
      strategyId,
      sourceVersion: version,
      changeNote: changeNote.value,
      actorUserId: userId,
    });

    const [copiedRule] = await tx
      .select()
      .from(strategyRules)
      .where(
        and(
          eq(strategyRules.strategyVersionId, copyResult.newVersionId),
          eq(strategyRules.ruleKey, ruleKey),
        ),
      );
    if (copiedRule === undefined) {
      throw new Error('updateStrategyRule: copy did not carry forward the expected rule');
    }

    await tx.update(strategyRules).set(patch).where(eq(strategyRules.id, copiedRule.id));

    await insertAuditLog(tx, {
      action: 'strategy.rule.updated',
      workspaceId,
      actorUserId: userId,
      entityType: 'strategy_rule',
      entityId: copiedRule.id,
      metadata: {
        strategyId,
        strategyVersionId: copyResult.newVersionId,
        ruleKey,
        ruleCategory: input.category,
      },
    });

    return {
      ok: true,
      ruleId: copiedRule.id,
      versionId: copyResult.newVersionId,
      versionNumber: copyResult.newVersionNumber,
      copied: true,
    };
  });
}

export type RemoveStrategyRuleResult =
  | {
      readonly ok: true;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly copied: boolean;
      readonly alreadyRemoved: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'change_note_required';
    };

/**
 * A rule "not present in the current Version" is treated as an idempotent
 * no-op (`alreadyRemoved: true`), the same idempotency posture every other
 * lifecycle operation in this file takes — a retried removal must not fail
 * merely because an earlier attempt already succeeded.
 */
export async function removeStrategyRule(
  workspaceId: string,
  userId: string,
  strategyId: string,
  ruleKey: string,
  input: { readonly changeNote?: string | null } = {},
  clock: Clock = systemClock,
): Promise<RemoveStrategyRuleResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireStrategyVersionWriteContext(tx, {
      workspaceId,
      userId,
      strategyId,
      clock,
    });
    if (!ctx.ok) return ctx;
    const { version } = ctx;

    const [currentRule] = await tx
      .select()
      .from(strategyRules)
      .where(
        and(eq(strategyRules.strategyVersionId, version.id), eq(strategyRules.ruleKey, ruleKey)),
      );
    if (currentRule === undefined) {
      return {
        ok: true,
        versionId: version.id,
        versionNumber: version.versionNumber,
        copied: false,
        alreadyRemoved: true,
      };
    }

    if (version.lockedAt === null) {
      await tx.delete(strategyRules).where(eq(strategyRules.id, currentRule.id));
      await insertAuditLog(tx, {
        action: 'strategy.rule.removed',
        workspaceId,
        actorUserId: userId,
        entityType: 'strategy_rule',
        entityId: currentRule.id,
        metadata: { strategyId, strategyVersionId: version.id, ruleKey },
      });
      return {
        ok: true,
        versionId: version.id,
        versionNumber: version.versionNumber,
        copied: false,
        alreadyRemoved: false,
      };
    }

    const changeNote = normalizeChangeNote(input.changeNote);
    if (!changeNote.ok) return { ok: false, code: 'change_note_required' };

    const copyResult = await copyCurrentVersionInTx(tx, {
      workspaceId,
      strategyId,
      sourceVersion: version,
      changeNote: changeNote.value,
      actorUserId: userId,
    });

    const [copiedRule] = await tx
      .select()
      .from(strategyRules)
      .where(
        and(
          eq(strategyRules.strategyVersionId, copyResult.newVersionId),
          eq(strategyRules.ruleKey, ruleKey),
        ),
      );
    if (copiedRule === undefined) {
      throw new Error('removeStrategyRule: copy did not carry forward the rule to be removed');
    }
    await tx.delete(strategyRules).where(eq(strategyRules.id, copiedRule.id));

    await insertAuditLog(tx, {
      action: 'strategy.rule.removed',
      workspaceId,
      actorUserId: userId,
      entityType: 'strategy_rule',
      entityId: copiedRule.id,
      metadata: { strategyId, strategyVersionId: copyResult.newVersionId, ruleKey },
    });

    return {
      ok: true,
      versionId: copyResult.newVersionId,
      versionNumber: copyResult.newVersionNumber,
      copied: true,
      alreadyRemoved: false,
    };
  });
}
