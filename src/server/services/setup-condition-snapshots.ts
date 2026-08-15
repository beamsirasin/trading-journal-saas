import 'server-only';

import { and, eq } from 'drizzle-orm';

import {
  prepareSetupConditionSnapshots,
  type SetupConditionAnswer,
} from '@/lib/setup-conditions/snapshots';
import type { Database } from '@/server/db/client';
import { setupConditions, trades, tradeSetupConditionChecks } from '@/server/db/schema';

type Executor = Pick<Database, 'select' | 'insert'>;

export type SnapshotTradeSetupConditionsResult =
  | { readonly ok: true; readonly count: number }
  | {
      readonly ok: false;
      readonly code:
        | 'trade_not_found'
        | 'trade_setup_version_mismatch'
        | 'duplicate_condition_answer'
        | 'unknown_condition_answer'
        | 'incomplete_condition_answers'
        | 'invalid_condition_status';
    };

/**
 * Phase 13C-ready transaction primitive. The caller supplies the same
 * transaction that created and pinned the Trade, after the existing Trade
 * creation lock order has completed. Phase 13B deliberately does not call it.
 */
export async function snapshotTradeSetupConditionsInTx(
  tx: Executor,
  params: {
    readonly workspaceId: string;
    readonly tradeId: string;
    readonly setupVersionId: string;
    readonly answers: readonly SetupConditionAnswer[];
  },
): Promise<SnapshotTradeSetupConditionsResult> {
  const [trade] = await tx
    .select({ setupVersionId: trades.setupVersionId })
    .from(trades)
    .where(and(eq(trades.id, params.tradeId), eq(trades.workspaceId, params.workspaceId)));
  if (trade === undefined) return { ok: false, code: 'trade_not_found' };
  if (trade.setupVersionId !== params.setupVersionId) {
    return { ok: false, code: 'trade_setup_version_mismatch' };
  }

  const authoritative = await tx
    .select({
      id: setupConditions.id,
      conditionKey: setupConditions.conditionKey,
      label: setupConditions.label,
      sortOrder: setupConditions.sortOrder,
    })
    .from(setupConditions)
    .where(
      and(
        eq(setupConditions.workspaceId, params.workspaceId),
        eq(setupConditions.setupVersionId, params.setupVersionId),
      ),
    );
  const prepared = prepareSetupConditionSnapshots(authoritative, params.answers);
  if (!prepared.ok) return prepared;
  if (prepared.snapshots.length === 0) return { ok: true, count: 0 };

  await tx.insert(tradeSetupConditionChecks).values(
    prepared.snapshots.map((snapshot) => ({
      workspaceId: params.workspaceId,
      tradeId: params.tradeId,
      setupConditionId: snapshot.id,
      setupVersionId: params.setupVersionId,
      conditionKey: snapshot.conditionKey,
      label: snapshot.label,
      sortOrder: snapshot.sortOrder,
      checkStatus: snapshot.checkStatus,
    })),
  );
  return { ok: true, count: prepared.snapshots.length };
}
