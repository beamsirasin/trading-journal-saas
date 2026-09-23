import 'server-only';

import { and, eq } from 'drizzle-orm';

import { systemClock, type Clock } from '@/lib/time';
import { isContractRow } from '@/lib/trades/add-trade-contract';
import {
  isPlanOutcome,
  validatePlanOutcomeAnswer,
  type PlanOutcome,
  type PlanOutcomePlan,
} from '@/lib/trades/plan-outcome';
import { getDb } from '@/server/db/client';
import {
  emotionTypes,
  tradeAfterTradeContextSaves,
  tradeEmotions,
  trades,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import type { TradeExecutionTx } from './trade-execution';
import {
  lockTradeRow,
  lockWorkspaceAndVerifyMembership,
  resolveEmotionTypesInTx,
  resolveMutationDenial,
  type WorkspaceAccessDenial,
} from './trade-management';
import { tradeMutationFingerprint } from './trade-mutation-fingerprint';

/**
 * STAGE 6 — AFTER-TRADE CONTEXT (Add Trade contract §9; UX Rules §20.5).
 *
 * Optional enrichment after the Final Close: an after-trade note, an
 * after-trade chart link, and Post-Trade Emotion. The Trade is already Closed
 * — Stage 6 is never what closes it and never required for Closed.
 *
 * WHAT IT WRITES, AND NOTHING ELSE: the Plan Outcome (`plan_outcome`,
 * `plan_outcome_minor`, `plan_outcome_recorded_at` — decision 55),
 * `after_trade_note`, `after_trade_tradingview_url`, the `post_trade`
 * `trade_emotions` rows and `post_trade_emotions_recorded_at`. It never touches status, Final Net P&L,
 * its source, Actual R, the Trader Outcome, the entry notes, the before-entry
 * chart link, or any Review / System Assessment column — the Plan Outcome is
 * capture evidence, never `trade_system_assessments`.
 *
 * WHICH TRADES. A Closed contract Trade — including one closed through the
 * legacy close before it was retired. That row's result keeps its legacy
 * provenance: canonical analytics decide on `final_pnl_source`, which this
 * never writes, so enriching it promotes nothing. A legacy Trade
 * (`recording_contract IS NULL`) is refused.
 *
 * PATCH. For each field: absent = unchanged, `null` = cleared to Unanswered,
 * a value = set. Post-Trade Emotion `[]` is an explicit None.
 *
 * IDEMPOTENCY. Its own Save key (never the Final Close's) and request
 * fingerprint, in `trade_after_trade_context_saves`. Workspace lock →
 * membership → replay lookup → write entitlement → Trade lock: an exact replay
 * returns the Trade's current After-Trade Context and writes nothing, so it
 * needs membership but not write entitlement; the same key with different
 * content is a replay conflict; every new Save needs write entitlement. The
 * workspace lock serializes concurrent Saves, and emotions are replaced as a
 * set, so a retried request never duplicates an emotion or an audit event.
 */

type Tx = TradeExecutionTx;

export interface RecordAfterTradeContextInput {
  readonly mutationKey: string;
  readonly afterTradeNote?: string | null;
  readonly afterTradeTradingviewUrl?: string | null;
  readonly postTradeEmotionKeys?: readonly string[] | null;
  /**
   * What the original plan would have produced: absent = unchanged, `null` =
   * back to Unanswered. Checked against the Trade's recorded plan.
   */
  readonly planOutcome?: {
    readonly outcome: PlanOutcome;
    readonly amountMinor: bigint | null;
  } | null;
}

export type PostTradeEmotionState =
  | { readonly answer: 'unanswered' }
  | { readonly answer: 'none' }
  | { readonly answer: 'selected'; readonly keys: readonly string[] };

export interface AfterTradeContextView {
  readonly afterTradeNote: string | null;
  readonly afterTradeTradingviewUrl: string | null;
  readonly postTradeEmotions: PostTradeEmotionState;
  readonly planOutcome: PlanOutcome | null;
  readonly planOutcomeMinor: bigint | null;
}

export type RecordAfterTradeContextErrorCode =
  | WorkspaceAccessDenial
  | 'trade_not_found'
  | 'legacy_trade_not_supported'
  | 'invalid_status_transition'
  | 'duplicate_emotion_key'
  | 'unknown_emotion_key'
  | 'emotion_type_not_usable'
  | 'invalid_plan_outcome'
  | 'mutation_replay_conflict';

export type RecordAfterTradeContextResult =
  | ({
      readonly ok: true;
      readonly tradeId: string;
      /** This exact Save was already recorded; nothing new was written. */
      readonly alreadyRecorded: boolean;
    } & AfterTradeContextView)
  | {
      readonly ok: false;
      readonly code: RecordAfterTradeContextErrorCode;
      readonly replayConflict?: 'different';
    };

/**
 * What the Save said, for its fingerprint. The Trade is part of it, and
 * emotion keys are a set, so their order never makes one Save look like two.
 */
function fingerprintOf(tradeId: string, input: RecordAfterTradeContextInput): string {
  const { mutationKey: _key, postTradeEmotionKeys, ...rest } = input;
  return tradeMutationFingerprint('after_trade_context', {
    tradeId,
    ...rest,
    ...(postTradeEmotionKeys === undefined
      ? {}
      : {
          postTradeEmotionKeys:
            postTradeEmotionKeys === null ? null : [...postTradeEmotionKeys].sort(),
        }),
  });
}

async function readContext(
  tx: Tx,
  trade: typeof trades.$inferSelect,
): Promise<AfterTradeContextView> {
  let postTradeEmotions: PostTradeEmotionState = { answer: 'unanswered' };
  if (trade.postTradeEmotionsRecordedAt !== null) {
    const rows = await tx
      .select({ key: emotionTypes.key })
      .from(tradeEmotions)
      .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
      .where(and(eq(tradeEmotions.tradeId, trade.id), eq(tradeEmotions.phase, 'post_trade')));
    postTradeEmotions =
      rows.length === 0
        ? { answer: 'none' }
        : { answer: 'selected', keys: rows.map((row) => row.key).sort() };
  }
  return {
    afterTradeNote: trade.afterTradeNote,
    afterTradeTradingviewUrl: trade.afterTradeTradingviewUrl,
    postTradeEmotions,
    planOutcome: isPlanOutcome(trade.planOutcome) ? trade.planOutcome : null,
    planOutcomeMinor: trade.planOutcomeMinor,
  };
}

/** The Trade's recorded plan, as the Plan Outcome rule reads it. */
export function planOutcomePlanOfTrade(trade: typeof trades.$inferSelect): PlanOutcomePlan {
  return {
    plannedRiskMinor: trade.plannedRiskMinor,
    plannedRiskState:
      trade.plannedRiskState === 'defined' || trade.plannedRiskState === 'no_defined'
        ? trade.plannedRiskState
        : null,
    targetState:
      trade.targetState === 'fixed' || trade.targetState === 'no_fixed' ? trade.targetState : null,
    plannedRewardMinor: trade.plannedRewardMinor,
    exitPlanState:
      trade.exitPlanState === 'saved' ||
      trade.exitPlanState === 'customized' ||
      trade.exitPlanState === 'no_rule'
        ? trade.exitPlanState
        : null,
  };
}

export async function recordAfterTradeContextInTx(
  tx: Tx,
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: RecordAfterTradeContextInput,
  clock: Clock,
): Promise<RecordAfterTradeContextResult> {
  const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
  if (membershipDenial !== null) return { ok: false, code: membershipDenial };
  const fingerprint = fingerprintOf(tradeId, input);

  // A Save key already used: the same Save answers with what is recorded now.
  // Checked BEFORE write entitlement, because answering it writes nothing.
  const [replay] = await tx
    .select()
    .from(tradeAfterTradeContextSaves)
    .where(
      and(
        eq(tradeAfterTradeContextSaves.workspaceId, workspaceId),
        eq(tradeAfterTradeContextSaves.mutationKey, input.mutationKey),
      ),
    )
    .limit(1);
  if (replay !== undefined) {
    if (replay.tradeId !== tradeId || replay.mutationFingerprint !== fingerprint) {
      return { ok: false, code: 'mutation_replay_conflict', replayConflict: 'different' };
    }
    const recorded = await lockTradeRow(tx, workspaceId, tradeId);
    if (!recorded.ok) return recorded;
    return {
      ok: true,
      tradeId,
      alreadyRecorded: true,
      ...(await readContext(tx, recorded.trade)),
    };
  }

  const denial = await resolveMutationDenial(tx, workspaceId, clock);
  if (denial !== null) return { ok: false, code: denial };
  const locked = await lockTradeRow(tx, workspaceId, tradeId);
  if (!locked.ok) return locked;
  const { trade } = locked;
  if (!isContractRow(trade)) return { ok: false, code: 'legacy_trade_not_supported' };
  // After-Trade Context follows the Final Close; it never closes a Trade.
  if (trade.status !== 'closed') return { ok: false, code: 'invalid_status_transition' };

  // Only an answer the recorded plan offers, with an amount exactly where needed.
  if (
    input.planOutcome != null &&
    validatePlanOutcomeAnswer(
      input.planOutcome.outcome,
      input.planOutcome.amountMinor,
      planOutcomePlanOfTrade(trade),
    ) !== null
  ) {
    return { ok: false, code: 'invalid_plan_outcome' };
  }

  let emotionIds: readonly { readonly id: string }[] | null = null;
  if (input.postTradeEmotionKeys !== undefined && input.postTradeEmotionKeys !== null) {
    const resolved = await resolveEmotionTypesInTx(tx, input.postTradeEmotionKeys);
    if (!resolved.ok) return { ok: false, code: resolved.code };
    emotionIds = resolved.value;
  }

  const now = clock.now();
  const changedFields: string[] = [];
  const patch: Partial<typeof trades.$inferInsert> = { updatedAt: now };
  if (input.planOutcome !== undefined) {
    patch.planOutcome = input.planOutcome?.outcome ?? null;
    patch.planOutcomeMinor = input.planOutcome?.amountMinor ?? null;
    patch.planOutcomeRecordedAt = input.planOutcome === null ? null : now;
    changedFields.push('planOutcome');
  }
  if (input.afterTradeNote !== undefined) {
    patch.afterTradeNote = input.afterTradeNote;
    changedFields.push('afterTradeNote');
  }
  if (input.afterTradeTradingviewUrl !== undefined) {
    patch.afterTradeTradingviewUrl = input.afterTradeTradingviewUrl;
    changedFields.push('afterTradeTradingviewUrl');
  }
  if (input.postTradeEmotionKeys !== undefined) {
    // Replaced as a set: the post-trade rows only, never Entry Emotion.
    await tx
      .delete(tradeEmotions)
      .where(and(eq(tradeEmotions.tradeId, tradeId), eq(tradeEmotions.phase, 'post_trade')));
    if (emotionIds !== null && emotionIds.length > 0) {
      await tx.insert(tradeEmotions).values(
        emotionIds.map((emotion) => ({
          workspaceId,
          tradeId,
          emotionTypeId: emotion.id,
          phase: 'post_trade' as const,
        })),
      );
    }
    patch.postTradeEmotionsRecordedAt = input.postTradeEmotionKeys === null ? null : now;
    changedFields.push('postTradeEmotions');
  }

  const [updated] = await tx
    .update(trades)
    .set(patch)
    .where(and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId)))
    .returning();
  if (updated === undefined) throw new Error('recordAfterTradeContext: update returned no row');

  await tx.insert(tradeAfterTradeContextSaves).values({
    workspaceId,
    tradeId,
    mutationKey: input.mutationKey,
    mutationFingerprint: fingerprint,
    createdAt: now,
  });
  await insertAuditLog(tx, {
    action: 'trade.after_trade_context_recorded',
    workspaceId,
    actorUserId: userId,
    entityType: 'trade',
    entityId: tradeId,
    metadata: { tradeId, changedFields },
  });
  return { ok: true, tradeId, alreadyRecorded: false, ...(await readContext(tx, updated)) };
}

export async function recordAfterTradeContext(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: RecordAfterTradeContextInput,
  clock: Clock = systemClock,
): Promise<RecordAfterTradeContextResult> {
  return getDb().transaction((tx) =>
    recordAfterTradeContextInTx(tx, workspaceId, userId, tradeId, input, clock),
  );
}
