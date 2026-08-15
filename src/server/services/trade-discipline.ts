import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { isCanonicalEmotionKey } from '@/config/emotions';
import { systemClock, type Clock } from '@/lib/time';
import { isRuleCheckStatus } from '@/lib/trades/constants';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb } from '@/server/db/client';
import {
  emotionTypes,
  mistakeTypes,
  tradeEmotions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { acquireTradeWriteContext, type WorkspaceAccessDenial } from './trade-management';

/**
 * Phase 08B — Rule-check and Mistake mutations. Reuses
 * `trade-management.ts`'s `acquireTradeWriteContext` for every mutation
 * here — the one canonical lock/membership/authorization/trade-lookup
 * sequence for this domain, not a second, independently-drifting copy of it
 * (see that module's own comment). Every function still independently
 * verifies workspace membership and entitlement itself through that shared
 * helper; nothing here trusts a future Server Action layer's precheck for
 * correctness.
 *
 * No Discipline Score, mistake-cost ranking, or weighted scoring is computed
 * anywhere in this file — deliberately deferred, no approved formula exists
 * (CLAUDE.md §6, `docs/calculation-spec.md` §5).
 */

// ---------------------------------------------------------------------------
// 1. updateTradeRuleCheck
// ---------------------------------------------------------------------------

export type UpdateTradeRuleCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        WorkspaceAccessDenial | 'trade_not_found' | 'rule_check_not_found' | 'invalid_check_status';
    };

/**
 * Sets one `trade_rule_checks` row's `check_status` among the four values
 * (`followed`/`violated`/`not_applicable`/`not_checked`). Correctable at
 * every Trade lifecycle stage — `planned`, `open`, after `closed`, and after
 * `canceled` — unless the Trade itself is soft-deleted (denied/not-found via
 * `acquireTradeWriteContext`). Required/pre-trade Rules never block this or
 * any other mutation; they remain journal observations only in MVP.
 */
export async function updateTradeRuleCheck(
  workspaceId: string,
  userId: string,
  tradeId: string,
  ruleKey: string,
  checkStatus: string,
  clock: Clock = systemClock,
): Promise<UpdateTradeRuleCheckResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;

    if (!isRuleCheckStatus(checkStatus)) return { ok: false, code: 'invalid_check_status' };

    const [existing] = await tx
      .select()
      .from(tradeRuleChecks)
      .where(and(eq(tradeRuleChecks.tradeId, tradeId), eq(tradeRuleChecks.ruleKey, ruleKey)))
      .for('update');
    if (existing === undefined) return { ok: false, code: 'rule_check_not_found' };

    if (existing.checkStatus === checkStatus) return { ok: true };

    await tx
      .update(tradeRuleChecks)
      .set({ checkStatus, updatedAt: new Date() })
      .where(eq(tradeRuleChecks.id, existing.id));

    await insertAuditLog(tx, {
      action: 'trade.rule_check_updated',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade_rule_check',
      entityId: existing.id,
      metadata: {
        tradeId,
        ruleKey,
        previousStatus: existing.checkStatus,
        newStatus: checkStatus,
      },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 2. attachTradeMistake
// ---------------------------------------------------------------------------

export type AttachTradeMistakeResult =
  | { readonly ok: true; readonly alreadyAttached: boolean }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'mistake_type_not_found'
        | 'mistake_type_not_usable';
    };

/**
 * Attaches a canonical (Phase 08 MVP: system-only, `workspace_id IS NULL`)
 * mistake type to a Trade, snapshotting `severity`/`default_weight` from the
 * `mistake_types` row at attach time into `severity_at_time`/
 * `weight_at_time` — never accepted from the caller. A workspace-scoped
 * custom mistake type (a later phase's feature — not built here) would only
 * be usable from its OWN workspace; cross-workspace use is rejected, mirroring
 * the database's own `trade_mistakes_workspace_scope_check` trigger as a
 * clean service-level error rather than a raw constraint violation.
 * Re-attaching an already-attached mistake type is a safe no-op — the
 * `(trade_id, mistake_type_id)` primary key represents "this mistake is
 * recorded on this Trade," not "reapply this exact note."
 */
export async function attachTradeMistake(
  workspaceId: string,
  userId: string,
  tradeId: string,
  mistakeTypeId: string,
  note: string | null | undefined,
  clock: Clock = systemClock,
): Promise<AttachTradeMistakeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;

    const [mistakeType] = await tx
      .select()
      .from(mistakeTypes)
      .where(eq(mistakeTypes.id, mistakeTypeId));
    if (mistakeType === undefined) return { ok: false, code: 'mistake_type_not_found' };
    if (mistakeType.workspaceId !== null && mistakeType.workspaceId !== workspaceId) {
      return { ok: false, code: 'mistake_type_not_usable' };
    }

    const [existing] = await tx
      .select({ tradeId: tradeMistakes.tradeId })
      .from(tradeMistakes)
      .where(
        and(eq(tradeMistakes.tradeId, tradeId), eq(tradeMistakes.mistakeTypeId, mistakeTypeId)),
      );
    if (existing !== undefined) return { ok: true, alreadyAttached: true };

    const inserted = await tx
      .insert(tradeMistakes)
      .values({
        tradeId,
        mistakeTypeId,
        workspaceId,
        note: normalizeOptionalText(note),
        severityAtTime: mistakeType.severity,
        weightAtTime: mistakeType.defaultWeight,
      })
      .onConflictDoNothing({ target: [tradeMistakes.tradeId, tradeMistakes.mistakeTypeId] })
      .returning({ tradeId: tradeMistakes.tradeId });

    if (inserted.length === 0) {
      // Unreachable given the Trade row lock serializing concurrent attaches
      // to the same Trade — kept as a defensive no-op, matching this
      // codebase's convention elsewhere for an impossible conflict.
      return { ok: true, alreadyAttached: true };
    }

    await insertAuditLog(tx, {
      action: 'trade.mistake_added',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade_mistake',
      entityId: tradeId,
      metadata: { tradeId, mistakeTypeId },
    });

    return { ok: true, alreadyAttached: false };
  });
}

// ---------------------------------------------------------------------------
// 3. removeTradeMistake
// ---------------------------------------------------------------------------

export type RemoveTradeMistakeResult =
  | { readonly ok: true; readonly alreadyRemoved: boolean }
  | { readonly ok: false; readonly code: WorkspaceAccessDenial | 'trade_not_found' };

/** Removing a mistake that is not currently attached is a safe no-op. */
export async function removeTradeMistake(
  workspaceId: string,
  userId: string,
  tradeId: string,
  mistakeTypeId: string,
  clock: Clock = systemClock,
): Promise<RemoveTradeMistakeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;

    const deleted = await tx
      .delete(tradeMistakes)
      .where(
        and(eq(tradeMistakes.tradeId, tradeId), eq(tradeMistakes.mistakeTypeId, mistakeTypeId)),
      )
      .returning({ tradeId: tradeMistakes.tradeId });

    if (deleted.length === 0) return { ok: true, alreadyRemoved: true };

    await insertAuditLog(tx, {
      action: 'trade.mistake_removed',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade_mistake',
      entityId: tradeId,
      metadata: { tradeId, mistakeTypeId },
    });

    return { ok: true, alreadyRemoved: false };
  });
}

// ---------------------------------------------------------------------------
// 4. replaceTradeEmotions
// ---------------------------------------------------------------------------

export type ReplaceTradeEmotionsResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'duplicate_emotion_key'
        | 'unknown_emotion_key'
        | 'emotion_type_not_usable';
    };

/** Replaces the complete selection in one transaction; an empty selection is recorded truthfully. */
export async function replaceTradeEmotions(
  workspaceId: string,
  userId: string,
  tradeId: string,
  emotionKeys: readonly string[],
  clock: Clock = systemClock,
): Promise<ReplaceTradeEmotionsResult> {
  return getDb().transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;

    if (new Set(emotionKeys).size !== emotionKeys.length) {
      return { ok: false, code: 'duplicate_emotion_key' };
    }
    if (!emotionKeys.every(isCanonicalEmotionKey)) {
      return { ok: false, code: 'unknown_emotion_key' };
    }

    const selected =
      emotionKeys.length === 0
        ? []
        : await tx
            .select({ id: emotionTypes.id, workspaceId: emotionTypes.workspaceId })
            .from(emotionTypes)
            .where(
              and(
                inArray(emotionTypes.key, emotionKeys),
                eq(emotionTypes.isSystem, true),
                eq(emotionTypes.isArchived, false),
              ),
            );
    if (
      selected.length !== emotionKeys.length ||
      selected.some((row) => row.workspaceId !== null)
    ) {
      return { ok: false, code: 'emotion_type_not_usable' };
    }

    await tx.delete(tradeEmotions).where(eq(tradeEmotions.tradeId, tradeId));
    if (selected.length > 0) {
      await tx
        .insert(tradeEmotions)
        .values(selected.map((emotion) => ({ tradeId, emotionTypeId: emotion.id, workspaceId })));
    }
    const recordedAt = clock.now();
    await tx
      .update(trades)
      .set({ emotionsRecordedAt: recordedAt, updatedAt: recordedAt })
      .where(eq(trades.id, tradeId));
    await insertAuditLog(tx, {
      action: 'trade.emotions_corrected',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, changedFields: ['emotionKeys'] },
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 5. updateTradeReviewNotes
// ---------------------------------------------------------------------------

export type UpdateTradeReviewNotesResult =
  | { readonly ok: true; readonly reviewNotes: string | null }
  | { readonly ok: false; readonly code: WorkspaceAccessDenial | 'trade_not_found' };

export async function updateTradeReviewNotes(
  workspaceId: string,
  userId: string,
  tradeId: string,
  reviewNotes: string | null,
  clock: Clock = systemClock,
): Promise<UpdateTradeReviewNotesResult> {
  return getDb().transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const normalized = normalizeOptionalText(reviewNotes);
    const updatedAt = clock.now();
    await tx
      .update(trades)
      .set({ reviewNotes: normalized, updatedAt })
      .where(eq(trades.id, tradeId));
    await insertAuditLog(tx, {
      action: 'trade.corrected',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, changedFields: ['reviewNotes'] },
    });
    return { ok: true, reviewNotes: normalized };
  });
}
