import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { systemClock, type Clock } from '@/lib/time';
import type { Database } from '@/server/db/client';
import {
  setupConditions,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';

/**
 * Centralized copy-on-write and version-locking primitives — the one place
 * that duplicates a Strategy Version's full content. Every mutation service
 * in `strategy-management.ts` that needs copy-on-write calls
 * `copyCurrentVersionInTx` first, then applies its own specific insert/
 * update/delete against the freshly-copied rows as an ordinary follow-up
 * query. The copy step's only job is a complete, faithful duplication; nEVER
 * partial, never selective — that is what keeps it centralized, simple, and
 * independently testable, instead of growing a different copy variant per
 * caller.
 *
 * TypeScript `readonly`/`Promise` sequencing is not database atomicity —
 * every export here MUST run inside a transaction the caller already
 * started (a `Pick<Database, ...>` "tx" parameter, never `getDb()` itself),
 * and the caller is responsible for the lock order documented in
 * `strategy-management.ts`'s module comment before calling in.
 */

/** Structurally matches both a Drizzle transaction handle and the plain database. */
type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

export interface CopyCurrentVersionResult {
  readonly newVersionId: string;
  readonly newVersionNumber: number;
}

/**
 * Copies `sourceVersion`'s content (name/description/notes), every
 * `strategy_setup_versions` snapshot it owns (including snapshots for
 * currently-archived Setups — archive state never affects historical
 * content), every version-owned `setup_conditions` row (stable
 * `condition_key`, new row ID, remapped `setup_version_id`), and every
 * `strategy_rules` row it owns (Strategy-level and
 * Setup-level, `rule_key` preserved, `setup_version_id` remapped to the new
 * copy of the Setup Version it referenced) into a brand-new, unlocked
 * `strategy_versions` row, then atomically repoints
 * `strategies.current_version_id` at it.
 *
 * The caller must already hold `FOR UPDATE` locks on the `strategies` row
 * and `sourceVersion`'s row (lock order steps 4–5) before calling — this
 * function does not re-acquire them, since by this point in the call chain
 * they are already held for the duration of the enclosing transaction.
 *
 * Callers needing to change one piece of content (a Setup's name, one
 * Rule's fields, adding/removing a Setup or Rule) call this first, then
 * perform their own specific mutation against the new version's rows —
 * looked up via the unique `(strategy_version_id, setup_id)` /
 * `(strategy_version_id, rule_key)` indexes Phase 06B's migration already
 * provides, not via any map this function returns. This keeps the copy
 * primitive itself free of per-caller special cases.
 */
export async function copyCurrentVersionInTx(
  tx: Executor,
  params: {
    readonly workspaceId: string;
    readonly strategyId: string;
    readonly sourceVersion: {
      readonly id: string;
      readonly versionNumber: number;
      readonly name: string;
      readonly description: string | null;
      readonly notes: string | null;
    };
    readonly changeNote: string;
    readonly actorUserId: string;
  },
): Promise<CopyCurrentVersionResult> {
  const { workspaceId, strategyId, sourceVersion, changeNote, actorUserId } = params;
  const newVersionNumber = sourceVersion.versionNumber + 1;

  const [newVersion] = await tx
    .insert(strategyVersions)
    .values({
      workspaceId,
      strategyId,
      versionNumber: newVersionNumber,
      name: sourceVersion.name,
      description: sourceVersion.description,
      notes: sourceVersion.notes,
      changeNote,
      lockedAt: null,
    })
    .returning({ id: strategyVersions.id });
  if (newVersion === undefined) {
    throw new Error(
      `copyCurrentVersionInTx: failed to insert new version for strategy ${strategyId}`,
    );
  }

  const oldSetupVersions = await tx
    .select()
    .from(strategySetupVersions)
    .where(eq(strategySetupVersions.strategyVersionId, sourceVersion.id));

  const setupVersionIdMap = new Map<string, string>();
  if (oldSetupVersions.length > 0) {
    const insertedSetupVersions = await tx
      .insert(strategySetupVersions)
      .values(
        oldSetupVersions.map((sv) => ({
          workspaceId,
          strategyId,
          strategyVersionId: newVersion.id,
          setupId: sv.setupId,
          name: sv.name,
          description: sv.description,
          sortOrder: sv.sortOrder,
        })),
      )
      .returning({ id: strategySetupVersions.id });
    if (insertedSetupVersions.length !== oldSetupVersions.length) {
      throw new Error(
        `copyCurrentVersionInTx: expected ${oldSetupVersions.length} copied setup versions, got ${insertedSetupVersions.length}`,
      );
    }
    for (const [index, old] of oldSetupVersions.entries()) {
      const inserted = insertedSetupVersions[index];
      if (inserted === undefined) {
        throw new Error('copyCurrentVersionInTx: setup version copy index out of range');
      }
      setupVersionIdMap.set(old.id, inserted.id);
    }

    const oldConditions = await tx
      .select()
      .from(setupConditions)
      .where(
        inArray(
          setupConditions.setupVersionId,
          oldSetupVersions.map((setupVersion) => setupVersion.id),
        ),
      );

    if (oldConditions.length > 0) {
      await tx.insert(setupConditions).values(
        oldConditions.map((condition) => {
          const newSetupVersionId = setupVersionIdMap.get(condition.setupVersionId);
          if (newSetupVersionId === undefined) {
            throw new Error(
              `copyCurrentVersionInTx: condition ${condition.id} references setup_version_id ${condition.setupVersionId} with no corresponding copy`,
            );
          }
          return {
            workspaceId,
            setupId: condition.setupId,
            setupVersionId: newSetupVersionId,
            conditionKey: condition.conditionKey,
            label: condition.label,
            sortOrder: condition.sortOrder,
          };
        }),
      );
    }
  }

  const oldRules = await tx
    .select()
    .from(strategyRules)
    .where(eq(strategyRules.strategyVersionId, sourceVersion.id));

  if (oldRules.length > 0) {
    const newRuleRows = oldRules.map((rule) => {
      let newSetupVersionId: string | null = null;
      if (rule.setupVersionId !== null) {
        const mapped = setupVersionIdMap.get(rule.setupVersionId);
        if (mapped === undefined) {
          throw new Error(
            `copyCurrentVersionInTx: rule ${rule.id} references setup_version_id ${rule.setupVersionId} with no corresponding copy — data integrity violation`,
          );
        }
        newSetupVersionId = mapped;
      }
      return {
        workspaceId,
        strategyVersionId: newVersion.id,
        setupVersionId: newSetupVersionId,
        ruleKey: rule.ruleKey,
        category: rule.category,
        title: rule.title,
        description: rule.description,
        isRequired: rule.isRequired,
        isPreTradeCheck: rule.isPreTradeCheck,
        sortOrder: rule.sortOrder,
      };
    });
    await tx.insert(strategyRules).values(newRuleRows);
  }

  await tx
    .update(strategies)
    .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
    .where(eq(strategies.id, strategyId));

  await insertAuditLog(tx, {
    action: 'strategy.version.created',
    workspaceId,
    actorUserId,
    entityType: 'strategy_version',
    entityId: newVersion.id,
    metadata: {
      strategyId,
      versionNumber: newVersionNumber,
      previousStrategyVersionId: sourceVersion.id,
    },
  });

  return { newVersionId: newVersion.id, newVersionNumber };
}

export type LockStrategyVersionResult =
  | {
      readonly ok: true;
      readonly strategyId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly lockedAt: Date;
    }
  | {
      readonly ok: false;
      readonly code: 'strategy_not_found' | 'strategy_current_version_missing';
    };

/**
 * Phase 08's version-locking primitive — assumption A6's actual enforcement
 * point. Intended to run inside the SAME transaction that inserts a Trade's
 * first reference to a Strategy Version, called only after that outer
 * transaction has already, in order: locked the owning workspace row,
 * verified active membership, resolved/authorized the mutation, and locked
 * the `strategies` row `FOR UPDATE` (lock order steps 1–4 in
 * `strategy-management.ts`'s module comment) — this function performs step 5
 * (locking the target `strategy_versions` row) itself, since locking it is
 * this function's one job.
 *
 * Verifies the version belongs to the given workspace and Strategy, AND is
 * that Strategy's current version — a Trade may only newly lock the version
 * it is actually about to reference, never an older, already-superseded one
 * (which would either already be locked, if it was ever current, or must
 * never become locked at all, if it never was).
 *
 * Idempotent: if `locked_at` is already set, returns it unchanged rather
 * than erroring — a retried Trade-creation transaction must not fail merely
 * because an earlier attempt already locked the version. Never unlocks or
 * replaces `locked_at` — this function only ever moves it null -> non-null,
 * matching the database trigger's own one-way rule
 * (`strategy_versions_protect_locked` in `drizzle/0007_strategies_and_setups.sql`),
 * which remains the final authority regardless of what this function does.
 *
 * **Audit ownership contract:** this function, not its caller, is solely
 * responsible for emitting `strategy.version.locked` — exactly once, only on
 * the actual null -> non-null transition it performs itself, in the same
 * transaction as the lock write. A future Phase 08 caller must never emit
 * its own copy of this event; calling this function is the complete,
 * self-contained unit of work for "lock this version and record that it
 * happened." An idempotent repeat call and a rejected (non-current or
 * cross-workspace) call both emit no event — verified directly.
 */
export async function lockStrategyVersionForReferenceInTx(
  tx: Executor,
  params: {
    readonly workspaceId: string;
    readonly strategyId: string;
    readonly versionId: string;
    readonly actorUserId: string;
  },
  clock: Clock = systemClock,
): Promise<LockStrategyVersionResult> {
  const { workspaceId, strategyId, versionId, actorUserId } = params;

  const [strategy] = await tx
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), eq(strategies.workspaceId, workspaceId)));
  if (strategy === undefined) {
    return { ok: false, code: 'strategy_not_found' };
  }
  if (strategy.currentVersionId === null || strategy.currentVersionId !== versionId) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }

  const [version] = await tx
    .select()
    .from(strategyVersions)
    .where(
      and(
        eq(strategyVersions.id, versionId),
        eq(strategyVersions.workspaceId, workspaceId),
        eq(strategyVersions.strategyId, strategyId),
      ),
    )
    .for('update');
  if (version === undefined) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }

  if (version.lockedAt !== null) {
    return {
      ok: true,
      strategyId,
      versionId,
      versionNumber: version.versionNumber,
      lockedAt: version.lockedAt,
    };
  }

  const lockedAt = clock.now();
  await tx
    .update(strategyVersions)
    .set({ lockedAt, updatedAt: lockedAt })
    .where(eq(strategyVersions.id, versionId));

  await insertAuditLog(tx, {
    action: 'strategy.version.locked',
    workspaceId,
    actorUserId,
    entityType: 'strategy_version',
    entityId: versionId,
    metadata: { strategyId, strategyVersionId: versionId, versionNumber: version.versionNumber },
  });

  return { ok: true, strategyId, versionId, versionNumber: version.versionNumber, lockedAt };
}
