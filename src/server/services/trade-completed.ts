import 'server-only';

import { and, eq } from 'drizzle-orm';

import { actualR } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { generateId } from '@/lib/identifiers';
import type { SetupConditionAnswer } from '@/lib/setup-conditions/snapshots';
import { getChartAttachmentStorage } from '@/lib/storage/chart-attachment-storage';
import { systemClock, type Clock } from '@/lib/time';
import {
  RECORDING_CONTRACT_ADD_TRADE_V1,
  type ActualRiskAnswer,
  type PlannedStopMethod,
  type TargetState,
} from '@/lib/trades/add-trade-contract';
import type {
  ExitHistoryCompleteness,
  HistoricalExitScope,
  OutcomeValue,
  SystemStatus,
} from '@/lib/trades/constants';
import {
  isRecordedRetrospectively,
  validateCompletedTradeTimestamps,
} from '@/lib/trades/recording-model';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb } from '@/server/db/client';
import { tradeExits, trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import {
  createTradeInTx,
  SetupConditionSnapshotFailure,
  type ContractClosedColumns,
  type CreateTradeErrorCode,
  type CreateTradeExitPlanChoice,
  type CreateTradeInput,
  type ReplayConflictReason,
} from './trade-management';
import { tradeMutationFingerprint } from './trade-mutation-fingerprint';

/**
 * SAVE CLOSED TRADE — the Add Trade contract After Trade write (contract §13).
 *
 * A historical Trade is born closed, from what the trader remembers. Only
 * Account, Symbol and Direction are required; everything else may be
 * Unanswered or not recorded and stays that way. The rules this service keeps:
 *
 * - Final Net P&L is the authoritative result, stored exactly as given. Exit
 *   rows are supporting history and never replace it (contract §11).
 * - Trader Outcome is the trader's choice, stored as given and marked selected.
 *   It is never derived from P&L, R or a tolerance (contract §12).
 * - Actual R = Final Net P&L / Risk at Entry, and only when both are known
 *   (contract §4). Actual Risk is Risk Discipline evidence, never the
 *   denominator. Price never computes anything (contract §3).
 * - A Complete exit history whose subtotal differs from Final Net P&L is a
 *   discrepancy to show, not a reason to refuse the Save (contract §11).
 */

export interface CompletedTradeExitInput {
  readonly closedBps?: number | null;
  readonly exitScope?: HistoricalExitScope | null;
  /** Context only — never an input to P&L or R. */
  readonly exitPrice?: string | null;
  readonly realizedPnlMinor?: bigint | null;
  readonly exitReason?: string | null;
  readonly exitedAt?: Date | null;
}

export interface CreateCompletedTradeInput {
  readonly mutationKey: string;
  readonly tradingAccountId: string;
  readonly recordingTiming: 'after_trade';
  readonly recordingContract: typeof RECORDING_CONTRACT_ADD_TRADE_V1;
  readonly symbol: string;
  readonly direction: string;
  readonly enteredAt?: Date | null;
  readonly exitedAt?: Date | null;
  /** Risk at Entry. */
  readonly plannedRiskMinor?: bigint | null;
  readonly actualRiskAnswer?: ActualRiskAnswer | undefined;
  readonly actualInitialRiskMinor?: bigint | null;
  readonly plannedStopMethod?: PlannedStopMethod | undefined;
  readonly targetState?: TargetState | undefined;
  /** Target Profit. */
  readonly plannedRewardMinor?: bigint | null;
  readonly targetPrice?: string | null;
  readonly contextEntryPrice?: string | null;
  readonly contextStopPrice?: string | null;
  readonly contextPositionSize?: string | null;
  readonly exitPlan?: CreateTradeExitPlanChoice | undefined;
  readonly finalPnlMinor?: bigint | null;
  /** The trader chose "Use recorded exits as final result"; re-checked here, never trusted. */
  readonly finalPnlAdoptedFromExits?: true | undefined;
  readonly traderOutcome?: OutcomeValue | undefined;
  readonly exitHistoryCompleteness?: ExitHistoryCompleteness | undefined;
  readonly exits?: readonly CompletedTradeExitInput[];
  readonly strategyId?: string | undefined;
  readonly setupId?: string | undefined;
  readonly noStrategy?: boolean | undefined;
  readonly noSetup?: boolean | undefined;
  readonly conditionSetToken?: string | undefined;
  readonly conditionAnswers?: readonly SetupConditionAnswer[] | undefined;
  readonly confidence?: number | null;
  readonly emotionKeys?: readonly string[] | undefined;
  readonly postTradeEmotionKeys?: readonly string[] | undefined;
  readonly timeframe?: string | null;
  readonly session?: string | null;
  readonly confirmationNotes?: string | null;
  readonly tradingviewUrl?: string | null;
  readonly notes?: string | null;
  readonly chartAttachmentStorageKey?: string | null;
  /** Stage 6 After-Trade Context, saved atomically with the Closed Trade. */
  readonly afterTradeNote?: string | null;
  readonly afterTradeTradingviewUrl?: string | null;
}

export type CreateCompletedTradeErrorCode =
  | CreateTradeErrorCode
  | 'exit_history_not_adoptable'
  | 'invalid_completed_trade_time'
  | 'invalid_completed_exit_coverage'
  | 'invalid_exit_shape'
  | 'invalid_exit_time';

export type CreateCompletedTradeResult =
  | {
      readonly ok: true;
      readonly tradeId: string;
      readonly alreadyCreated: boolean;
      readonly status: 'closed';
      readonly actualR: string | null;
      readonly traderOutcome: OutcomeValue | null;
      readonly systemStatus: SystemStatus;
      readonly recordedRetrospectively: boolean;
    }
  | {
      readonly ok: false;
      readonly code: CreateCompletedTradeErrorCode;
      readonly calcReason?: CalcFailureReason;
      /** With `mutation_replay_conflict`: the Trade the key already created. */
      readonly existingTradeId?: string;
      readonly replayConflict?: ReplayConflictReason;
    };

type CompletedFailureResult = Extract<CreateCompletedTradeResult, { readonly ok: false }>;

function isMeaningfulExit(exit: CompletedTradeExitInput): boolean {
  return (
    exit.closedBps != null ||
    exit.exitScope != null ||
    exit.exitPrice != null ||
    exit.realizedPnlMinor != null ||
    normalizeOptionalText(exit.exitReason) !== null ||
    exit.exitedAt != null
  );
}

/**
 * Refuses only what is malformed or impossible as entered — including exits
 * that together close more than the whole position. Missing answers, an
 * incomplete exit history, percentages that stop short of 100% and a subtotal
 * that differs from Final Net P&L are all saved as they are.
 */
function preflightCompletedInput(
  input: CreateCompletedTradeInput,
  now: Date,
): CompletedFailureResult | null {
  if (input.recordingTiming !== 'after_trade') {
    return { ok: false, code: 'completed_trade_path_required' };
  }
  if (input.recordingContract !== RECORDING_CONTRACT_ADD_TRADE_V1) {
    return { ok: false, code: 'invalid_plan_authority' };
  }

  const enteredAt = input.enteredAt ?? null;
  const exitedAt = input.exitedAt ?? null;
  if (!validateCompletedTradeTimestamps({ enteredAt, exitedAt, now }).ok) {
    return { ok: false, code: 'invalid_completed_trade_time' };
  }

  const exits = input.exits ?? [];
  if (exits.length === 0 && input.exitHistoryCompleteness !== undefined) {
    return { ok: false, code: 'invalid_exit_shape' };
  }
  if (!exits.every(isMeaningfulExit)) return { ok: false, code: 'invalid_exit_shape' };

  let knownClosedBps = 0;
  for (const exit of exits) {
    if (exit.closedBps != null) {
      if (!Number.isSafeInteger(exit.closedBps) || exit.closedBps <= 0 || exit.closedBps > 10_000) {
        return { ok: false, code: 'invalid_completed_exit_coverage' };
      }
      knownClosedBps += exit.closedBps;
      if (knownClosedBps > 10_000) return { ok: false, code: 'invalid_completed_exit_coverage' };
    }
    const legExitedAt = exit.exitedAt ?? null;
    if (
      legExitedAt !== null &&
      (legExitedAt.getTime() > now.getTime() ||
        (enteredAt !== null && legExitedAt.getTime() < enteredAt.getTime()) ||
        (exitedAt !== null && legExitedAt.getTime() > exitedAt.getTime()))
    ) {
      return { ok: false, code: 'invalid_exit_time' };
    }
  }
  return null;
}

/**
 * AN ADOPTION IS CHECKED, NOT TRUSTED (contract §11).
 *
 * Final Net P&L is recorded as adopted from exit history only when the client
 * says the trader chose it AND the history itself still supports it: declared
 * Complete, every exit carrying P&L, and a subtotal exactly equal to the Final
 * Net P&L sent. Anything less is refused rather than stored as manual — the
 * trader asked for adoption, and silently recording something else would
 * misstate what they did.
 */
function adoptionHolds(input: CreateCompletedTradeInput): boolean {
  const exits = input.exits ?? [];
  const final = input.finalPnlMinor ?? null;
  if (final === null || exits.length === 0 || input.exitHistoryCompleteness !== 'complete') {
    return false;
  }
  let subtotal = 0n;
  for (const exit of exits) {
    if (exit.realizedPnlMinor == null) return false;
    subtotal += exit.realizedPnlMinor;
  }
  return subtotal === final;
}

/** The closed result, exactly as the trader gave it. */
function composeClosedColumns(
  input: CreateCompletedTradeInput,
  now: Date,
): { readonly ok: true; readonly value: ContractClosedColumns } | CompletedFailureResult {
  const finalPnlMinor = input.finalPnlMinor ?? null;
  const adopted = input.finalPnlAdoptedFromExits === true;
  if (adopted && !adoptionHolds(input)) return { ok: false, code: 'exit_history_not_adoptable' };
  const riskAtEntryMinor = input.plannedRiskMinor ?? null;
  let canonicalActualR: string | null = null;
  if (finalPnlMinor !== null && riskAtEntryMinor !== null) {
    const computed = actualR(finalPnlMinor, riskAtEntryMinor);
    if (!computed.ok) {
      return { ok: false, code: 'invalid_initial_risk', calcReason: computed.reason };
    }
    canonicalActualR = computed.value;
  }
  const traderOutcome = input.traderOutcome ?? null;
  const exits = input.exits ?? [];
  return {
    ok: true,
    value: {
      exitedAt: input.exitedAt ?? null,
      netPnlMinor: finalPnlMinor,
      finalPnlSource: finalPnlMinor === null ? null : adopted ? 'exit_history' : 'manual_total',
      actualR: canonicalActualR,
      traderOutcome,
      traderOutcomeSelectedAt: traderOutcome === null ? null : now,
      // NULL is Unanswered on a contract row; the question needs an exit.
      exitHistoryCompleteness: exits.length === 0 ? null : (input.exitHistoryCompleteness ?? null),
      actualExit: null,
    },
  };
}

function successFromRow(
  trade: typeof trades.$inferSelect,
  alreadyCreated: boolean,
): CreateCompletedTradeResult {
  // Defence in depth: a replay reaching here matched a fingerprint, and an
  // open Trade under this key was still created by another path (At Entry).
  if (trade.status !== 'closed') {
    return {
      ok: false,
      code: 'mutation_replay_conflict',
      existingTradeId: trade.id,
      replayConflict: 'different',
    };
  }
  return {
    ok: true,
    tradeId: trade.id,
    alreadyCreated,
    status: 'closed',
    actualR: trade.actualR,
    traderOutcome: trade.traderOutcome as OutcomeValue | null,
    systemStatus: trade.systemStatus as SystemStatus,
    recordedRetrospectively: isRecordedRetrospectively({
      createdAt: trade.createdAt,
      exitedAt: trade.exitedAt,
    }),
  };
}

async function cleanupOrphanChart(input: CreateCompletedTradeInput): Promise<void> {
  if (input.chartAttachmentStorageKey == null) return;
  const storage = getChartAttachmentStorage();
  if (storage === null) return;
  try {
    await storage.delete(input.chartAttachmentStorageKey);
  } catch {
    // Best effort only; database atomicity never depends on object storage.
  }
}

/** Creates one historical closed Trade under the Add Trade contract. */
export async function createCompletedTrade(
  workspaceId: string,
  userId: string,
  input: CreateCompletedTradeInput,
  clock: Clock = systemClock,
): Promise<CreateCompletedTradeResult> {
  const now = clock.now();
  const invalid = preflightCompletedInput(input, now);
  if (invalid !== null) {
    await cleanupOrphanChart(input);
    return invalid;
  }
  const closed = composeClosedColumns(input, now);
  if (!closed.ok) {
    await cleanupOrphanChart(input);
    return closed;
  }

  const fingerprint = tradeMutationFingerprint('completed', input);
  let result: CreateCompletedTradeResult;
  try {
    result = await getDb().transaction(async (tx): Promise<CreateCompletedTradeResult> => {
      const enteredAt = input.enteredAt ?? null;
      const createInput: CreateTradeInput = {
        mutationKey: input.mutationKey,
        tradingAccountId: input.tradingAccountId,
        recordingTiming: 'after_trade',
        recordingContract: RECORDING_CONTRACT_ADD_TRADE_V1,
        symbol: input.symbol,
        direction: input.direction,
        ...(enteredAt === null ? {} : { enteredAt, enteredAtSource: 'trader' as const }),
        // Money is the only plan basis a contract row has (contract §3).
        ...(input.plannedRiskMinor != null || input.plannedRewardMinor != null
          ? { systemPlanBasis: 'money' as const }
          : {}),
        plannedRiskMinor: input.plannedRiskMinor ?? null,
        actualRiskAnswer: input.actualRiskAnswer,
        actualInitialRiskMinor: input.actualInitialRiskMinor ?? null,
        plannedStopMethod: input.plannedStopMethod,
        targetState: input.targetState,
        plannedRewardMinor: input.plannedRewardMinor ?? null,
        targetPrice: input.targetPrice ?? null,
        contextEntryPrice: input.contextEntryPrice ?? null,
        contextStopPrice: input.contextStopPrice ?? null,
        contextPositionSize: input.contextPositionSize ?? null,
        exitPlan: input.exitPlan,
        strategyId: input.strategyId,
        setupId: input.setupId,
        noStrategy: input.noStrategy,
        noSetup: input.noSetup,
        conditionSetToken: input.conditionSetToken,
        conditionAnswers: input.conditionAnswers,
        confidence: input.confidence ?? null,
        ...(input.emotionKeys === undefined ? {} : { emotionKeys: input.emotionKeys }),
        postTradeEmotionKeys: input.postTradeEmotionKeys,
        timeframe: input.timeframe ?? null,
        session: input.session ?? null,
        confirmationNotes: input.confirmationNotes ?? null,
        tradingviewUrl: input.tradingviewUrl ?? null,
        notes: input.notes ?? null,
        chartAttachmentStorageKey: input.chartAttachmentStorageKey ?? null,
        closedAtCreation: closed.value,
      };
      const created = await createTradeInTx(
        tx,
        workspaceId,
        userId,
        createInput,
        clock,
        'completed',
        fingerprint,
      );
      if (!created.ok) return created;

      if (created.alreadyCreated) {
        const existing = await tx.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
        if (existing === undefined) throw new Error('createCompletedTrade: replayed Trade missing');
        return successFromRow(existing, true);
      }

      const exits = input.exits ?? [];
      if (exits.length > 0) {
        await tx.insert(tradeExits).values(
          exits.map((exit, index) => ({
            id: generateId(),
            workspaceId,
            tradeId: created.tradeId,
            mutationKey: generateId(),
            sequence: index + 1,
            closedBps: exit.closedBps ?? null,
            exitScope: exit.exitScope ?? null,
            exitPrice: exit.exitPrice ?? null,
            realizedPnlMinor: exit.realizedPnlMinor ?? null,
            exitReason: normalizeOptionalText(exit.exitReason),
            exitedAt: exit.exitedAt ?? null,
            updatedAt: now,
          })),
        );
      }

      // STAGE 6, IN THE SAME TRANSACTION: the Trade is created Closed, so its
      // After-Trade Context can be written before anything commits.
      const afterTradeNote = normalizeOptionalText(input.afterTradeNote);
      const afterTradeTradingviewUrl = normalizeOptionalText(input.afterTradeTradingviewUrl);
      if (afterTradeNote !== null || afterTradeTradingviewUrl !== null) {
        await tx
          .update(trades)
          .set({ afterTradeNote, afterTradeTradingviewUrl })
          .where(and(eq(trades.id, created.tradeId), eq(trades.workspaceId, workspaceId)));
      }

      await insertAuditLog(tx, {
        action: 'trade.created',
        workspaceId,
        actorUserId: userId,
        entityType: 'trade',
        entityId: created.tradeId,
        metadata: {
          tradeId: created.tradeId,
          tradingAccountId: input.tradingAccountId,
          newStatus: 'closed',
          recordingTiming: 'after_trade',
          systemStatus: 'pending',
          exitCount: exits.length,
          ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
          ...(input.setupId !== undefined ? { setupId: input.setupId } : {}),
        },
      });

      const finished = await tx.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
      if (finished === undefined) throw new Error('createCompletedTrade: finished Trade missing');
      return successFromRow(finished, false);
    });
  } catch (error) {
    if (error instanceof SetupConditionSnapshotFailure) {
      result = { ok: false, code: error.code };
    } else {
      throw error;
    }
  }

  if (!result.ok) await cleanupOrphanChart(input);
  return result;
}
