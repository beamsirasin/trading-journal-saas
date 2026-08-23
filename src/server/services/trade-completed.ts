import 'server-only';

import { eq } from 'drizzle-orm';

import type { CalcFailureReason } from '@/lib/calc/types';
import { generateId } from '@/lib/identifiers';
import { getChartAttachmentStorage } from '@/lib/storage/chart-attachment-storage';
import { systemClock, type Clock } from '@/lib/time';
import type { ActualResultMode, OutcomeValue, SystemStatus } from '@/lib/trades/constants';
import {
  isRecordedRetrospectively,
  validateCompletedTradeTimestamps,
  type SystemPlanBasis,
} from '@/lib/trades/recording-model';
import { getDb } from '@/server/db/client';
import { trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { addTradeExitInTx } from './trade-execution';
import {
  createTradeInTx,
  markSystemNoTradeInTx,
  resolveSystemTradeInTx,
  SetupConditionSnapshotFailure,
  type CreateTradeErrorCode,
  type CreateTradeInput,
  type ResolveSystemTradeInput,
} from './trade-management';

export interface CompletedTradeExitInput {
  readonly closedBps: number;
  readonly exitPrice?: string | null;
  readonly realizedPnlMinor?: bigint | null;
  readonly exitReason?: string | null;
  /** Omitted legs use the completed Trade's canonical `exitedAt`. */
  readonly exitedAt?: Date;
}

export type CompletedSystemResultInput =
  { readonly status: 'no_trade' } | ({ readonly status: 'resolved' } & ResolveSystemTradeInput);

export interface CreateCompletedTradeInput extends Omit<
  CreateTradeInput,
  'recordingTiming' | 'systemPlanBasis' | 'actualResultMode' | 'enteredAt'
> {
  readonly recordingTiming: 'after_trade';
  readonly systemPlanBasis: SystemPlanBasis;
  readonly actualResultBasis: ActualResultMode;
  readonly enteredAt: Date;
  readonly exitedAt: Date;
  readonly exits: readonly CompletedTradeExitInput[];
  readonly systemResult?: CompletedSystemResultInput;
}

export type CreateCompletedTradeErrorCode =
  | CreateTradeErrorCode
  | 'invalid_completed_trade_time'
  | 'invalid_completed_exit_coverage'
  | 'completed_trade_replay_conflict'
  | 'trade_not_found'
  | 'invalid_status_transition'
  | 'invalid_closed_bps'
  | 'invalid_exit_shape'
  | 'invalid_exit_time'
  | 'system_requires_price_plan'
  | 'invalid_system_status_transition'
  | 'invalid_system_exit_reason';

export type CreateCompletedTradeResult =
  | {
      readonly ok: true;
      readonly tradeId: string;
      readonly alreadyCreated: boolean;
      readonly status: 'closed';
      readonly actualR: string;
      readonly traderOutcome: OutcomeValue;
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

class CompletedTradeTransactionFailure extends Error {
  constructor(readonly result: CompletedFailureResult) {
    super(result.code);
    this.name = 'CompletedTradeTransactionFailure';
  }
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

  const timestamps = validateCompletedTradeTimestamps({
    enteredAt: input.enteredAt,
    exitedAt: input.exitedAt,
    now,
  });
  if (!timestamps.ok) return { ok: false, code: 'invalid_completed_trade_time' };

  if (input.exits.length === 0) {
    return { ok: false, code: 'invalid_completed_exit_coverage' };
  }
  const totalClosedBps = input.exits.reduce((sum, exit) => sum + exit.closedBps, 0);
  if (
    !input.exits.every(
      (exit) =>
        Number.isSafeInteger(exit.closedBps) && exit.closedBps > 0 && exit.closedBps <= 10_000,
    ) ||
    !Number.isSafeInteger(totalClosedBps) ||
    totalClosedBps !== 10_000
  ) {
    return { ok: false, code: 'invalid_completed_exit_coverage' };
  }

  let chronologicalFinalMs = Number.NEGATIVE_INFINITY;
  for (const exit of input.exits) {
    const legExitedAt = exit.exitedAt ?? input.exitedAt;
    chronologicalFinalMs = Math.max(chronologicalFinalMs, legExitedAt.getTime());
    if (
      legExitedAt.getTime() < input.enteredAt.getTime() ||
      legExitedAt.getTime() > input.exitedAt.getTime() ||
      legExitedAt.getTime() > now.getTime()
    ) {
      return { ok: false, code: 'invalid_exit_time' };
    }
  }
  if (chronologicalFinalMs !== input.exitedAt.getTime()) {
    return { ok: false, code: 'invalid_exit_time' };
  }

  if (input.systemResult?.status === 'resolved') {
    const systemExitedAt = input.systemResult.systemExitedAt;
    if (
      systemExitedAt.getTime() < input.enteredAt.getTime() ||
      systemExitedAt.getTime() > now.getTime()
    ) {
      return { ok: false, code: 'invalid_completed_trade_time' };
    }
  }
  return null;
}

function successFromRow(
  trade: typeof trades.$inferSelect,
  alreadyCreated: boolean,
): CreateCompletedTradeResult {
  if (
    trade.status !== 'closed' ||
    trade.actualR === null ||
    trade.traderOutcome === null ||
    trade.exitedAt === null
  ) {
    return { ok: false, code: 'completed_trade_replay_conflict' };
  }
  return {
    ok: true,
    tradeId: trade.id,
    alreadyCreated,
    status: 'closed',
    actualR: trade.actualR,
    traderOutcome: trade.traderOutcome as OutcomeValue,
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

/**
 * Creates a completed Trade as one externally atomic write. The opening row
 * exists only inside this transaction while canonical Actual exit aggregation
 * and optional System resolution run; callers can observe either no Trade or
 * one fully closed Trade, never an intermediate lifecycle state.
 */
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

  let result: CreateCompletedTradeResult;
  try {
    result = await getDb().transaction(async (tx): Promise<CreateCompletedTradeResult> => {
      const createInput = {
        mutationKey: input.mutationKey,
        tradingAccountId: input.tradingAccountId,
        recordingTiming: 'after_trade',
        systemPlanBasis: input.systemPlanBasis,
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
        actualResultMode: input.actualResultBasis,
        actualEntry: input.actualEntry,
        actualInitialStop: input.actualInitialStop,
        actualInitialRiskMinor: input.actualInitialRiskMinor,
        actualPositionSize: input.actualPositionSize,
        enteredAt: input.enteredAt,
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

      const openingTrade = await tx.query.trades.findFirst({
        where: eq(trades.id, created.tradeId),
      });
      if (openingTrade === undefined) {
        throw new Error('createCompletedTrade: created Trade could not be re-read');
      }
      if (created.alreadyCreated) return successFromRow(openingTrade, true);

      let finalExitResult:
        Extract<Awaited<ReturnType<typeof addTradeExitInTx>>, { readonly ok: true }> | undefined;
      for (const exit of input.exits) {
        const exitResult = await addTradeExitInTx(
          tx,
          workspaceId,
          userId,
          created.tradeId,
          {
            mutationKey: generateId(),
            closedBps: exit.closedBps,
            exitedAt: exit.exitedAt ?? input.exitedAt,
            ...(exit.exitPrice !== undefined ? { exitPrice: exit.exitPrice } : {}),
            ...(exit.realizedPnlMinor !== undefined
              ? { realizedPnlMinor: exit.realizedPnlMinor }
              : {}),
            ...(exit.exitReason !== undefined ? { exitReason: exit.exitReason } : {}),
          },
          clock,
          { trustedTrade: openingTrade, emitAudit: false },
        );
        if (!exitResult.ok) {
          throw new CompletedTradeTransactionFailure(exitResult);
        }
        finalExitResult = exitResult;
      }
      if (finalExitResult?.status !== 'closed' || finalExitResult.remainingBps !== 0) {
        throw new CompletedTradeTransactionFailure({
          ok: false,
          code: 'invalid_completed_exit_coverage',
        });
      }

      let systemStatus: SystemStatus = 'pending';
      if (input.systemResult?.status === 'no_trade') {
        const system = await markSystemNoTradeInTx(
          tx,
          workspaceId,
          userId,
          created.tradeId,
          openingTrade,
          clock,
          false,
        );
        if (!system.ok) throw new CompletedTradeTransactionFailure(system);
        systemStatus = 'no_trade';
      } else if (input.systemResult?.status === 'resolved') {
        const { status: _status, ...resolution } = input.systemResult;
        const system = await resolveSystemTradeInTx(
          tx,
          workspaceId,
          userId,
          created.tradeId,
          openingTrade,
          resolution,
          clock,
          false,
        );
        if (!system.ok) throw new CompletedTradeTransactionFailure(system);
        systemStatus = 'resolved';
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
          systemStatus,
          exitCount: input.exits.length,
          ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
          ...(input.setupId !== undefined ? { setupId: input.setupId } : {}),
        },
      });

      const finished = await tx.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
      if (finished === undefined) {
        throw new Error('createCompletedTrade: finished Trade could not be re-read');
      }
      return successFromRow(finished, false);
    });
  } catch (error) {
    if (error instanceof CompletedTradeTransactionFailure) {
      result = error.result;
    } else if (error instanceof SetupConditionSnapshotFailure) {
      result = { ok: false, code: error.code };
    } else {
      throw error;
    }
  }

  if (!result.ok) await cleanupOrphanChart(input);
  return result;
}
