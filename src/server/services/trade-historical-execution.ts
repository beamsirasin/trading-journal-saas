import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { generateId } from '@/lib/identifiers';
import { systemClock, type Clock } from '@/lib/time';
import type {
  ExitHistoryCompleteness,
  ExitScope,
  FinalPnlSource,
  OutcomeValue,
} from '@/lib/trades/constants';
import {
  adoptHistoricalExitSubtotal as adoptTransition,
  applyHistoricalExitCorrection as correctTransition,
  deriveHistoricalExecutionSnapshot,
  beginHistoricalManualFinalEdit as manualTransition,
  type HistoricalExecutionSnapshot,
  type HistoricalExecutionState,
  type HistoricalReconciliationStatus,
} from '@/lib/trades/historical-execution';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb, type Database } from '@/server/db/client';
import { tradeExits, trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { acquireTradeWriteContext, type WorkspaceAccessDenial } from './trade-management';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type TradeRow = typeof trades.$inferSelect;
type ExitRow = typeof tradeExits.$inferSelect;

export interface HistoricalExitCorrectionInput {
  /** Existing row identity. Omit only for a newly-added supporting leg. */
  readonly exitId?: string;
  readonly closedBps?: number | null;
  readonly exitScope?: ExitScope | null;
  readonly realizedPnlMinor?: bigint | null;
  readonly exitReason?: string | null;
  readonly exitedAt?: Date | null;
}

export interface ApplyHistoricalExitCorrectionInput {
  readonly exitHistoryCompleteness: ExitHistoryCompleteness | null;
  readonly exits: readonly HistoricalExitCorrectionInput[];
}

export interface HistoricalExecutionMutationData {
  readonly tradeId: string;
  readonly netPnlMinor: bigint | null;
  readonly finalPnlSource: FinalPnlSource | null;
  readonly exitHistoryCompleteness: ExitHistoryCompleteness | null;
  readonly exitSubtotalMinor: bigint | null;
  readonly reconciliation: HistoricalReconciliationStatus;
  readonly canAdoptExitSubtotal: boolean;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
}

export type HistoricalExecutionMutationError =
  | WorkspaceAccessDenial
  | 'trade_not_found'
  | 'invalid_status_transition'
  | 'invalid_execution_context'
  | 'invalid_completed_exit_coverage'
  | 'invalid_exit_shape'
  | 'invalid_exit_time'
  | 'exit_history_not_adoptable'
  | 'historical_exit_conflict';

export type HistoricalExecutionMutationResult =
  | ({ readonly ok: true } & HistoricalExecutionMutationData)
  | {
      readonly ok: false;
      readonly code: HistoricalExecutionMutationError;
    };

function stateFromRows(trade: TradeRow, exits: readonly ExitRow[]): HistoricalExecutionState {
  return {
    actualInitialRiskMinor: trade.actualInitialRiskMinor,
    finalPnlMinor: trade.netPnlMinor,
    finalPnlSource: trade.finalPnlSource as FinalPnlSource | null,
    exitHistoryCompleteness: trade.exitHistoryCompleteness as ExitHistoryCompleteness | null,
    exits: exits.map((exit) => ({ realizedPnlMinor: exit.realizedPnlMinor })),
  };
}

function success(
  tradeId: string,
  state: HistoricalExecutionState,
  snapshot: HistoricalExecutionSnapshot,
): HistoricalExecutionMutationResult {
  return {
    ok: true,
    tradeId,
    netPnlMinor: state.finalPnlMinor,
    finalPnlSource: state.finalPnlSource,
    exitHistoryCompleteness: state.exitHistoryCompleteness,
    exitSubtotalMinor: snapshot.exitSubtotalMinor,
    reconciliation: snapshot.reconciliation,
    canAdoptExitSubtotal: snapshot.canAdoptExitSubtotal,
    actualR: snapshot.actualR,
    traderOutcome: snapshot.traderOutcome,
  };
}

async function currentExits(tx: Tx, tradeId: string): Promise<ExitRow[]> {
  return tx
    .select()
    .from(tradeExits)
    .where(eq(tradeExits.tradeId, tradeId))
    .orderBy(asc(tradeExits.sequence), asc(tradeExits.id));
}

function historicalMoneyFailure(trade: TradeRow): HistoricalExecutionMutationError | null {
  if (trade.status !== 'closed') return 'invalid_status_transition';
  if (trade.actualResultMode !== 'money') return 'invalid_execution_context';
  return null;
}

async function persistCanonicalTransition(
  tx: Tx,
  trade: TradeRow,
  state: HistoricalExecutionState,
  snapshot: HistoricalExecutionSnapshot,
  now: Date,
): Promise<void> {
  await tx
    .update(trades)
    .set({
      netPnlMinor: state.finalPnlMinor,
      finalPnlSource: state.finalPnlSource,
      exitHistoryCompleteness: state.exitHistoryCompleteness,
      actualR: snapshot.actualR,
      traderOutcome: snapshot.traderOutcome,
      ...(snapshot.calcVersion === undefined ? {} : { calcVersion: snapshot.calcVersion }),
      updatedAt: now,
    })
    .where(and(eq(trades.id, trade.id), eq(trades.workspaceId, trade.workspaceId)));
}

async function auditCorrection(
  tx: Tx,
  workspaceId: string,
  userId: string,
  tradeId: string,
  changedFields: readonly string[],
  exitCount?: number,
): Promise<void> {
  await insertAuditLog(tx, {
    action: 'trade.corrected',
    workspaceId,
    actorUserId: userId,
    entityType: 'trade',
    entityId: tradeId,
    metadata: {
      tradeId,
      changedFields,
      ...(exitCount === undefined ? {} : { exitCount }),
    },
  });
}

function canonicalChangedFields(
  trade: TradeRow,
  state: HistoricalExecutionState,
  snapshot: HistoricalExecutionSnapshot,
): string[] {
  const changed: string[] = [];
  if (trade.netPnlMinor !== state.finalPnlMinor) changed.push('netPnlMinor');
  if (trade.finalPnlSource !== state.finalPnlSource) changed.push('finalPnlSource');
  if (trade.exitHistoryCompleteness !== state.exitHistoryCompleteness) {
    changed.push('exitHistoryCompleteness');
  }
  if (trade.actualR !== snapshot.actualR) changed.push('actualR');
  if (trade.traderOutcome !== snapshot.traderOutcome) changed.push('traderOutcome');
  return changed;
}

/** Explicitly adopts a declared-complete, fully-priced supporting subtotal. */
export async function adoptHistoricalExitSubtotal(
  workspaceId: string,
  userId: string,
  tradeId: string,
  clock: Clock = systemClock,
): Promise<HistoricalExecutionMutationResult> {
  return getDb().transaction(async (tx): Promise<HistoricalExecutionMutationResult> => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const modeFailure = historicalMoneyFailure(ctx.trade);
    if (modeFailure !== null) return { ok: false, code: modeFailure };

    const exits = await currentExits(tx, tradeId);
    const transition = adoptTransition(stateFromRows(ctx.trade, exits));
    if (!transition.ok) return { ok: false, code: transition.code };

    const now = clock.now();
    await persistCanonicalTransition(tx, ctx.trade, transition.state, transition.snapshot, now);
    await auditCorrection(
      tx,
      workspaceId,
      userId,
      tradeId,
      canonicalChangedFields(ctx.trade, transition.state, transition.snapshot),
      exits.length,
    );
    return success(tradeId, transition.state, transition.snapshot);
  });
}

/** Direct whole-Trade result edit; equality never preserves or grants exit-history ownership. */
export async function editHistoricalFinalResult(
  workspaceId: string,
  userId: string,
  tradeId: string,
  finalPnlMinor: bigint | null,
  clock: Clock = systemClock,
): Promise<HistoricalExecutionMutationResult> {
  return getDb().transaction(async (tx): Promise<HistoricalExecutionMutationResult> => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const modeFailure = historicalMoneyFailure(ctx.trade);
    if (modeFailure !== null) return { ok: false, code: modeFailure };

    const exits = await currentExits(tx, tradeId);
    const transition = manualTransition(stateFromRows(ctx.trade, exits), finalPnlMinor);
    if (!transition.ok) return { ok: false, code: transition.code };

    const now = clock.now();
    await persistCanonicalTransition(tx, ctx.trade, transition.state, transition.snapshot, now);
    await auditCorrection(
      tx,
      workspaceId,
      userId,
      tradeId,
      canonicalChangedFields(ctx.trade, transition.state, transition.snapshot),
    );
    return success(tradeId, transition.state, transition.snapshot);
  });
}

function validateCorrection(
  trade: TradeRow,
  existingExits: readonly ExitRow[],
  input: ApplyHistoricalExitCorrectionInput,
  now: Date,
): HistoricalExecutionMutationError | null {
  if (input.exits.length === 0 && input.exitHistoryCompleteness !== null) {
    return 'invalid_exit_shape';
  }
  if (input.exits.length > 0 && input.exitHistoryCompleteness === null) {
    return 'invalid_exit_shape';
  }

  const existingIds = new Set(existingExits.map((exit) => exit.id));
  const suppliedIds = new Set<string>();
  let knownClosedBps = 0;
  for (const exit of input.exits) {
    if (exit.exitId !== undefined) {
      if (!existingIds.has(exit.exitId) || suppliedIds.has(exit.exitId))
        return 'invalid_exit_shape';
      suppliedIds.add(exit.exitId);
    }
    const meaningful =
      exit.closedBps != null ||
      exit.exitScope != null ||
      exit.realizedPnlMinor != null ||
      exit.exitedAt != null;
    if (!meaningful) return 'invalid_exit_shape';
    if (exit.closedBps != null) {
      if (!Number.isSafeInteger(exit.closedBps) || exit.closedBps <= 0 || exit.closedBps > 10_000) {
        return 'invalid_completed_exit_coverage';
      }
      knownClosedBps += exit.closedBps;
      if (!Number.isSafeInteger(knownClosedBps) || knownClosedBps > 10_000) {
        return 'invalid_completed_exit_coverage';
      }
    }
    const exitedAt = exit.exitedAt ?? null;
    if (
      exitedAt !== null &&
      (exitedAt.getTime() > now.getTime() ||
        (trade.enteredAt !== null && exitedAt.getTime() < trade.enteredAt.getTime()) ||
        (trade.exitedAt !== null && exitedAt.getTime() > trade.exitedAt.getTime()))
    ) {
      return 'invalid_exit_time';
    }
  }
  return null;
}

async function persistExitCorrection(
  tx: Tx,
  trade: TradeRow,
  existingExits: readonly ExitRow[],
  exits: readonly HistoricalExitCorrectionInput[],
  now: Date,
): Promise<void> {
  const retainedIds = exits.flatMap((exit) => (exit.exitId === undefined ? [] : [exit.exitId]));
  const removedIds = existingExits
    .filter((exit) => !retainedIds.includes(exit.id))
    .map((exit) => exit.id);
  if (removedIds.length > 0) {
    await tx.delete(tradeExits).where(inArray(tradeExits.id, removedIds));
  }

  const existingById = new Map(existingExits.map((exit) => [exit.id, exit]));
  const orderedExits = [...exits].sort((left, right) => {
    const delta = (exit: HistoricalExitCorrectionInput) =>
      (exit.closedBps ?? 0) -
      (exit.exitId === undefined ? 0 : (existingById.get(exit.exitId)?.closedBps ?? 0));
    return delta(left) - delta(right);
  });
  // Allocation checks run per row. Applying decreases before increases avoids
  // a false transient >100% while preserving each row's evidence constraint.
  for (const exit of orderedExits) {
    if (exit.exitId === undefined) continue;
    await tx
      .update(tradeExits)
      .set({
        closedBps: exit.closedBps ?? null,
        exitScope: exit.exitScope ?? null,
        exitPrice: null,
        realizedPnlMinor: exit.realizedPnlMinor ?? null,
        exitReason: normalizeOptionalText(exit.exitReason),
        exitedAt: exit.exitedAt ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(tradeExits.id, exit.exitId),
          eq(tradeExits.tradeId, trade.id),
          eq(tradeExits.workspaceId, trade.workspaceId),
        ),
      );
  }

  let nextSequence = existingExits.reduce((maximum, exit) => Math.max(maximum, exit.sequence), 0);
  const newExits = exits.filter((exit) => exit.exitId === undefined);
  if (nextSequence + newExits.length > 32_767) {
    throw new Error('Historical exit sequence exceeds smallint range');
  }
  if (newExits.length > 0) {
    await tx.insert(tradeExits).values(
      newExits.map((exit) => ({
        id: generateId(),
        workspaceId: trade.workspaceId,
        tradeId: trade.id,
        mutationKey: generateId(),
        sequence: ++nextSequence,
        closedBps: exit.closedBps ?? null,
        exitScope: exit.exitScope ?? null,
        exitPrice: null,
        realizedPnlMinor: exit.realizedPnlMinor ?? null,
        exitReason: normalizeOptionalText(exit.exitReason),
        exitedAt: exit.exitedAt ?? null,
        updatedAt: now,
      })),
    );
  }
}

/** Atomically edits/adds/removes supporting historical exit evidence. */
export async function applyHistoricalExitHistoryCorrection(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: ApplyHistoricalExitCorrectionInput,
  clock: Clock = systemClock,
): Promise<HistoricalExecutionMutationResult> {
  return getDb().transaction(async (tx): Promise<HistoricalExecutionMutationResult> => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const modeFailure = historicalMoneyFailure(ctx.trade);
    if (modeFailure !== null) return { ok: false, code: modeFailure };

    const exits = await currentExits(tx, tradeId);
    const now = clock.now();
    const invalid = validateCorrection(ctx.trade, exits, input, now);
    if (invalid !== null) return { ok: false, code: invalid };

    const transition = correctTransition(stateFromRows(ctx.trade, exits), {
      exitHistoryCompleteness: input.exitHistoryCompleteness,
      exits: input.exits.map((exit) => ({ realizedPnlMinor: exit.realizedPnlMinor ?? null })),
    });
    if (!transition.ok) return { ok: false, code: transition.code };

    await persistExitCorrection(tx, ctx.trade, exits, input.exits, now);
    await persistCanonicalTransition(tx, ctx.trade, transition.state, transition.snapshot, now);
    await auditCorrection(
      tx,
      workspaceId,
      userId,
      tradeId,
      ['exits', ...canonicalChangedFields(ctx.trade, transition.state, transition.snapshot)],
      input.exits.length,
    );
    return success(tradeId, transition.state, transition.snapshot);
  });
}

/** Read-side helper for a later UI to offer adoption without mutating persistence. */
export function historicalExecutionView(
  trade: TradeRow,
  exits: readonly ExitRow[],
): HistoricalExecutionSnapshot {
  return deriveHistoricalExecutionSnapshot(stateFromRows(trade, exits));
}
