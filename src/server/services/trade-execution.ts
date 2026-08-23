import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { composeRealizedActual, composeTraderCloseV2 } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { systemClock, type Clock } from '@/lib/time';
import { CLOSED_BPS_TOTAL, type OutcomeValue } from '@/lib/trades/constants';
import { normalizeOptionalText } from '@/lib/trades/validation';
import { getDb, type Database } from '@/server/db/client';
import { tradeExits, trades } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { acquireTradeWriteContext, type WorkspaceAccessDenial } from './trade-management';

export type TradeExecutionTx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Tx = TradeExecutionTx;
type TradeRow = typeof trades.$inferSelect;
type ExitRow = typeof tradeExits.$inferSelect;

export interface AddTradeExitInput {
  readonly mutationKey: string;
  readonly closedBps: number;
  readonly exitPrice?: string | null;
  readonly realizedPnlMinor?: bigint | null;
  readonly exitReason?: string | null;
  readonly exitedAt: Date;
}

export type TradeExitMutationResult =
  | {
      readonly ok: true;
      readonly exitId: string;
      readonly alreadyAdded: boolean;
      readonly status: 'open' | 'closed';
      readonly closedBps: number;
      readonly remainingBps: number;
      readonly realizedR: string;
      readonly actualR: string | null;
      readonly traderOutcome: OutcomeValue | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_status_transition'
        | 'invalid_closed_bps'
        | 'invalid_exit_shape'
        | 'invalid_exit_time';
      readonly calcReason?: CalcFailureReason;
    };

function calculationInput(trade: typeof trades.$inferSelect, exits: readonly ExitRow[]) {
  return {
    actualResultMode: trade.actualResultMode,
    direction: trade.direction,
    actualEntry: trade.actualEntry,
    actualInitialStop: trade.actualInitialStop,
    actualInitialRiskMinor: trade.actualInitialRiskMinor,
    exits: exits.map((exit) => ({
      closedBps: exit.closedBps,
      exitPrice: exit.exitPrice,
      realizedPnlMinor: exit.realizedPnlMinor,
    })),
  };
}

function finalExit(exits: readonly ExitRow[]): ExitRow {
  return [...exits].sort(
    (a, b) =>
      b.exitedAt.getTime() - a.exitedAt.getTime() ||
      b.sequence - a.sequence ||
      b.id.localeCompare(a.id),
  )[0]!;
}

function validateExitShape(mode: string | null, input: AddTradeExitInput): boolean {
  if (mode === 'price') {
    return input.exitPrice != null && input.realizedPnlMinor == null;
  }
  return mode === 'money' && input.realizedPnlMinor != null;
}

async function currentExits(tx: Tx, tradeId: string): Promise<ExitRow[]> {
  return tx
    .select()
    .from(tradeExits)
    .where(eq(tradeExits.tradeId, tradeId))
    .orderBy(asc(tradeExits.sequence), asc(tradeExits.id));
}

async function persistAggregate(
  tx: Tx,
  trade: typeof trades.$inferSelect,
  exits: readonly ExitRow[],
  now: Date,
) {
  const realized = composeRealizedActual(calculationInput(trade, exits));
  if (!realized.ok) return realized;
  const isFinal = realized.value.closedBps === CLOSED_BPS_TOTAL;
  if (!isFinal) {
    await tx
      .update(trades)
      .set({
        actualExit: null,
        netPnlMinor: null,
        exitedAt: null,
        actualR: null,
        traderOutcome: null,
        updatedAt: now,
      })
      .where(eq(trades.id, trade.id));
    return { ok: true as const, realized: realized.value, final: null };
  }

  const snapshot = composeTraderCloseV2(calculationInput(trade, exits));
  if (!snapshot.ok) return snapshot;
  const chronologicalFinal = finalExit(exits);
  await tx
    .update(trades)
    .set({
      status: 'closed',
      actualExit: chronologicalFinal.exitPrice,
      netPnlMinor: realized.value.realizedPnlMinor,
      exitedAt: chronologicalFinal.exitedAt,
      actualR: snapshot.value.actualR,
      traderOutcome: snapshot.value.traderOutcome,
      calcVersion: snapshot.value.calcVersion,
      updatedAt: now,
    })
    .where(eq(trades.id, trade.id));
  return { ok: true as const, realized: realized.value, final: snapshot.value };
}

export interface AddTradeExitInTxOptions {
  readonly closeRemaining?: boolean;
  /**
   * A row created and owned by the SAME outer transaction. Supplying it
   * deliberately skips the existing-Trade authorization/lock boundary so a
   * completed create authorizes exactly once, before any persistence.
   */
  readonly trustedTrade?: TradeRow;
  /** Public exit mutations keep their lifecycle events; atomic completed
   * creation suppresses them and emits one truthful top-level event instead. */
  readonly emitAudit?: boolean;
}

export async function addTradeExitInTx(
  tx: Tx,
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: AddTradeExitInput,
  clock: Clock,
  options: AddTradeExitInTxOptions = {},
): Promise<TradeExitMutationResult> {
  let trade: TradeRow;
  if (options.trustedTrade !== undefined) {
    if (options.trustedTrade.id !== tradeId || options.trustedTrade.workspaceId !== workspaceId) {
      throw new Error('addTradeExitInTx: trusted Trade scope mismatch');
    }
    trade = options.trustedTrade;
  } else {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    trade = ctx.trade;
  }

  const replay = await tx.query.tradeExits.findFirst({
    where: and(
      eq(tradeExits.workspaceId, workspaceId),
      eq(tradeExits.mutationKey, input.mutationKey),
    ),
  });
  if (replay !== undefined) {
    if (replay.tradeId !== tradeId) return { ok: false, code: 'invalid_status_transition' };
    const exits = await currentExits(tx, tradeId);
    const realized = composeRealizedActual(calculationInput(trade, exits));
    if (!realized.ok) return { ok: false, code: 'invalid_exit_shape', calcReason: realized.reason };
    return {
      ok: true,
      exitId: replay.id,
      alreadyAdded: true,
      status: trade.status as 'open' | 'closed',
      closedBps: realized.value.closedBps,
      remainingBps: CLOSED_BPS_TOTAL - realized.value.closedBps,
      realizedR: realized.value.realizedR,
      actualR: trade.actualR,
      traderOutcome: trade.traderOutcome as OutcomeValue | null,
    };
  }
  if (trade.status !== 'open') return { ok: false, code: 'invalid_status_transition' };
  if (trade.enteredAt === null || input.exitedAt.getTime() < trade.enteredAt.getTime()) {
    return { ok: false, code: 'invalid_exit_time' };
  }
  if (!validateExitShape(trade.actualResultMode, input)) {
    return { ok: false, code: 'invalid_exit_shape' };
  }

  const exits = await currentExits(tx, tradeId);
  const alreadyClosed = exits.reduce((total, exit) => total + exit.closedBps, 0);
  const remaining = CLOSED_BPS_TOTAL - alreadyClosed;
  const closedBps = options.closeRemaining === true ? remaining : input.closedBps;
  if (!Number.isSafeInteger(closedBps) || closedBps <= 0 || closedBps > remaining) {
    return { ok: false, code: 'invalid_closed_bps' };
  }
  const sequence = exits.reduce((highest, exit) => Math.max(highest, exit.sequence), 0) + 1;
  const [inserted] = await tx
    .insert(tradeExits)
    .values({
      workspaceId,
      tradeId,
      mutationKey: input.mutationKey,
      sequence,
      closedBps,
      exitPrice: input.exitPrice ?? null,
      realizedPnlMinor: input.realizedPnlMinor ?? null,
      exitReason: normalizeOptionalText(input.exitReason),
      exitedAt: input.exitedAt,
      updatedAt: clock.now(),
    })
    .returning();
  if (inserted === undefined) throw new Error('addTradeExit: insert returned no row');

  const allExits = [...exits, inserted];
  const aggregate = await persistAggregate(tx, trade, allExits, clock.now());
  if (!aggregate.ok) return { ok: false, code: 'invalid_exit_shape', calcReason: aggregate.reason };
  if (options.emitAudit !== false) {
    await insertAuditLog(tx, {
      action: 'trade.exit_added',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade_exit',
      entityId: inserted.id,
      metadata: { tradeId, exitId: inserted.id, sequence, closedBps },
    });
    if (aggregate.final !== null) {
      await insertAuditLog(tx, {
        action: 'trade.closed',
        workspaceId,
        actorUserId: userId,
        entityType: 'trade',
        entityId: tradeId,
        metadata: { tradeId, previousStatus: 'open', newStatus: 'closed' },
      });
    }
  }
  return {
    ok: true,
    exitId: inserted.id,
    alreadyAdded: false,
    status: aggregate.final === null ? 'open' : 'closed',
    closedBps: aggregate.realized.closedBps,
    remainingBps: CLOSED_BPS_TOTAL - aggregate.realized.closedBps,
    realizedR: aggregate.realized.realizedR,
    actualR: aggregate.final?.actualR ?? null,
    traderOutcome: aggregate.final?.traderOutcome ?? null,
  };
}

export async function addTradeExit(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: AddTradeExitInput,
  clock: Clock = systemClock,
): Promise<TradeExitMutationResult> {
  return getDb().transaction((tx) =>
    addTradeExitInTx(tx, workspaceId, userId, tradeId, input, clock),
  );
}

export async function closeRemainingTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: Omit<AddTradeExitInput, 'closedBps'>,
  clock: Clock = systemClock,
): Promise<TradeExitMutationResult> {
  return getDb().transaction((tx) =>
    addTradeExitInTx(tx, workspaceId, userId, tradeId, { ...input, closedBps: 1 }, clock, {
      closeRemaining: true,
    }),
  );
}

export interface CorrectTradeExitInput {
  readonly closedBps: number;
  readonly exitPrice?: string | null;
  readonly realizedPnlMinor?: bigint | null;
  readonly exitReason?: string | null;
  readonly exitedAt: Date;
}

export async function correctTradeExit(
  workspaceId: string,
  userId: string,
  tradeId: string,
  exitId: string,
  input: CorrectTradeExitInput,
  clock: Clock = systemClock,
): Promise<TradeExitMutationResult> {
  return getDb().transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;
    if (trade.status !== 'open' && trade.status !== 'closed') {
      return { ok: false, code: 'invalid_status_transition' };
    }
    if (trade.enteredAt === null || input.exitedAt.getTime() < trade.enteredAt.getTime()) {
      return { ok: false, code: 'invalid_exit_time' };
    }
    if (!validateExitShape(trade.actualResultMode, { ...input, mutationKey: exitId })) {
      return { ok: false, code: 'invalid_exit_shape' };
    }
    const exits = await currentExits(tx, tradeId);
    const existing = exits.find((exit) => exit.id === exitId);
    if (existing === undefined) return { ok: false, code: 'trade_not_found' };
    const corrected: ExitRow = {
      ...existing,
      closedBps: input.closedBps,
      exitPrice: input.exitPrice ?? null,
      realizedPnlMinor: input.realizedPnlMinor ?? null,
      exitReason: normalizeOptionalText(input.exitReason),
      exitedAt: input.exitedAt,
      updatedAt: clock.now(),
    };
    const allExits = exits.map((exit) => (exit.id === exitId ? corrected : exit));
    const total = allExits.reduce((sum, exit) => sum + exit.closedBps, 0);
    if (
      !Number.isSafeInteger(input.closedBps) ||
      input.closedBps <= 0 ||
      input.closedBps > CLOSED_BPS_TOTAL ||
      (trade.status === 'open' && total >= CLOSED_BPS_TOTAL) ||
      (trade.status === 'closed' && total !== CLOSED_BPS_TOTAL)
    ) {
      return { ok: false, code: 'invalid_closed_bps' };
    }
    await tx
      .update(tradeExits)
      .set({
        closedBps: corrected.closedBps,
        exitPrice: corrected.exitPrice,
        realizedPnlMinor: corrected.realizedPnlMinor,
        exitReason: corrected.exitReason,
        exitedAt: corrected.exitedAt,
        updatedAt: corrected.updatedAt,
      })
      .where(
        and(
          eq(tradeExits.id, exitId),
          eq(tradeExits.tradeId, tradeId),
          eq(tradeExits.workspaceId, workspaceId),
        ),
      );
    const aggregate = await persistAggregate(tx, trade, allExits, clock.now());
    if (!aggregate.ok)
      return { ok: false, code: 'invalid_exit_shape', calcReason: aggregate.reason };
    await insertAuditLog(tx, {
      action: 'trade.exit_corrected',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade_exit',
      entityId: exitId,
      metadata: {
        tradeId,
        exitId,
        changedFields: ['closedBps', 'exitPrice', 'realizedPnlMinor', 'exitReason', 'exitedAt'],
      },
    });
    return {
      ok: true,
      exitId,
      alreadyAdded: false,
      status: trade.status as 'open' | 'closed',
      closedBps: aggregate.realized.closedBps,
      remainingBps: CLOSED_BPS_TOTAL - aggregate.realized.closedBps,
      realizedR: aggregate.realized.realizedR,
      actualR: aggregate.final?.actualR ?? null,
      traderOutcome: aggregate.final?.traderOutcome ?? null,
    };
  });
}
