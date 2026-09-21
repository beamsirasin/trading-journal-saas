import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { CALC_VERSION } from '@/config/trade-calc';
import { actualR } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { systemClock, type Clock } from '@/lib/time';
import { isContractRow } from '@/lib/trades/add-trade-contract';
import {
  CLOSED_BPS_TOTAL,
  type ExitHistoryCompleteness,
  type OutcomeValue,
} from '@/lib/trades/constants';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb } from '@/server/db/client';
import { tradeEmotions, tradeExits, trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import type { TradeExecutionTx } from './trade-execution';
import {
  acquireTradeWriteContext,
  resolveEmotionTypesInTx,
  type WorkspaceAccessDenial,
} from './trade-management';
import { tradeMutationFingerprint } from './trade-mutation-fingerprint';

/**
 * RECORD EXIT / FINAL CLOSE — the Add Trade contract live exit (contract
 * §10–§12, §23; lifecycle stage 5, Close Existing Open Trade).
 *
 * ONE OPERATION, TWO SCOPES, because the contract makes scope a property of
 * the exit event itself:
 *
 * - PART records one exit leg. The Trade stays `open`; nothing whole-Trade is
 *   written — no Final Net P&L, no Trader Outcome, no final exit time, no
 *   completeness — and nothing about the leg is read as the Trade being done.
 * - ALL REMAINING records the closing leg AND closes the Trade. Choosing that
 *   scope is the explicit confirmation that the remaining position is closed
 *   (§11). Final Net P&L is the authoritative whole-Trade result, exactly as
 *   stated; the Trader Outcome is the trader's own answer, never derived from
 *   P&L sign or R; Actual R = Final Net P&L / Risk at Entry only when both are
 *   known. Missing answers stay missing: no 0R, no inferred outcome.
 *
 * WHAT IT NEVER DOES (the legacy close does all three, which is why this is a
 * separate path and not a wrapper): derive Final Net P&L from the exit legs,
 * derive the Trader Outcome from the result's sign, or take a Money/Price
 * result basis. Exit legs are supporting history; their subtotal becomes the
 * result only through the explicit, re-checked `finalPnlAdoptedFromExits`.
 *
 * ONLY CONTRACT TRADES. A legacy (pre-contract) Trade keeps its legacy
 * lifecycle and evidence; this path refuses it rather than making it look
 * canonical (contract §28).
 *
 * SAFETY. Session-derived workspace and user only. Workspace lock →
 * membership → write entitlement → Trade row lock, in the one order every
 * Trade mutation uses, so concurrent exits on a workspace serialize. Every
 * exit carries a Save key (`mutation_key`, unique per workspace) and the
 * fingerprint of what the request said: a replay with the same content
 * returns the recorded result and writes nothing; different content under a
 * used key is a replay conflict; a key recorded before fingerprints existed is
 * unverifiable, never assumed identical.
 */

type Tx = TradeExecutionTx;
type TradeRow = typeof trades.$inferSelect;
type ExitRow = typeof tradeExits.$inferSelect;

/** One exit leg's own answers — every one optional (contract §10). */
export interface ContractExitLegInput {
  readonly realizedPnlMinor?: bigint | null;
  readonly closedBps?: number | null;
  /** Context only: never a result. */
  readonly exitPrice?: string | null;
  readonly exitedAt?: Date | null;
  readonly exitReason?: string | null;
}

export interface RecordPartExitInput extends ContractExitLegInput {
  readonly mutationKey: string;
  readonly scope: 'part';
}

export interface FinalCloseInput extends ContractExitLegInput {
  readonly mutationKey: string;
  readonly scope: 'all_remaining';
  /** Absent/null = not recorded. Never zero by default. */
  readonly finalPnlMinor?: bigint | null;
  /** The explicit "Use recorded exits as final result" claim; re-checked here. */
  readonly finalPnlAdoptedFromExits?: true;
  /** Absent = Unanswered. */
  readonly traderOutcome?: OutcomeValue;
  /** Absent = Unanswered. */
  readonly exitHistoryCompleteness?: ExitHistoryCompleteness;
  /** The Trade's final exit time; never adopted from a leg on its own. */
  readonly finalExitedAt?: Date | null;
  /** Omitted = Unanswered; `[]` = None of these. */
  readonly postTradeEmotionKeys?: readonly string[];
}

export type RecordContractExitInput = RecordPartExitInput | FinalCloseInput;

export type RecordContractExitErrorCode =
  | WorkspaceAccessDenial
  | 'trade_not_found'
  | 'legacy_trade_not_supported'
  | 'invalid_status_transition'
  | 'invalid_closed_bps'
  | 'invalid_exit_time'
  | 'exit_limit_reached'
  | 'exit_history_not_adoptable'
  | 'invalid_initial_risk'
  | 'duplicate_emotion_key'
  | 'unknown_emotion_key'
  | 'emotion_type_not_usable'
  | 'mutation_replay_conflict';

export type RecordContractExitResult =
  | {
      readonly ok: true;
      readonly tradeId: string;
      readonly exitId: string;
      readonly scope: 'part' | 'all_remaining';
      /** This exact request was already recorded; nothing new was written. */
      readonly alreadyRecorded: boolean;
      readonly status: 'open' | 'closed';
      readonly actualR: string | null;
      readonly traderOutcome: OutcomeValue | null;
    }
  | {
      readonly ok: false;
      readonly code: RecordContractExitErrorCode;
      /** With `mutation_replay_conflict`: whether the stored request could be compared at all. */
      readonly replayConflict?: 'different' | 'unverifiable';
      readonly calcReason?: CalcFailureReason;
    };

/** The most exit legs one live Trade may record — the same bound After Trade uses. */
export const CONTRACT_EXIT_LIMIT = 50;

/**
 * What the request said, for the fingerprint. The Trade is part of it: the
 * same answers for another Trade are a different request.
 */
function fingerprintOf(tradeId: string, input: RecordContractExitInput): string {
  const { mutationKey: _key, ...content } = input;
  return tradeMutationFingerprint(input.scope === 'part' ? 'exit_part' : 'exit_final', {
    tradeId,
    ...content,
  });
}

async function currentExits(tx: Tx, tradeId: string): Promise<ExitRow[]> {
  return tx
    .select()
    .from(tradeExits)
    .where(eq(tradeExits.tradeId, tradeId))
    .orderBy(asc(tradeExits.sequence), asc(tradeExits.id));
}

function successFor(
  trade: TradeRow,
  exit: ExitRow,
  alreadyRecorded: boolean,
): RecordContractExitResult {
  return {
    ok: true,
    tradeId: trade.id,
    exitId: exit.id,
    scope: exit.exitScope === 'all_remaining' ? 'all_remaining' : 'part',
    alreadyRecorded,
    status: trade.status === 'closed' ? 'closed' : 'open',
    actualR: trade.actualR,
    traderOutcome: trade.traderOutcome as OutcomeValue | null,
  };
}

/**
 * Leg-level checks shared by both scopes. Every value is optional, but one
 * that is given must make sense: an exit time inside the Trade (after entry,
 * not in the future), and percentages that never exceed the whole position —
 * a Part can never account for all of it, because only All Remaining closes.
 */
function validateLeg(
  trade: TradeRow,
  exits: readonly ExitRow[],
  input: RecordContractExitInput,
  now: Date,
): RecordContractExitErrorCode | null {
  const time = input.exitedAt ?? null;
  if (time !== null) {
    if (time.getTime() > now.getTime()) return 'invalid_exit_time';
    if (trade.enteredAt !== null && time.getTime() < trade.enteredAt.getTime()) {
      return 'invalid_exit_time';
    }
  }
  const recorded = exits.reduce((sum, exit) => sum + (exit.closedBps ?? 0), 0);
  const bps = input.closedBps ?? null;
  if (bps !== null) {
    if (!Number.isSafeInteger(bps) || bps <= 0 || bps > CLOSED_BPS_TOTAL)
      return 'invalid_closed_bps';
    const total = recorded + bps;
    if (input.scope === 'part' ? total >= CLOSED_BPS_TOTAL : total > CLOSED_BPS_TOTAL) {
      return 'invalid_closed_bps';
    }
  }
  return null;
}

/**
 * The whole-Trade result of a Final Close, exactly as the trader gave it
 * (contract §11–§12). Adoption of the exit subtotal holds only for an
 * explicitly Complete history in which every leg — this closing one included —
 * carries P&L summing to the stated Final Net P&L.
 */
function composeFinalResult(
  trade: TradeRow,
  exitPnl: readonly (bigint | null)[],
  input: FinalCloseInput,
):
  | {
      readonly ok: true;
      readonly netPnlMinor: bigint | null;
      readonly finalPnlSource: 'manual_total' | 'exit_history' | null;
      readonly actualR: string | null;
    }
  | {
      readonly ok: false;
      readonly code: RecordContractExitErrorCode;
      readonly calcReason?: CalcFailureReason;
    } {
  const finalPnlMinor = input.finalPnlMinor ?? null;
  const adopted = input.finalPnlAdoptedFromExits === true;
  if (adopted) {
    const everyPriced = exitPnl.length > 0 && exitPnl.every((pnl) => pnl !== null);
    const subtotal = everyPriced
      ? exitPnl.reduce<bigint>((sum, pnl) => sum + (pnl ?? 0n), 0n)
      : null;
    if (
      finalPnlMinor === null ||
      input.exitHistoryCompleteness !== 'complete' ||
      subtotal === null ||
      subtotal !== finalPnlMinor
    ) {
      return { ok: false, code: 'exit_history_not_adoptable' };
    }
  }
  // Risk at Entry is the one 1R baseline (contract §4); Actual Risk never is.
  let canonicalActualR: string | null = null;
  if (finalPnlMinor !== null && trade.plannedRiskMinor !== null) {
    const computed = actualR(finalPnlMinor, trade.plannedRiskMinor);
    if (!computed.ok)
      return { ok: false, code: 'invalid_initial_risk', calcReason: computed.reason };
    canonicalActualR = computed.value;
  }
  return {
    ok: true,
    netPnlMinor: finalPnlMinor,
    finalPnlSource: finalPnlMinor === null ? null : adopted ? 'exit_history' : 'manual_total',
    actualR: canonicalActualR,
  };
}

export async function recordContractExitInTx(
  tx: Tx,
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: RecordContractExitInput,
  clock: Clock,
): Promise<RecordContractExitResult> {
  const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
  if (!ctx.ok) return ctx;
  const { trade } = ctx;
  const fingerprint = fingerprintOf(tradeId, input);

  // A Save key already used: the same request answers with what it recorded.
  const replay = await tx.query.tradeExits.findFirst({
    where: and(
      eq(tradeExits.workspaceId, workspaceId),
      eq(tradeExits.mutationKey, input.mutationKey),
    ),
  });
  if (replay !== undefined) {
    if (replay.tradeId !== tradeId || replay.mutationFingerprint !== fingerprint) {
      return {
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: replay.mutationFingerprint === null ? 'unverifiable' : 'different',
      };
    }
    return successFor(trade, replay, true);
  }

  if (!isContractRow(trade)) return { ok: false, code: 'legacy_trade_not_supported' };
  // Record Exit and Final Close are for a live position only (contract §10–§11).
  if (trade.status !== 'open') return { ok: false, code: 'invalid_status_transition' };

  const now = clock.now();
  const exits = await currentExits(tx, tradeId);
  if (exits.length >= CONTRACT_EXIT_LIMIT) return { ok: false, code: 'exit_limit_reached' };
  const legError = validateLeg(trade, exits, input, now);
  if (legError !== null) return { ok: false, code: legError };

  let final: Extract<ReturnType<typeof composeFinalResult>, { ok: true }> | null = null;
  let postTradeEmotionIds: readonly { readonly id: string }[] | null = null;
  if (input.scope === 'all_remaining') {
    const finalExitedAt = input.finalExitedAt ?? null;
    if (finalExitedAt !== null) {
      if (finalExitedAt.getTime() > now.getTime()) return { ok: false, code: 'invalid_exit_time' };
      if (trade.enteredAt !== null && finalExitedAt.getTime() < trade.enteredAt.getTime()) {
        return { ok: false, code: 'invalid_exit_time' };
      }
      // No recorded exit leg may fall after the Trade's own final exit.
      const legTimes = [...exits.map((exit) => exit.exitedAt), input.exitedAt ?? null];
      if (legTimes.some((time) => time !== null && time.getTime() > finalExitedAt.getTime())) {
        return { ok: false, code: 'invalid_exit_time' };
      }
    }
    const composed = composeFinalResult(
      trade,
      [...exits.map((exit) => exit.realizedPnlMinor), input.realizedPnlMinor ?? null],
      input,
    );
    if (!composed.ok) return composed;
    final = composed;
    if (input.postTradeEmotionKeys !== undefined) {
      const resolved = await resolveEmotionTypesInTx(tx, input.postTradeEmotionKeys);
      if (!resolved.ok) return { ok: false, code: resolved.code };
      postTradeEmotionIds = resolved.value;
    }
  }

  const sequence = exits.reduce((highest, exit) => Math.max(highest, exit.sequence), 0) + 1;
  const [inserted] = await tx
    .insert(tradeExits)
    .values({
      workspaceId,
      tradeId,
      mutationKey: input.mutationKey,
      mutationFingerprint: fingerprint,
      sequence,
      exitScope: input.scope,
      closedBps: input.closedBps ?? null,
      exitPrice: input.exitPrice ?? null,
      realizedPnlMinor: input.realizedPnlMinor ?? null,
      exitReason: normalizeOptionalText(input.exitReason),
      exitedAt: input.exitedAt ?? null,
      updatedAt: now,
    })
    .returning();
  if (inserted === undefined) throw new Error('recordContractExit: insert returned no row');

  let updated: TradeRow;
  if (input.scope === 'part' || final === null) {
    // A Part changes nothing whole-Trade: the position is still open.
    const [row] = await tx
      .update(trades)
      .set({ updatedAt: now })
      .where(and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId)))
      .returning();
    if (row === undefined) throw new Error('recordContractExit: trade update returned no row');
    updated = row;
  } else {
    const traderOutcome = input.traderOutcome ?? null;
    const [row] = await tx
      .update(trades)
      .set({
        status: 'closed',
        netPnlMinor: final.netPnlMinor,
        finalPnlSource: final.finalPnlSource,
        actualR: final.actualR,
        traderOutcome,
        traderOutcomeSelectedAt: traderOutcome === null ? null : now,
        exitHistoryCompleteness: input.exitHistoryCompleteness ?? null,
        exitedAt: input.finalExitedAt ?? null,
        actualExit: null,
        calcVersion: CALC_VERSION,
        postTradeEmotionsRecordedAt: postTradeEmotionIds === null ? null : now,
        updatedAt: now,
      })
      .where(and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId)))
      .returning();
    if (row === undefined) throw new Error('recordContractExit: trade close returned no row');
    updated = row;
    if (postTradeEmotionIds !== null && postTradeEmotionIds.length > 0) {
      await tx.insert(tradeEmotions).values(
        postTradeEmotionIds.map((emotion) => ({
          workspaceId,
          tradeId,
          emotionTypeId: emotion.id,
          phase: 'post_trade' as const,
        })),
      );
    }
  }

  await insertAuditLog(tx, {
    action: 'trade.exit_added',
    workspaceId,
    actorUserId: userId,
    entityType: 'trade_exit',
    entityId: inserted.id,
    metadata: { tradeId, exitId: inserted.id, sequence },
  });
  if (updated.status === 'closed') {
    await insertAuditLog(tx, {
      action: 'trade.closed',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'open', newStatus: 'closed' },
    });
  }
  return successFor(updated, inserted, false);
}

export async function recordContractExit(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: RecordContractExitInput,
  clock: Clock = systemClock,
): Promise<RecordContractExitResult> {
  return getDb().transaction((tx) =>
    recordContractExitInTx(tx, workspaceId, userId, tradeId, input, clock),
  );
}
