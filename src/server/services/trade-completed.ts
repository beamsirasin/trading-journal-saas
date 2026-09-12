import 'server-only';

import { eq } from 'drizzle-orm';

import { composeRealizedActual, composeTraderClose, composeTraderCloseV2 } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { generateId } from '@/lib/identifiers';
import { getChartAttachmentStorage } from '@/lib/storage/chart-attachment-storage';
import { systemClock, type Clock } from '@/lib/time';
import type {
  ActualResultMode,
  ExitHistoryCompleteness,
  ExitScope,
  OutcomeValue,
  SystemStatus,
} from '@/lib/trades/constants';
import {
  isRecordedRetrospectively,
  validateCompletedTradeTimestamps,
  type SystemPlanBasis,
} from '@/lib/trades/recording-model';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb } from '@/server/db/client';
import { tradeExits, trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import {
  createTradeInTx,
  SetupConditionSnapshotFailure,
  type CreateTradeErrorCode,
  type CreateTradeInput,
} from './trade-management';

export interface CompletedTradeExitInput {
  readonly closedBps?: number | null;
  readonly exitScope?: ExitScope | null;
  readonly exitPrice?: string | null;
  readonly realizedPnlMinor?: bigint | null;
  readonly exitReason?: string | null;
  readonly exitedAt?: Date | null;
}

export interface CreateCompletedTradeInput extends Omit<
  CreateTradeInput,
  'recordingTiming' | 'systemPlanBasis' | 'actualResultMode' | 'enteredAt'
> {
  readonly recordingTiming: 'after_trade';
  readonly systemPlanBasis?: SystemPlanBasis | null;
  readonly actualResultBasis: ActualResultMode;
  readonly enteredAt?: Date | null;
  readonly exitedAt?: Date | null;
  /** Canonical whole-Trade result, independent from supporting Exit evidence. */
  readonly finalPnlMinor?: bigint | null;
  readonly exitHistoryCompleteness?: ExitHistoryCompleteness;
  readonly exits?: readonly CompletedTradeExitInput[];
}

export type CreateCompletedTradeErrorCode =
  | CreateTradeErrorCode
  | 'invalid_completed_trade_time'
  | 'invalid_completed_exit_coverage'
  | 'historical_exit_conflict'
  | 'completed_trade_replay_conflict'
  | 'invalid_initial_risk'
  | 'invalid_execution_context'
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
      readonly systemR: string | null;
      readonly systemOutcome: OutcomeValue | null;
      readonly recordedRetrospectively: boolean;
    }
  | {
      readonly ok: false;
      readonly code: CreateCompletedTradeErrorCode;
      readonly calcReason?: CalcFailureReason;
    };

type CompletedFailureResult = Extract<CreateCompletedTradeResult, { readonly ok: false }>;

interface ActualSnapshot {
  readonly actualExit: string | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly calcVersion?: number;
}

function classifyMoneyOutcome(netPnlMinor: bigint): OutcomeValue {
  if (netPnlMinor === 0n) return 'break_even';
  return netPnlMinor > 0n ? 'win' : 'loss';
}

function isMeaningfulExit(exit: CompletedTradeExitInput): boolean {
  return (
    exit.closedBps != null ||
    exit.exitScope != null ||
    exit.exitPrice != null ||
    exit.realizedPnlMinor != null ||
    exit.exitedAt != null
  );
}

function preflightCompletedInput(
  input: CreateCompletedTradeInput,
  now: Date,
): CompletedFailureResult | null {
  if (input.recordingTiming !== 'after_trade') {
    return { ok: false, code: 'completed_trade_path_required' };
  }
  if (input.actualResultBasis !== 'price' && input.actualResultBasis !== 'money') {
    return { ok: false, code: 'invalid_execution_context' };
  }

  const enteredAt = input.enteredAt ?? null;
  const exitedAt = input.exitedAt ?? null;
  if (!validateCompletedTradeTimestamps({ enteredAt, exitedAt, now }).ok) {
    return { ok: false, code: 'invalid_completed_trade_time' };
  }
  const actualEntry = input.actualEntry ?? null;
  const actualInitialStop = input.actualInitialStop ?? null;
  if ((actualEntry === null) !== (actualInitialStop === null)) {
    return { ok: false, code: 'invalid_execution_context' };
  }
  const risk = input.actualInitialRiskMinor ?? null;
  if (risk !== null && risk <= 0n) return { ok: false, code: 'invalid_initial_risk' };
  if (input.actualResultBasis === 'price') {
    if (risk !== null || (input.finalPnlMinor ?? null) !== null) {
      return { ok: false, code: 'invalid_execution_context' };
    }
  }

  const exits = input.exits ?? [];
  if (exits.length === 0 && input.exitHistoryCompleteness !== undefined) {
    return { ok: false, code: 'invalid_exit_shape' };
  }
  if (!exits.every(isMeaningfulExit)) return { ok: false, code: 'invalid_exit_shape' };

  let knownClosedBps = 0;
  for (const exit of exits) {
    if (
      (input.actualResultBasis === 'price' && exit.realizedPnlMinor != null) ||
      (input.actualResultBasis === 'money' && exit.exitPrice != null)
    ) {
      return { ok: false, code: 'invalid_exit_shape' };
    }
    if (exit.closedBps != null) {
      if (!Number.isSafeInteger(exit.closedBps) || exit.closedBps <= 0 || exit.closedBps > 10_000) {
        return { ok: false, code: 'invalid_completed_exit_coverage' };
      }
      knownClosedBps += exit.closedBps;
      if (!Number.isSafeInteger(knownClosedBps) || knownClosedBps > 10_000) {
        return { ok: false, code: 'invalid_completed_exit_coverage' };
      }
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

  if (input.exitHistoryCompleteness === 'complete' && input.finalPnlMinor != null) {
    let subtotal = 0n;
    let allExitPnlKnown = exits.length > 0;
    for (const exit of exits) {
      if (exit.realizedPnlMinor == null) {
        allExitPnlKnown = false;
        break;
      }
      subtotal += exit.realizedPnlMinor;
    }
    if (allExitPnlKnown && subtotal !== input.finalPnlMinor) {
      return { ok: false, code: 'historical_exit_conflict' };
    }
  }

  return null;
}

function composeActualSnapshot(
  input: CreateCompletedTradeInput,
): { readonly ok: true; readonly value: ActualSnapshot } | CompletedFailureResult {
  const actualEntry = input.actualEntry ?? null;
  const actualInitialStop = input.actualInitialStop ?? null;
  if (actualEntry !== null && actualInitialStop !== null) {
    const context = composeRealizedActual({
      actualResultMode: 'price',
      direction: input.direction,
      actualEntry,
      actualInitialStop,
      exits: [],
    });
    if (!context.ok) {
      return { ok: false, code: 'invalid_execution_context', calcReason: context.reason };
    }
  }

  if (input.actualResultBasis === 'money') {
    const finalPnlMinor = input.finalPnlMinor ?? null;
    if (finalPnlMinor === null) {
      return { ok: true, value: { actualExit: null, actualR: null, traderOutcome: null } };
    }
    const risk = input.actualInitialRiskMinor ?? null;
    if (risk === null) {
      return {
        ok: true,
        value: {
          actualExit: null,
          actualR: null,
          traderOutcome: classifyMoneyOutcome(finalPnlMinor),
        },
      };
    }
    const snapshot = composeTraderClose(finalPnlMinor, risk);
    if (!snapshot.ok) {
      return { ok: false, code: 'invalid_execution_context', calcReason: snapshot.reason };
    }
    return { ok: true, value: { actualExit: null, ...snapshot.value } };
  }

  if (actualEntry === null || actualInitialStop === null) {
    return { ok: true, value: { actualExit: null, actualR: null, traderOutcome: null } };
  }
  const completePriceExits: Array<{
    readonly closedBps: number;
    readonly exitPrice: string;
    readonly exitedAt: Date;
  }> = [];
  for (const exit of input.exits ?? []) {
    if (exit.closedBps == null || exit.exitPrice == null || exit.exitedAt == null) {
      return { ok: true, value: { actualExit: null, actualR: null, traderOutcome: null } };
    }
    completePriceExits.push({
      closedBps: exit.closedBps,
      exitPrice: exit.exitPrice,
      exitedAt: exit.exitedAt,
    });
  }
  if (
    completePriceExits.length === 0 ||
    completePriceExits.reduce((sum, exit) => sum + exit.closedBps, 0) !== 10_000
  ) {
    return { ok: true, value: { actualExit: null, actualR: null, traderOutcome: null } };
  }

  const snapshot = composeTraderCloseV2({
    actualResultMode: 'price',
    direction: input.direction,
    actualEntry,
    actualInitialStop,
    exits: completePriceExits.map((exit) => ({
      closedBps: exit.closedBps,
      exitPrice: exit.exitPrice,
      realizedPnlMinor: null,
    })),
  });
  if (!snapshot.ok) {
    return { ok: false, code: 'invalid_exit_shape', calcReason: snapshot.reason };
  }
  const chronologicalFinal = completePriceExits.reduce((latest, exit) =>
    latest.exitedAt.getTime() <= exit.exitedAt.getTime() ? exit : latest,
  );
  return { ok: true, value: { actualExit: chronologicalFinal.exitPrice, ...snapshot.value } };
}

function successFromRow(
  trade: typeof trades.$inferSelect,
  alreadyCreated: boolean,
): CreateCompletedTradeResult {
  if (trade.status !== 'closed') return { ok: false, code: 'completed_trade_replay_conflict' };
  return {
    ok: true,
    tradeId: trade.id,
    alreadyCreated,
    status: 'closed',
    actualR: trade.actualR,
    traderOutcome: trade.traderOutcome as OutcomeValue | null,
    systemStatus: trade.systemStatus as SystemStatus,
    systemR: trade.systemR,
    systemOutcome: trade.systemOutcome as OutcomeValue | null,
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

/** Creates one historical closed Trade without routing sparse evidence through live exit mutation rules. */
export async function createCompletedTrade(
  workspaceId: string,
  userId: string,
  input: CreateCompletedTradeInput,
  clock: Clock = systemClock,
): Promise<CreateCompletedTradeResult> {
  const invalid = preflightCompletedInput(input, clock.now());
  if (invalid !== null) {
    await cleanupOrphanChart(input);
    return invalid;
  }
  const actualSnapshot = composeActualSnapshot(input);
  if (!actualSnapshot.ok) {
    await cleanupOrphanChart(input);
    return actualSnapshot;
  }

  let result: CreateCompletedTradeResult;
  try {
    result = await getDb().transaction(async (tx): Promise<CreateCompletedTradeResult> => {
      const createInput = {
        mutationKey: input.mutationKey,
        tradingAccountId: input.tradingAccountId,
        recordingTiming: 'after_trade',
        ...(input.systemPlanBasis == null ? {} : { systemPlanBasis: input.systemPlanBasis }),
        strategyId: input.strategyId,
        setupId: input.setupId,
        conditionSetToken: input.conditionSetToken,
        conditionAnswers: input.conditionAnswers,
        symbol: input.symbol,
        direction: input.direction,
        plannedEntry: input.plannedEntry,
        plannedStop: input.plannedStop,
        plannedTarget: input.plannedTarget,
        plannedPositionSize: input.plannedPositionSize,
        plannedRiskMinor: input.plannedRiskMinor,
        plannedRewardMinor: input.plannedRewardMinor,
        timeframe: input.timeframe,
        session: input.session,
        confirmationNotes: input.confirmationNotes,
        confidence: input.confidence,
        emotionKeys: input.emotionKeys,
        tradingviewUrl: input.tradingviewUrl,
        notes: input.notes,
        chartAttachmentStorageKey: input.chartAttachmentStorageKey,
      } as CreateTradeInput;
      const created = await createTradeInTx(
        tx,
        workspaceId,
        userId,
        createInput,
        clock,
        'completed',
      );
      if (!created.ok) return created;

      const existing = await tx.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
      if (existing === undefined) throw new Error('createCompletedTrade: created Trade missing');
      if (created.alreadyCreated) return successFromRow(existing, true);

      const exits = input.exits ?? [];
      const now = clock.now();
      await tx
        .update(trades)
        .set({
          status: 'closed',
          actualResultMode: input.actualResultBasis,
          actualEntry: input.actualEntry ?? null,
          actualInitialStop: input.actualInitialStop ?? null,
          actualInitialRiskMinor: input.actualInitialRiskMinor ?? null,
          actualPositionSize: input.actualPositionSize ?? null,
          actualExit: actualSnapshot.value.actualExit,
          netPnlMinor: input.finalPnlMinor ?? null,
          finalPnlSource: input.finalPnlMinor == null ? null : 'manual_total',
          exitHistoryCompleteness:
            exits.length === 0 ? null : (input.exitHistoryCompleteness ?? 'unknown'),
          enteredAt: input.enteredAt ?? null,
          exitedAt: input.exitedAt ?? null,
          actualR: actualSnapshot.value.actualR,
          traderOutcome: actualSnapshot.value.traderOutcome,
          ...(actualSnapshot.value.calcVersion === undefined
            ? {}
            : { calcVersion: actualSnapshot.value.calcVersion }),
          updatedAt: now,
        })
        .where(eq(trades.id, created.tradeId));

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
