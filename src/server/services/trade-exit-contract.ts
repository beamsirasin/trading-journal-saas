import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { CALC_VERSION } from '@/config/trade-calc';
import { actualR } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { systemClock, type Clock } from '@/lib/time';
import { isContractRow, laterCaptureOrigin } from '@/lib/trades/add-trade-contract';
import {
  CLOSED_BPS_TOTAL,
  type ExitHistoryCompleteness,
  type OutcomeValue,
} from '@/lib/trades/constants';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb } from '@/server/db/client';
import { tradeExits, trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import type { TradeExecutionTx } from './trade-execution';
import {
  lockTradeRow,
  lockWorkspaceAndVerifyMembership,
  resolveContractExitPlanInTx,
  resolveMutationDenial,
  type CreateTradeExitPlanChoice,
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
 * NOT HERE: Post-Trade Emotion. It is After-Trade Context (lifecycle stage 6),
 * captured once the Trade is Closed, never part of the close itself.
 *
 * SAFETY. Session-derived workspace and user only. Workspace lock →
 * membership → Save-key replay lookup → write entitlement → Trade row lock —
 * the order `createTrade` uses — so concurrent exits on a workspace
 * serialize. Every exit carries a Save key (`mutation_key`, unique per
 * workspace) and the fingerprint of what the request said: a replay with the
 * same content returns the recorded result and writes nothing, so it needs a
 * valid membership but not current write entitlement (a read-only workspace
 * can still learn that its earlier Save succeeded); different content under a
 * used key is a replay conflict; a key recorded before fingerprints existed is
 * unverifiable, never assumed identical. Every new write still needs write
 * entitlement.
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
  /**
   * The Trade's final exit time. Optional: absent stays unknown — the server
   * never fills in "now" or the last leg's time; offering either is an
   * explicit UI choice.
   */
  readonly finalExitedAt?: Date | null;
  /**
   * Required plan answers the Trade does not hold yet, given at the close
   * (decision 59). Each may only FILL an Unanswered item — never overwrite an
   * answer the Trade already has — and is written in the same transaction.
   */
  readonly plan?: FinalClosePlanAnswers;
}

/** The Step 2 Required answers a Final Close may complete. */
export interface FinalClosePlanAnswers {
  readonly plannedRiskState?: 'defined' | 'no_defined';
  /** Only with Defined Risk; the 1R. */
  readonly plannedRiskMinor?: bigint | null;
  readonly targetState?: 'fixed' | 'no_fixed';
  /** Only with a Fixed Target: Target Profit and/or a TP price (context). */
  readonly plannedRewardMinor?: bigint | null;
  readonly targetPrice?: string | null;
  readonly exitPlan?: CreateTradeExitPlanChoice;
}

/** A Required item a Final Close is missing (decision 59). */
export type FinalCloseMissing = 'risk' | 'target' | 'exitPlan' | 'outcome' | 'traderResult';

export type RecordContractExitInput = RecordPartExitInput | FinalCloseInput;

export type RecordContractExitErrorCode =
  | WorkspaceAccessDenial
  | 'trade_not_found'
  | 'legacy_trade_not_supported'
  | 'invalid_status_transition'
  | 'invalid_closed_bps'
  | 'exit_time_before_entry'
  | 'exit_time_in_future'
  | 'final_exit_before_recorded_exit'
  | 'exit_limit_reached'
  | 'exit_history_not_adoptable'
  | 'invalid_initial_risk'
  | 'final_close_incomplete'
  | 'final_close_plan_already_answered'
  | 'invalid_plan'
  | 'invalid_exit_plan'
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
      /** With `final_close_incomplete`: the Required items still unanswered. */
      readonly missing?: readonly FinalCloseMissing[];
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

/** A stated exit time must fall inside the Trade: not before entry, not in the future. */
function exitTimeError(
  trade: TradeRow,
  time: Date | null,
  now: Date,
): 'exit_time_before_entry' | 'exit_time_in_future' | null {
  if (time === null) return null;
  if (time.getTime() > now.getTime()) return 'exit_time_in_future';
  if (trade.enteredAt !== null && time.getTime() < trade.enteredAt.getTime()) {
    return 'exit_time_before_entry';
  }
  return null;
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
  const timeError = exitTimeError(trade, input.exitedAt ?? null, now);
  if (timeError !== null) return timeError;
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
  riskMinor: bigint | null,
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
  if (finalPnlMinor !== null && riskMinor !== null) {
    const computed = actualR(finalPnlMinor, riskMinor);
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

/** A risk decision the Trade already holds: No Defined Risk, or a recorded 1R. */
function riskAnswered(trade: TradeRow): boolean {
  return trade.plannedRiskState === 'no_defined' || trade.plannedRiskMinor !== null;
}

/**
 * THE PLAN ANSWERS A FINAL CLOSE MAY GIVE — shaped, and only for items the
 * Trade has not answered. An answer the Trade already holds is never
 * overwritten here; changing it is a plan edit, not part of closing.
 */
function validatePlanAnswers(
  trade: TradeRow,
  plan: FinalClosePlanAnswers,
): RecordContractExitErrorCode | null {
  const risk = plan.plannedRiskState;
  const riskMinor = plan.plannedRiskMinor ?? null;
  if (risk !== undefined && riskAnswered(trade)) return 'final_close_plan_already_answered';
  if (plan.targetState !== undefined && trade.targetState !== null) {
    return 'final_close_plan_already_answered';
  }
  if (plan.exitPlan !== undefined && trade.exitPlanState !== null) {
    return 'final_close_plan_already_answered';
  }
  if (risk === 'defined' && (riskMinor === null || riskMinor <= 0n)) return 'invalid_initial_risk';
  if (risk !== 'defined' && riskMinor !== null) return 'invalid_initial_risk';
  const reward = plan.plannedRewardMinor ?? null;
  const price = plan.targetPrice ?? null;
  if (plan.targetState === 'fixed') {
    if ((reward === null && price === null) || reward === 0n) return 'invalid_plan';
  } else if (reward !== null || price !== null) {
    return 'invalid_plan';
  }
  return null;
}

/**
 * FINAL CLOSE ELIGIBILITY (decision 59): every applicable Required item of
 * Steps 1–5, from what the Trade holds plus what this close supplies. Account,
 * Symbol and Direction are the Trade's identity and always present. The
 * Step 6 System Result is not here: it is recorded after the close, and until
 * then the record is closed but not complete.
 */
function missingForFinalClose(
  trade: TradeRow,
  input: FinalCloseInput,
): readonly FinalCloseMissing[] {
  const plan = input.plan ?? {};
  const missing: FinalCloseMissing[] = [];
  if (!riskAnswered(trade) && plan.plannedRiskState === undefined) missing.push('risk');
  const targetState = trade.targetState ?? plan.targetState ?? null;
  if (targetState === null) missing.push('target');
  if (targetState === 'no_fixed' && trade.exitPlanState === null && plan.exitPlan === undefined) {
    missing.push('exitPlan');
  }
  if (input.traderOutcome === undefined) missing.push('outcome');
  if (input.finalPnlMinor == null) missing.push('traderResult');
  return missing;
}

export async function recordContractExitInTx(
  tx: Tx,
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: RecordContractExitInput,
  clock: Clock,
): Promise<RecordContractExitResult> {
  const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
  if (membershipDenial !== null) return { ok: false, code: membershipDenial };
  const fingerprint = fingerprintOf(tradeId, input);

  // A Save key already used: the same request answers with what it recorded.
  // Checked BEFORE write entitlement, because answering it writes nothing.
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
    const recorded = await lockTradeRow(tx, workspaceId, tradeId);
    if (!recorded.ok) return recorded;
    return successFor(recorded.trade, replay, true);
  }

  // Everything below writes, so it needs write entitlement.
  const denial = await resolveMutationDenial(tx, workspaceId, clock);
  if (denial !== null) return { ok: false, code: denial };
  const locked = await lockTradeRow(tx, workspaceId, tradeId);
  if (!locked.ok) return locked;
  const { trade } = locked;

  if (!isContractRow(trade)) return { ok: false, code: 'legacy_trade_not_supported' };
  // Record Exit and Final Close are for a live position only (contract §10–§11).
  if (trade.status !== 'open') return { ok: false, code: 'invalid_status_transition' };

  const now = clock.now();
  const exits = await currentExits(tx, tradeId);
  if (exits.length >= CONTRACT_EXIT_LIMIT) return { ok: false, code: 'exit_limit_reached' };
  const legError = validateLeg(trade, exits, input, now);
  if (legError !== null) return { ok: false, code: legError };

  let final: Extract<ReturnType<typeof composeFinalResult>, { ok: true }> | null = null;
  let planWrite: Partial<TradeRow> = {};
  if (input.scope === 'all_remaining') {
    /*
      ONLY A COMPLETE RECORD CLOSES (decision 59). Every applicable Required
      item of Steps 1–5 must be explicitly answered — by the Trade already or
      by this close — or the close is refused with what is missing, and
      nothing is written. A Part exit is never gated.
    */
    const plan = input.plan ?? {};
    const planError = validatePlanAnswers(trade, plan);
    if (planError !== null) return { ok: false, code: planError };
    let exitPlanSnapshot: Partial<TradeRow> = {};
    if (plan.exitPlan !== undefined) {
      const resolved = await resolveContractExitPlanInTx(
        tx,
        workspaceId,
        plan.exitPlan,
        trade.strategyId ?? null,
      );
      if (!resolved.ok) return { ok: false, code: 'invalid_exit_plan' };
      exitPlanSnapshot = { ...resolved.value, exitPlanOrigin: laterCaptureOrigin(trade.status) };
    }
    planWrite = {
      ...(plan.plannedRiskState === undefined
        ? {}
        : {
            plannedRiskState: plan.plannedRiskState,
            plannedRiskMinor: plan.plannedRiskMinor ?? null,
          }),
      ...(plan.targetState === undefined
        ? {}
        : {
            targetState: plan.targetState,
            plannedRewardMinor: plan.plannedRewardMinor ?? null,
            targetPrice: plan.targetPrice ?? null,
          }),
      ...exitPlanSnapshot,
    };
    const finalExitedAt = input.finalExitedAt ?? null;
    const finalTimeError = exitTimeError(trade, finalExitedAt, now);
    if (finalTimeError !== null) return { ok: false, code: finalTimeError };
    if (finalExitedAt !== null) {
      // No recorded exit leg may fall after the Trade's own final exit.
      const legTimes = [...exits.map((exit) => exit.exitedAt), input.exitedAt ?? null];
      if (legTimes.some((time) => time !== null && time.getTime() > finalExitedAt.getTime())) {
        return { ok: false, code: 'final_exit_before_recorded_exit' };
      }
    }
    const composed = composeFinalResult(
      trade,
      // The 1R this close completes counts for its own Actual R.
      trade.plannedRiskMinor ?? input.plan?.plannedRiskMinor ?? null,
      [...exits.map((exit) => exit.realizedPnlMinor), input.realizedPnlMinor ?? null],
      input,
    );
    if (!composed.ok) return composed;
    // Well-formed first, then complete: a malformed answer is named before a missing one.
    const missing = missingForFinalClose(trade, input);
    if (missing.length > 0) return { ok: false, code: 'final_close_incomplete', missing };
    final = composed;
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
        ...planWrite,
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
        updatedAt: now,
      })
      .where(and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId)))
      .returning();
    if (row === undefined) throw new Error('recordContractExit: trade close returned no row');
    updated = row;
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
