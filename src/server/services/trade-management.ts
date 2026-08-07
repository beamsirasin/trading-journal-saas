import 'server-only';

import { and, eq } from 'drizzle-orm';

import { CALC_VERSION } from '@/config/trade-calc';
import { composePlanned, composeSystemResolve, composeTraderClose } from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { authorizeWorkspaceMutation, type MutationDenialReason } from '@/lib/entitlements/resolve';
import { systemClock, type Clock } from '@/lib/time';
import { isSystemExitReason, isTradeDirection, type TradeStatus } from '@/lib/trades/constants';
import { normalizeOptionalText, normalizeRequiredText } from '@/lib/trades/validation';
import { getDb, type Database } from '@/server/db/client';
import {
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeRuleChecks,
  trades,
  tradingAccounts,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { lockAndResolveEntitlement } from './entitlement';
import { lockStrategyVersionForReferenceInTx } from './strategy-versioning';
import {
  canCancelFromStatus,
  canCloseFromStatus,
  canOpenFromStatus,
  hasActualExecution,
  matchesCloseRetry,
  matchesSystemResolveRetry,
  resolvePlanFieldsPatch,
  type PlanFieldsPatch,
} from './trade-recalculation';

/**
 * Phase 08B — Trade domain services and lifecycle. No DAL, Server Action, or
 * UI exists yet (Phase 08C/D's job); every function here takes
 * `workspaceId`/`actorUserId` already resolved from the session by a future
 * caller (never client input — CLAUDE.md §4) and independently re-verifies
 * active membership and entitlement itself, the same defense-in-depth
 * posture `strategy-management.ts`/`trading-account-management.ts` already
 * establish. This file must not be trusted to run correctly merely because a
 * future Server Action layer also happens to check authorization first.
 *
 * ## Canonical create-transaction lock order
 *
 * `createTrade` acquires locks in exactly this order — extending, not
 * replacing, Phase 06's canonical order (`strategy-management.ts`'s own
 * module comment):
 *
 * 1. Owning `workspaces` row `FOR UPDATE`.
 * 2. Active workspace membership verification (plain read).
 * 3. Exact workspace-scoped `mutation_key` replay lookup — BEFORE
 *    entitlement, so a successful create whose response was lost stays
 *    safely replayable even if the workspace later became
 *    `read_only`/`over_limit` (identical reasoning to `createStrategy`).
 * 4. Canonical entitlement resolution/authorization (`'ordinary_write'`) —
 *    only reached on a genuine cache miss in step 3.
 * 5. Trading Account: a plain scoped read + archived check. NOT locked
 *    `FOR UPDATE` — creating a Trade never mutates `trading_accounts`, and
 *    the workspace-row lock (step 1) already serializes every
 *    workspace-scoped mutation, so there is nothing left for a row lock on
 *    an unrelated table to additionally protect.
 * 6. `strategies` identity row `FOR UPDATE` + archived check.
 * 7. Read `current_version_id` — only AFTER the Strategy row lock (step 6),
 *    so a transaction that queued behind a concurrent Strategy edit re-reads
 *    the true current Version once it unblocks, never a stale pointer read
 *    before queuing (the exact reasoning `strategy-management.ts`'s
 *    `lockCurrentVersionRow` documents).
 * 8. The Strategy's current `strategy_versions` row `FOR UPDATE`.
 * 9. `setups` identity row: a plain scoped read + archived check. NOT locked
 *    `FOR UPDATE` — same reasoning as step 5; the Strategy/Version locks
 *    above already serialize everything a Setup read needs protected
 *    against for this transaction's purposes.
 * 10. Resolve the `strategy_setup_versions` snapshot belonging to BOTH the
 *     selected Setup identity AND the locked current Strategy Version — the
 *     one query that proves the client's Setup selection is genuinely
 *     available inside the Version this Trade is about to pin.
 * 11. `lockStrategyVersionForReferenceInTx` (`strategy-versioning.ts`,
 *     already built in Phase 06) — locks the Version this Trade references,
 *     idempotently, exactly once per Version's lifetime.
 * 12. Insert the Trade row.
 * 13. Snapshot every applicable `strategy_rules` row into `trade_rule_checks`
 *     (`not_checked`).
 * 14. Write the `trade.created` audit event.
 *
 * No function in this file ever acquires a later-numbered lock before an
 * earlier one, so nothing here can deadlock against `strategy-management.ts`
 * or `trading-account-management.ts` — all three lock the SAME `workspaces`
 * row first.
 *
 * ## Post-create mutations
 *
 * Every mutation on an EXISTING Trade (open/close/cancel/system
 * resolve/no_trade/correction/rule-check/mistake/soft-delete) uses the
 * lighter, shared `acquireTradeWriteContext`: workspace `FOR UPDATE` +
 * membership + entitlement (`'ordinary_write'`) + the Trade row itself
 * `FOR UPDATE`, scoped by `(id, workspace_id)`, treating a soft-deleted Trade
 * as not-found. `trade-discipline.ts` imports and reuses this SAME helper
 * rather than re-implementing its own copy — the one canonical
 * lock/membership/authorization pattern for this domain, not a second one.
 *
 * ## No aggregate calculations
 *
 * Nothing in this file calls `src/lib/calc/{aggregate,attribution,equity}.ts`
 * — those are Phase 09's read-path job, over already-persisted snapshots.
 * Only the per-Trade composers (`composePlanned`/`composeTraderClose`/
 * `composeSystemResolve`) and `classifyOutcome` are ever called here, and
 * always as the SOLE source of a derived value — no formula is ever
 * hand-duplicated at a call site in this file.
 */

/** Structurally matches both a Drizzle transaction handle and the plain database. */
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'query'>;

export type WorkspaceAccessDenial = 'workspace_access_denied' | MutationDenialReason;

type TradeRow = typeof trades.$inferSelect;
type StrategyRow = typeof strategies.$inferSelect;
type StrategyVersionRow = typeof strategyVersions.$inferSelect;

// ---------------------------------------------------------------------------
// Shared lock/membership/authorization helpers
// ---------------------------------------------------------------------------

async function lockWorkspaceRow(tx: Executor, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  return row !== undefined;
}

async function verifyActiveMembership(
  tx: Executor,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function resolveMutationDenial(
  tx: Parameters<typeof lockAndResolveEntitlement>[0],
  workspaceId: string,
  clock: Clock,
): Promise<MutationDenialReason | null> {
  const entitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
  const decision = authorizeWorkspaceMutation(
    entitlement.ok ? entitlement.effective : null,
    'ordinary_write',
  );
  return decision.allowed ? null : decision.code;
}

/**
 * Lock order steps 1–2. A trusted `workspaceId` is expected to always
 * resolve to a real row (session-derived, never client input); a missing row
 * is an unreachable programming error, not a normal denial.
 *
 * Split from entitlement resolution specifically for `createTrade`'s
 * idempotency-replay exception — see the module comment.
 */
async function lockWorkspaceAndVerifyMembership(
  tx: Executor,
  workspaceId: string,
  userId: string,
): Promise<'workspace_access_denied' | null> {
  const exists = await lockWorkspaceRow(tx, workspaceId);
  if (!exists) {
    throw new Error(`trade-management: workspace ${workspaceId} not found`);
  }
  const isMember = await verifyActiveMembership(tx, workspaceId, userId);
  if (!isMember) return 'workspace_access_denied';
  return null;
}

/** Lock order steps 1–4, composed — the common case for every mutation on an EXISTING Trade. */
async function acquireWorkspaceWriteAccess(
  tx: Executor,
  workspaceId: string,
  userId: string,
  clock: Clock,
): Promise<WorkspaceAccessDenial | null> {
  const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
  if (membershipDenial !== null) return membershipDenial;
  return resolveMutationDenial(tx, workspaceId, clock);
}

/**
 * Locks the Trade row `FOR UPDATE`, scoped to this workspace. A soft-deleted
 * Trade (`deleted_at IS NOT NULL`) is treated as not-found — "after soft
 * deletion, all further Trade mutations are denied/not-found" (locked Phase
 * 08B decision) — EXCEPT `softDeleteTrade` itself, which uses its own,
 * separate lookup so a repeated soft-delete can still succeed as a no-op.
 */
async function lockTradeRow(
  tx: Executor,
  workspaceId: string,
  tradeId: string,
): Promise<
  | { readonly ok: true; readonly trade: TradeRow }
  | { readonly ok: false; readonly code: 'trade_not_found' }
> {
  const [row] = await tx
    .select()
    .from(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId)))
    .for('update');
  if (row === undefined || row.deletedAt !== null) return { ok: false, code: 'trade_not_found' };
  return { ok: true, trade: row };
}

/**
 * The one canonical lock/membership/authorization/trade-lookup sequence for
 * every mutation on an EXISTING Trade. `trade-discipline.ts` imports and
 * calls this SAME function — see the module comment's "Post-create
 * mutations" section.
 */
export async function acquireTradeWriteContext(
  tx: Executor,
  params: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly tradeId: string;
    readonly clock: Clock;
  },
): Promise<
  | { readonly ok: true; readonly trade: TradeRow }
  | { readonly ok: false; readonly code: WorkspaceAccessDenial | 'trade_not_found' }
> {
  const { workspaceId, userId, tradeId, clock } = params;
  const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
  if (denial !== null) return { ok: false, code: denial };
  return lockTradeRow(tx, workspaceId, tradeId);
}

// ---------------------------------------------------------------------------
// createTrade — local copies of Phase 06's Strategy/Version lock helpers.
// Not imported: `strategy-management.ts` does not export them (module-private
// by design there), so a new domain needing the same lock semantics owns its
// own copies rather than reaching into another domain's internals — the same
// posture `trading-account-management.ts` already takes toward
// `strategy-management.ts`.
// ---------------------------------------------------------------------------

async function lockStrategyRowForTrade(
  tx: Executor,
  workspaceId: string,
  strategyId: string,
): Promise<
  | { readonly ok: true; readonly strategy: StrategyRow }
  | { readonly ok: false; readonly code: 'strategy_not_found' }
> {
  const [strategy] = await tx
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), eq(strategies.workspaceId, workspaceId)))
    .for('update');
  if (strategy === undefined) return { ok: false, code: 'strategy_not_found' };
  return { ok: true, strategy };
}

async function lockCurrentVersionRowForTrade(
  tx: Executor,
  strategy: StrategyRow,
): Promise<
  | { readonly ok: true; readonly version: StrategyVersionRow }
  | { readonly ok: false; readonly code: 'strategy_current_version_missing' }
> {
  if (strategy.currentVersionId === null) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }
  const [version] = await tx
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, strategy.currentVersionId))
    .for('update');
  if (version === undefined) {
    return { ok: false, code: 'strategy_current_version_missing' };
  }
  return { ok: true, version };
}

/**
 * Inserts one `not_checked` `trade_rule_checks` row for every applicable
 * `strategy_rules` row in the pinned Strategy Version: every Strategy-level
 * Rule (`setup_version_id IS NULL`) PLUS every Rule scoped to the selected
 * Setup Version specifically — never another Setup's Rules within the same
 * Version. Only ever called from the fresh-insert branch of `createTrade`,
 * never the mutation-key-replay branch, so a replay can never produce
 * duplicate snapshots.
 */
async function insertRuleSnapshotsInTx(
  tx: Executor,
  params: {
    readonly workspaceId: string;
    readonly tradeId: string;
    readonly strategyVersionId: string;
    readonly setupVersionId: string;
  },
): Promise<void> {
  const { workspaceId, tradeId, strategyVersionId, setupVersionId } = params;

  const applicableRules = await tx
    .select()
    .from(strategyRules)
    .where(eq(strategyRules.strategyVersionId, strategyVersionId));

  const snapshots = applicableRules.filter(
    (rule) => rule.setupVersionId === null || rule.setupVersionId === setupVersionId,
  );
  if (snapshots.length === 0) return;

  await tx.insert(tradeRuleChecks).values(
    snapshots.map((rule) => ({
      workspaceId,
      tradeId,
      strategyRuleId: rule.id,
      strategyVersionId: rule.strategyVersionId,
      ruleKey: rule.ruleKey,
      checkStatus: 'not_checked' as const,
      title: rule.title,
      category: rule.category,
      isRequired: rule.isRequired,
      isPreTradeCheck: rule.isPreTradeCheck,
      sortOrder: rule.sortOrder,
    })),
  );
}

// ---------------------------------------------------------------------------
// 1. createTrade
// ---------------------------------------------------------------------------

export interface CreateTradeInput {
  readonly mutationKey: string;
  readonly tradingAccountId: string;
  readonly strategyId: string;
  readonly setupId: string;
  readonly symbol: string;
  readonly direction: string;
  readonly plannedEntry: string;
  readonly plannedStop: string;
  /** Optional (locked Phase 08B decision) — a Trade may have a Plan with no Target. */
  readonly plannedTarget?: string | null;
  readonly plannedPositionSize?: string | null;
  readonly timeframe?: string | null;
  readonly session?: string | null;
  readonly confirmationNotes?: string | null;
  readonly confidence?: number | null;
  readonly tradingviewUrl?: string | null;
  readonly notes?: string | null;
}

export type CreateTradeErrorCode =
  | WorkspaceAccessDenial
  | 'blank_symbol'
  | 'invalid_direction'
  | 'invalid_plan'
  | 'trading_account_not_found'
  | 'trading_account_archived'
  | 'strategy_not_found'
  | 'strategy_archived'
  | 'strategy_current_version_missing'
  | 'setup_not_found'
  | 'setup_archived'
  | 'setup_snapshot_missing';

export type CreateTradeResult =
  | { readonly ok: true; readonly tradeId: string; readonly alreadyCreated: boolean }
  | {
      readonly ok: false;
      readonly code: CreateTradeErrorCode;
      readonly calcReason?: CalcFailureReason;
    };

/**
 * See the module comment's "Canonical create-transaction lock order" for the
 * full 14-step sequence this function implements. `strategy_version_id`/
 * `setup_version_id` are NEVER accepted from the caller — only
 * `strategyId`/`setupId` (identity) are; this function alone resolves and
 * pins the current Version of each, under lock, exactly once.
 */
export async function createTrade(
  workspaceId: string,
  userId: string,
  input: CreateTradeInput,
  clock: Clock = systemClock,
): Promise<CreateTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Steps 1–2.
    const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
    if (membershipDenial !== null) return { ok: false, code: membershipDenial };

    // Step 3 — exact workspace-scoped mutation-key replay lookup, BEFORE
    // entitlement. The replay request's mutable Plan fields are never
    // compared against the stored Trade — they may legitimately have
    // changed since the original create (locked Phase 08B decision).
    const existing = await tx.query.trades.findFirst({
      where: and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, input.mutationKey)),
    });
    if (existing !== undefined) {
      return { ok: true, tradeId: existing.id, alreadyCreated: true };
    }

    // Step 4.
    const denial = await resolveMutationDenial(tx, workspaceId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const symbol = normalizeRequiredText(input.symbol);
    if (!symbol.ok) return { ok: false, code: 'blank_symbol' };
    if (!isTradeDirection(input.direction)) return { ok: false, code: 'invalid_direction' };

    // Validate the Plan's risk shape unconditionally (Target-independent);
    // compute planned_r via composePlanned ONLY when a Target was supplied —
    // composePlanned's own `missing_input` for an absent Target is not a
    // Trade-creation failure (locked Phase 08B decision), so it is never
    // even called in that case; plannedR is stored as null instead. Never
    // hand-duplicates the risk-per-unit formula: composePlanned/its shared
    // risk-context validation are the only source.
    let plannedR: string | null = null;
    if (input.plannedTarget !== null && input.plannedTarget !== undefined) {
      const composed = composePlanned(
        input.direction,
        input.plannedEntry,
        input.plannedStop,
        input.plannedTarget,
      );
      if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
      plannedR = composed.value.plannedR;
    } else {
      // No Target: still validate entry/stop shape by itself, reusing the
      // same composePlanned call with a synthetic check — done via the risk
      // context `composePlanned` builds internally is not directly
      // reachable here without a Target, so validate through `classifyOutcome`
      // is not applicable either. Reuse composePlanned is not possible
      // without a target; fall back to the same underlying primitive it
      // uses for risk validation.
      const riskOnly = composePlanned(input.direction, input.plannedEntry, input.plannedStop, '0');
      // A synthetic Target of '0' only exists to exercise risk-per-unit
      // validation; a real `invalid_target_direction`/`missing_input`
      // failure caused by the synthetic value itself must never leak out —
      // only risk-shape failures (missing_input for entry/stop/direction,
      // invalid_decimal, invalid_direction, zero_risk, invalid_risk_direction)
      // are genuine Trade-creation failures in the no-Target case.
      if (!riskOnly.ok && isRiskShapeFailure(riskOnly.reason)) {
        return { ok: false, code: 'invalid_plan', calcReason: riskOnly.reason };
      }
    }

    // Step 5 — plain scoped read, not FOR UPDATE (see module comment).
    const account = await tx.query.tradingAccounts.findFirst({
      where: and(
        eq(tradingAccounts.id, input.tradingAccountId),
        eq(tradingAccounts.workspaceId, workspaceId),
      ),
    });
    if (account === undefined) return { ok: false, code: 'trading_account_not_found' };
    if (account.isArchived) return { ok: false, code: 'trading_account_archived' };

    // Step 6.
    const strategyLock = await lockStrategyRowForTrade(tx, workspaceId, input.strategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

    // Steps 7–8.
    const versionLock = await lockCurrentVersionRowForTrade(tx, strategyLock.strategy);
    if (!versionLock.ok) return versionLock;
    const version = versionLock.version;

    // Step 9 — plain scoped read, not FOR UPDATE (see module comment).
    const setup = await tx.query.setups.findFirst({
      where: and(
        eq(setups.id, input.setupId),
        eq(setups.workspaceId, workspaceId),
        eq(setups.strategyId, input.strategyId),
      ),
    });
    if (setup === undefined) return { ok: false, code: 'setup_not_found' };
    if (setup.isArchived) return { ok: false, code: 'setup_archived' };

    // Step 10.
    const setupVersion = await tx.query.strategySetupVersions.findFirst({
      where: and(
        eq(strategySetupVersions.strategyVersionId, version.id),
        eq(strategySetupVersions.setupId, setup.id),
      ),
    });
    if (setupVersion === undefined) return { ok: false, code: 'setup_snapshot_missing' };

    // Step 11.
    const lockResult = await lockStrategyVersionForReferenceInTx(
      tx,
      { workspaceId, strategyId: input.strategyId, versionId: version.id, actorUserId: userId },
      clock,
    );
    if (!lockResult.ok) return lockResult;

    // Step 12.
    const inserted = await tx
      .insert(trades)
      .values({
        workspaceId,
        mutationKey: input.mutationKey,
        tradingAccountId: input.tradingAccountId,
        strategyId: input.strategyId,
        strategyVersionId: version.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        symbol: symbol.value,
        direction: input.direction,
        timeframe: normalizeOptionalText(input.timeframe),
        session: normalizeOptionalText(input.session),
        confirmationNotes: normalizeOptionalText(input.confirmationNotes),
        confidence: input.confidence ?? null,
        tradingviewUrl: normalizeOptionalText(input.tradingviewUrl),
        notes: normalizeOptionalText(input.notes),
        plannedEntry: input.plannedEntry,
        plannedStop: input.plannedStop,
        plannedTarget: input.plannedTarget ?? null,
        plannedPositionSize: input.plannedPositionSize ?? null,
        plannedR,
      })
      .onConflictDoNothing({ target: [trades.workspaceId, trades.mutationKey] })
      .returning({ id: trades.id });

    const created = inserted[0];
    if (created === undefined) {
      // Unreachable given the workspace-row-serialized idempotency check
      // above — kept as a defensive re-read, matching createStrategy's own
      // posture on an impossible conflict.
      const raced = await tx.query.trades.findFirst({
        where: and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, input.mutationKey)),
      });
      if (raced === undefined) {
        throw new Error(
          `createTrade: conflict reported but no row found for mutation key in workspace ${workspaceId}`,
        );
      }
      return { ok: true, tradeId: raced.id, alreadyCreated: true };
    }

    // Step 13.
    await insertRuleSnapshotsInTx(tx, {
      workspaceId,
      tradeId: created.id,
      strategyVersionId: version.id,
      setupVersionId: setupVersion.id,
    });

    // Step 14.
    await insertAuditLog(tx, {
      action: 'trade.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: created.id,
      metadata: {
        tradeId: created.id,
        tradingAccountId: input.tradingAccountId,
        strategyId: input.strategyId,
        strategyVersionId: version.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
      },
    });

    return { ok: true, tradeId: created.id, alreadyCreated: false };
  });
}

/** The risk-shape-only subset of `CalcFailureReason` — genuine failures even when no Target is supplied. */
function isRiskShapeFailure(reason: CalcFailureReason): boolean {
  return (
    reason === 'missing_input' ||
    reason === 'invalid_decimal' ||
    reason === 'invalid_direction' ||
    reason === 'zero_risk' ||
    reason === 'invalid_risk_direction'
  );
}

// ---------------------------------------------------------------------------
// 2. updateTradePlan
// ---------------------------------------------------------------------------

export interface UpdateTradePlanInput extends PlanFieldsPatch {
  readonly plannedPositionSize?: string | null;
  readonly timeframe?: string | null;
  readonly session?: string | null;
  readonly confirmationNotes?: string | null;
  readonly confidence?: number | null;
  readonly tradingviewUrl?: string | null;
  readonly notes?: string | null;
}

export type UpdateTradePlanResult =
  | { readonly ok: true; readonly changedFields: readonly string[] }
  | {
      readonly ok: false;
      readonly code: WorkspaceAccessDenial | 'trade_not_found' | 'invalid_plan';
      readonly calcReason?: CalcFailureReason;
    };

/**
 * Plan and context fields are never gated by Trade status — a Trade remains
 * a correctable measurement record at every lifecycle stage (CLAUDE.md
 * A7/`docs/data-dictionary.md`). Recomputes `planned_r` whenever entry/stop/
 * target participate in this edit, and `system_r`/`system_outcome` whenever
 * entry or stop actually change AND System is `resolved` (Target never
 * affects the System formula) — see the correction/recalculation matrix in
 * the locked Phase 08B decisions. All validation happens before any write,
 * so an invalid correction is rejected atomically with nothing persisted.
 */
export async function updateTradePlan(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: UpdateTradePlanInput,
  clock: Clock = systemClock,
): Promise<UpdateTradePlanResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    const resolved = resolvePlanFieldsPatch(
      {
        plannedEntry: trade.plannedEntry,
        plannedStop: trade.plannedStop,
        plannedTarget: trade.plannedTarget,
      },
      input,
    );

    let plannedR = trade.plannedR;
    let systemR = trade.systemR;
    let systemOutcome = trade.systemOutcome;
    let calcVersionBump = false;

    if (resolved.planFieldsTouched) {
      if (resolved.plannedTarget === null) {
        plannedR = null;
      } else {
        const composed = composePlanned(
          trade.direction,
          resolved.plannedEntry,
          resolved.plannedStop,
          resolved.plannedTarget,
        );
        if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
        plannedR = composed.value.plannedR;
      }

      if (resolved.entryOrStopChanged && trade.systemStatus === 'resolved') {
        const composedSystem = composeSystemResolve(
          trade.direction,
          resolved.plannedEntry,
          resolved.plannedStop,
          trade.systemExitPrice,
          trade.systemCostR,
        );
        if (!composedSystem.ok) {
          return { ok: false, code: 'invalid_plan', calcReason: composedSystem.reason };
        }
        systemR = composedSystem.value.systemR;
        systemOutcome = composedSystem.value.systemOutcome;
        calcVersionBump = true;
      }
    }

    const nextPlannedPositionSize =
      'plannedPositionSize' in input
        ? (input.plannedPositionSize ?? null)
        : trade.plannedPositionSize;
    const nextTimeframe =
      'timeframe' in input ? normalizeOptionalText(input.timeframe) : trade.timeframe;
    const nextSession = 'session' in input ? normalizeOptionalText(input.session) : trade.session;
    const nextConfirmationNotes =
      'confirmationNotes' in input
        ? normalizeOptionalText(input.confirmationNotes)
        : trade.confirmationNotes;
    const nextConfidence = 'confidence' in input ? (input.confidence ?? null) : trade.confidence;
    const nextTradingviewUrl =
      'tradingviewUrl' in input
        ? normalizeOptionalText(input.tradingviewUrl)
        : trade.tradingviewUrl;
    const nextNotes = 'notes' in input ? normalizeOptionalText(input.notes) : trade.notes;

    const changedFields: string[] = [];
    if (resolved.plannedEntry !== trade.plannedEntry) changedFields.push('plannedEntry');
    if (resolved.plannedStop !== trade.plannedStop) changedFields.push('plannedStop');
    if (resolved.plannedTarget !== trade.plannedTarget) changedFields.push('plannedTarget');
    if (nextPlannedPositionSize !== trade.plannedPositionSize)
      changedFields.push('plannedPositionSize');
    if (nextTimeframe !== trade.timeframe) changedFields.push('timeframe');
    if (nextSession !== trade.session) changedFields.push('session');
    if (nextConfirmationNotes !== trade.confirmationNotes) changedFields.push('confirmationNotes');
    if (nextConfidence !== trade.confidence) changedFields.push('confidence');
    if (nextTradingviewUrl !== trade.tradingviewUrl) changedFields.push('tradingviewUrl');
    if (nextNotes !== trade.notes) changedFields.push('notes');
    if (plannedR !== trade.plannedR) changedFields.push('plannedR');
    if (systemR !== trade.systemR) changedFields.push('systemR');

    if (changedFields.length === 0) return { ok: true, changedFields: [] };

    await tx
      .update(trades)
      .set({
        plannedEntry: resolved.plannedEntry,
        plannedStop: resolved.plannedStop,
        plannedTarget: resolved.plannedTarget,
        plannedPositionSize: nextPlannedPositionSize,
        timeframe: nextTimeframe,
        session: nextSession,
        confirmationNotes: nextConfirmationNotes,
        confidence: nextConfidence,
        tradingviewUrl: nextTradingviewUrl,
        notes: nextNotes,
        plannedR,
        systemR,
        systemOutcome,
        ...(calcVersionBump ? { calcVersion: CALC_VERSION } : {}),
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.plan_updated',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, changedFields },
    });

    return { ok: true, changedFields };
  });
}

// ---------------------------------------------------------------------------
// 3. correctTradeIdentity — Symbol/Direction
// ---------------------------------------------------------------------------

export interface CorrectTradeIdentityInput {
  readonly symbol?: string;
  readonly direction?: string;
  /**
   * A Direction flip against a FIXED Entry/Stop pair is mathematically
   * never valid: `long` requires `stop < entry` and `short` requires
   * `stop > entry` — strict negations of each other for any entry ≠ stop, so
   * exactly one direction is ever valid for a given price pair, never both.
   * A genuine Direction correction therefore almost always needs the trader
   * to also supply the Entry/Stop values that are actually correct for the
   * intended direction — accepted here, optionally, rather than forcing a
   * separate `updateTradePlan` call that would itself be transiently invalid
   * against the not-yet-corrected Direction.
   */
  readonly plannedEntry?: string;
  readonly plannedStop?: string;
}

export type CorrectTradeIdentityResult =
  | { readonly ok: true; readonly changedFields: readonly string[] }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'blank_symbol'
        | 'invalid_direction'
        | 'invalid_plan';
      readonly calcReason?: CalcFailureReason;
    };

/**
 * A dedicated correction operation, deliberately NOT folded into
 * `updateTradePlan` or a generic update-everything mutation (locked Phase
 * 08B decision) — a Direction correction has a distinct, non-obvious
 * recompute cascade (it can invalidate the Plan's risk-per-unit sign
 * entirely, unlike any Plan-field edit), so it deserves its own explicit,
 * narrowly-scoped entry point. Actual R never recomputes here — it does not
 * depend on Direction (CLAUDE.md §6: Actual R divides authoritative
 * bigints, never prices).
 */
export async function correctTradeIdentity(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: CorrectTradeIdentityInput,
  clock: Clock = systemClock,
): Promise<CorrectTradeIdentityResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    let nextSymbol = trade.symbol;
    if (input.symbol !== undefined) {
      const normalized = normalizeRequiredText(input.symbol);
      if (!normalized.ok) return { ok: false, code: 'blank_symbol' };
      nextSymbol = normalized.value;
    }

    let nextDirection = trade.direction;
    let nextEntry = trade.plannedEntry;
    let nextStop = trade.plannedStop;
    let plannedR = trade.plannedR;
    let systemR = trade.systemR;
    let systemOutcome = trade.systemOutcome;
    let calcVersionBump = false;

    const directionChanged = input.direction !== undefined && input.direction !== trade.direction;
    const entryStopTouched = input.plannedEntry !== undefined || input.plannedStop !== undefined;

    if (directionChanged && !isTradeDirection(input.direction as string)) {
      return { ok: false, code: 'invalid_direction' };
    }
    if (directionChanged) nextDirection = input.direction as string;
    if (input.plannedEntry !== undefined) nextEntry = input.plannedEntry;
    if (input.plannedStop !== undefined) nextStop = input.plannedStop;

    if (directionChanged || entryStopTouched) {
      if (trade.plannedTarget === null) {
        // Still must validate the risk shape holds under the new direction/prices.
        const riskOnly = composePlanned(nextDirection, nextEntry, nextStop, '0');
        if (!riskOnly.ok && isRiskShapeFailure(riskOnly.reason)) {
          return { ok: false, code: 'invalid_plan', calcReason: riskOnly.reason };
        }
        plannedR = null;
      } else {
        const composed = composePlanned(nextDirection, nextEntry, nextStop, trade.plannedTarget);
        if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
        plannedR = composed.value.plannedR;
      }

      if (trade.systemStatus === 'resolved') {
        const composedSystem = composeSystemResolve(
          nextDirection,
          nextEntry,
          nextStop,
          trade.systemExitPrice,
          trade.systemCostR,
        );
        if (!composedSystem.ok) {
          return { ok: false, code: 'invalid_plan', calcReason: composedSystem.reason };
        }
        systemR = composedSystem.value.systemR;
        systemOutcome = composedSystem.value.systemOutcome;
        calcVersionBump = true;
      }
    }

    const changedFields: string[] = [];
    if (nextSymbol !== trade.symbol) changedFields.push('symbol');
    if (nextDirection !== trade.direction) changedFields.push('direction');
    if (nextEntry !== trade.plannedEntry) changedFields.push('plannedEntry');
    if (nextStop !== trade.plannedStop) changedFields.push('plannedStop');
    if (plannedR !== trade.plannedR) changedFields.push('plannedR');
    if (systemR !== trade.systemR) changedFields.push('systemR');

    if (changedFields.length === 0) return { ok: true, changedFields: [] };

    await tx
      .update(trades)
      .set({
        symbol: nextSymbol,
        direction: nextDirection,
        plannedEntry: nextEntry,
        plannedStop: nextStop,
        plannedR,
        systemR,
        systemOutcome,
        ...(calcVersionBump ? { calcVersion: CALC_VERSION } : {}),
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.corrected',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, changedFields },
    });

    return { ok: true, changedFields };
  });
}

// ---------------------------------------------------------------------------
// 4. openTrade
// ---------------------------------------------------------------------------

export interface OpenTradeInput {
  readonly actualEntry: string;
  readonly actualInitialStop: string;
  readonly actualInitialRiskMinor: bigint;
  readonly actualPositionSize?: string | null;
  readonly enteredAt: Date;
}

export type OpenTradeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_status_transition'
        | 'invalid_initial_risk'
        | 'trading_account_not_found'
        | 'trading_account_archived'
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'setup_not_found'
        | 'setup_archived';
    };

/**
 * `planned -> open` only. Rechecks the pinned Trading Account/Strategy/Setup
 * for archival AGAIN at Open time (locked Phase 08B decision) — a Trade may
 * sit `planned` for a long time, and a parent could be archived in the
 * meantime; Open is the one transition that re-verifies, Create is the
 * other. Does not require every Rule Check to be answered (locked decision).
 * `actual_initial_risk_minor` is never derived from price — an authoritative
 * client-supplied bigint, validated only for strict positivity here.
 */
export async function openTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: OpenTradeInput,
  clock: Clock = systemClock,
): Promise<OpenTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    if (!canOpenFromStatus(trade.status as TradeStatus)) {
      return { ok: false, code: 'invalid_status_transition' };
    }
    if (input.actualInitialRiskMinor <= 0n) return { ok: false, code: 'invalid_initial_risk' };

    const account = await tx.query.tradingAccounts.findFirst({
      where: and(
        eq(tradingAccounts.id, trade.tradingAccountId),
        eq(tradingAccounts.workspaceId, workspaceId),
      ),
    });
    if (account === undefined) return { ok: false, code: 'trading_account_not_found' };
    if (account.isArchived) return { ok: false, code: 'trading_account_archived' };

    const strategy = await tx.query.strategies.findFirst({
      where: and(eq(strategies.id, trade.strategyId), eq(strategies.workspaceId, workspaceId)),
    });
    if (strategy === undefined) return { ok: false, code: 'strategy_not_found' };
    if (strategy.isArchived) return { ok: false, code: 'strategy_archived' };

    const setup = await tx.query.setups.findFirst({
      where: and(eq(setups.id, trade.setupId), eq(setups.workspaceId, workspaceId)),
    });
    if (setup === undefined) return { ok: false, code: 'setup_not_found' };
    if (setup.isArchived) return { ok: false, code: 'setup_archived' };

    await tx
      .update(trades)
      .set({
        actualEntry: input.actualEntry,
        actualInitialStop: input.actualInitialStop,
        actualInitialRiskMinor: input.actualInitialRiskMinor,
        actualPositionSize: input.actualPositionSize ?? null,
        enteredAt: input.enteredAt,
        status: 'open',
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.opened',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'planned', newStatus: 'open' },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 5. closeTrade
// ---------------------------------------------------------------------------

export interface CloseTradeInput {
  readonly actualExit: string;
  readonly netPnlMinor: bigint;
  readonly exitedAt: Date;
  readonly grossPnlMinor?: bigint | null;
  readonly commissionMinor?: bigint;
  readonly feesMinor?: bigint;
  readonly swapMinor?: bigint;
}

export type CloseTradeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_status_transition'
        | 'invalid_exit_time';
      readonly calcReason?: CalcFailureReason;
    };

/**
 * `open -> closed` only, and `closed` never reopens. An EXACT terminal-state
 * retry (identical `actualExit`/`netPnlMinor`/`exitedAt`) against an
 * already-`closed` Trade returns success as a no-op; ANY other request
 * against an already-`closed` Trade — including a differing but otherwise
 * legitimate correction — returns `invalid_status_transition`, directing the
 * caller toward `correctTradeExecution` (locked Phase 08B decision:
 * `closeTrade` itself never performs a correction).
 */
export async function closeTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: CloseTradeInput,
  clock: Clock = systemClock,
): Promise<CloseTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    if (trade.status === 'closed') {
      if (
        trade.actualExit !== null &&
        trade.netPnlMinor !== null &&
        trade.exitedAt !== null &&
        matchesCloseRetry(
          {
            actualExit: trade.actualExit,
            netPnlMinor: trade.netPnlMinor,
            exitedAt: trade.exitedAt,
          },
          input,
        )
      ) {
        return { ok: true };
      }
      return { ok: false, code: 'invalid_status_transition' };
    }
    if (!canCloseFromStatus(trade.status as TradeStatus)) {
      return { ok: false, code: 'invalid_status_transition' };
    }
    if (trade.enteredAt !== null && input.exitedAt.getTime() < trade.enteredAt.getTime()) {
      return { ok: false, code: 'invalid_exit_time' };
    }

    const composed = composeTraderClose(input.netPnlMinor, trade.actualInitialRiskMinor);
    if (!composed.ok)
      return { ok: false, code: 'invalid_status_transition', calcReason: composed.reason };

    await tx
      .update(trades)
      .set({
        actualExit: input.actualExit,
        netPnlMinor: input.netPnlMinor,
        exitedAt: input.exitedAt,
        grossPnlMinor: input.grossPnlMinor ?? trade.grossPnlMinor,
        commissionMinor: input.commissionMinor ?? trade.commissionMinor,
        feesMinor: input.feesMinor ?? trade.feesMinor,
        swapMinor: input.swapMinor ?? trade.swapMinor,
        actualR: composed.value.actualR,
        traderOutcome: composed.value.traderOutcome,
        calcVersion: composed.value.calcVersion,
        status: 'closed',
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.closed',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'open', newStatus: 'closed' },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 6. cancelTrade
// ---------------------------------------------------------------------------

export type CancelTradeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: WorkspaceAccessDenial | 'trade_not_found' | 'invalid_status_transition';
    };

/**
 * `planned -> canceled` only. `open -> canceled` and `closed -> canceled` are
 * both forbidden (locked Phase 08B decision) — once an actual entry exists,
 * the Trade can never be hidden from Trader performance by canceling it; a
 * genuinely erroneous record uses soft deletion instead. Repeating an
 * already-`canceled` cancellation is a safe no-op.
 */
export async function cancelTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  clock: Clock = systemClock,
): Promise<CancelTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    if (trade.status === 'canceled') return { ok: true };
    if (!canCancelFromStatus(trade.status as TradeStatus)) {
      return { ok: false, code: 'invalid_status_transition' };
    }

    await tx
      .update(trades)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.canceled',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'planned', newStatus: 'canceled' },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 7. correctTradeExecution
// ---------------------------------------------------------------------------

export interface CorrectTradeExecutionInput {
  readonly actualEntry?: string;
  readonly actualInitialStop?: string;
  readonly actualInitialRiskMinor?: bigint;
  readonly actualPositionSize?: string | null;
  readonly enteredAt?: Date;
  readonly actualExit?: string;
  readonly netPnlMinor?: bigint;
  readonly exitedAt?: Date;
  readonly grossPnlMinor?: bigint | null;
  readonly commissionMinor?: bigint;
  readonly feesMinor?: bigint;
  readonly swapMinor?: bigint;
}

export type CorrectTradeExecutionResult =
  | { readonly ok: true; readonly changedFields: readonly string[] }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'no_actual_execution'
        | 'invalid_status_transition'
        | 'invalid_initial_risk'
        | 'invalid_exit_time';
      readonly calcReason?: CalcFailureReason;
    };

const CLOSE_SET_KEYS = [
  'actualExit',
  'netPnlMinor',
  'exitedAt',
  'grossPnlMinor',
  'commissionMinor',
  'feesMinor',
  'swapMinor',
] as const;

/**
 * The legitimate typo-correction path for the Actual-execution side, while
 * `open` (no Actual R exists yet — nothing to recompute) or `closed`
 * (recomputes `actual_r`/`trader_outcome` via `composeTraderClose` whenever
 * `actual_initial_risk_minor` or `net_pnl_minor` changes — the correction
 * matrix's exact rule). `actual_exit` itself never drives a calculation —
 * `net_pnl_minor` is already authoritative net P&L — but remains a
 * correctable primitive. Commission/fees/swap are informational only and
 * never automatically alter `net_pnl_minor`. All validation happens before
 * any write, so an invalid correction never partially persists.
 */
export async function correctTradeExecution(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: CorrectTradeExecutionInput,
  clock: Clock = systemClock,
): Promise<CorrectTradeExecutionResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    const status = trade.status as TradeStatus;
    if (!hasActualExecution(status)) return { ok: false, code: 'no_actual_execution' };

    const closeSetProvided = CLOSE_SET_KEYS.some((key) => input[key] !== undefined);
    if (status === 'open' && closeSetProvided) {
      return { ok: false, code: 'invalid_status_transition' };
    }

    const nextActualEntry = input.actualEntry ?? trade.actualEntry;
    const nextActualInitialStop = input.actualInitialStop ?? trade.actualInitialStop;
    const nextActualInitialRiskMinor = input.actualInitialRiskMinor ?? trade.actualInitialRiskMinor;
    const nextActualPositionSize =
      'actualPositionSize' in input ? (input.actualPositionSize ?? null) : trade.actualPositionSize;
    const nextEnteredAt = input.enteredAt ?? trade.enteredAt;

    if (input.actualInitialRiskMinor !== undefined && input.actualInitialRiskMinor <= 0n) {
      return { ok: false, code: 'invalid_initial_risk' };
    }

    let nextActualExit = trade.actualExit;
    let nextNetPnlMinor = trade.netPnlMinor;
    let nextExitedAt = trade.exitedAt;
    let nextGrossPnlMinor = trade.grossPnlMinor;
    let nextCommissionMinor = trade.commissionMinor;
    let nextFeesMinor = trade.feesMinor;
    let nextSwapMinor = trade.swapMinor;
    let actualR = trade.actualR;
    let traderOutcome = trade.traderOutcome;
    let calcVersion = trade.calcVersion;

    if (status === 'closed') {
      nextActualExit = input.actualExit ?? trade.actualExit;
      nextNetPnlMinor = input.netPnlMinor ?? trade.netPnlMinor;
      nextExitedAt = input.exitedAt ?? trade.exitedAt;
      nextGrossPnlMinor =
        'grossPnlMinor' in input ? (input.grossPnlMinor ?? null) : trade.grossPnlMinor;
      nextCommissionMinor = input.commissionMinor ?? trade.commissionMinor;
      nextFeesMinor = input.feesMinor ?? trade.feesMinor;
      nextSwapMinor = input.swapMinor ?? trade.swapMinor;

      if (
        nextEnteredAt !== null &&
        nextExitedAt !== null &&
        nextExitedAt.getTime() < nextEnteredAt.getTime()
      ) {
        return { ok: false, code: 'invalid_exit_time' };
      }

      const riskChanged =
        input.actualInitialRiskMinor !== undefined &&
        input.actualInitialRiskMinor !== trade.actualInitialRiskMinor;
      const pnlChanged = input.netPnlMinor !== undefined && input.netPnlMinor !== trade.netPnlMinor;
      if (riskChanged || pnlChanged) {
        const composed = composeTraderClose(nextNetPnlMinor, nextActualInitialRiskMinor);
        if (!composed.ok) {
          return { ok: false, code: 'invalid_initial_risk', calcReason: composed.reason };
        }
        actualR = composed.value.actualR;
        traderOutcome = composed.value.traderOutcome;
        calcVersion = composed.value.calcVersion;
      }
    }

    const changedFields: string[] = [];
    if (nextActualEntry !== trade.actualEntry) changedFields.push('actualEntry');
    if (nextActualInitialStop !== trade.actualInitialStop) changedFields.push('actualInitialStop');
    if (nextActualInitialRiskMinor !== trade.actualInitialRiskMinor)
      changedFields.push('actualInitialRiskMinor');
    if (nextActualPositionSize !== trade.actualPositionSize)
      changedFields.push('actualPositionSize');
    if (nextEnteredAt?.getTime() !== trade.enteredAt?.getTime()) changedFields.push('enteredAt');
    if (nextActualExit !== trade.actualExit) changedFields.push('actualExit');
    if (nextNetPnlMinor !== trade.netPnlMinor) changedFields.push('netPnlMinor');
    if (nextExitedAt?.getTime() !== trade.exitedAt?.getTime()) changedFields.push('exitedAt');
    if (nextGrossPnlMinor !== trade.grossPnlMinor) changedFields.push('grossPnlMinor');
    if (nextCommissionMinor !== trade.commissionMinor) changedFields.push('commissionMinor');
    if (nextFeesMinor !== trade.feesMinor) changedFields.push('feesMinor');
    if (nextSwapMinor !== trade.swapMinor) changedFields.push('swapMinor');
    if (actualR !== trade.actualR) changedFields.push('actualR');

    if (changedFields.length === 0) return { ok: true, changedFields: [] };

    await tx
      .update(trades)
      .set({
        actualEntry: nextActualEntry,
        actualInitialStop: nextActualInitialStop,
        actualInitialRiskMinor: nextActualInitialRiskMinor,
        actualPositionSize: nextActualPositionSize,
        enteredAt: nextEnteredAt,
        actualExit: nextActualExit,
        netPnlMinor: nextNetPnlMinor,
        exitedAt: nextExitedAt,
        grossPnlMinor: nextGrossPnlMinor,
        commissionMinor: nextCommissionMinor,
        feesMinor: nextFeesMinor,
        swapMinor: nextSwapMinor,
        actualR,
        traderOutcome,
        calcVersion,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.corrected',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, changedFields },
    });

    return { ok: true, changedFields };
  });
}

// ---------------------------------------------------------------------------
// 8. resolveSystemTrade
// ---------------------------------------------------------------------------

export interface ResolveSystemTradeInput {
  readonly systemExitPrice: string;
  readonly systemExitedAt: Date;
  readonly systemExitReason: string;
  readonly systemCostR: string;
}

export type ResolveSystemTradeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_system_status_transition'
        | 'invalid_system_exit_reason';
      readonly calcReason?: CalcFailureReason;
    };

/**
 * `pending -> resolved` only — the normal path. An EXACT retry (identical
 * primitive inputs) against an already-`resolved` Trade succeeds as a
 * no-op; any OTHER call against a non-`pending` System status returns
 * `invalid_system_status_transition`, directing the caller to
 * `correctSystemResolution` (which also covers `no_trade -> resolved`).
 * `system_exit_reason = 'setup_invalidated'` is exclusive to `no_trade` and
 * rejected here.
 */
export async function resolveSystemTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: ResolveSystemTradeInput,
  clock: Clock = systemClock,
): Promise<ResolveSystemTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    if (trade.systemStatus === 'resolved') {
      if (
        trade.systemExitPrice !== null &&
        trade.systemExitedAt !== null &&
        trade.systemExitReason !== null &&
        matchesSystemResolveRetry(
          {
            systemExitPrice: trade.systemExitPrice,
            systemExitedAt: trade.systemExitedAt,
            systemExitReason: trade.systemExitReason,
            systemCostR: trade.systemCostR,
          },
          input,
        )
      ) {
        return { ok: true };
      }
      return { ok: false, code: 'invalid_system_status_transition' };
    }
    if (trade.systemStatus !== 'pending') {
      return { ok: false, code: 'invalid_system_status_transition' };
    }
    if (
      !isSystemExitReason(input.systemExitReason) ||
      input.systemExitReason === 'setup_invalidated'
    ) {
      return { ok: false, code: 'invalid_system_exit_reason' };
    }

    const composed = composeSystemResolve(
      trade.direction,
      trade.plannedEntry,
      trade.plannedStop,
      input.systemExitPrice,
      input.systemCostR,
    );
    if (!composed.ok) {
      return { ok: false, code: 'invalid_system_status_transition', calcReason: composed.reason };
    }

    await tx
      .update(trades)
      .set({
        systemStatus: 'resolved',
        systemExitPrice: input.systemExitPrice,
        systemExitedAt: input.systemExitedAt,
        systemExitReason: input.systemExitReason,
        systemCostR: input.systemCostR,
        systemResolvedAt: clock.now(),
        systemR: composed.value.systemR,
        systemOutcome: composed.value.systemOutcome,
        calcVersion: composed.value.calcVersion,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.system_resolved',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'pending', newStatus: 'resolved' },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 9. markSystemNoTrade
// ---------------------------------------------------------------------------

export type MarkSystemNoTradeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: WorkspaceAccessDenial | 'trade_not_found' | 'invalid_system_status_transition';
    };

/** `pending -> no_trade` only. An exact repeat (already `no_trade`) is a safe no-op. */
export async function markSystemNoTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  clock: Clock = systemClock,
): Promise<MarkSystemNoTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    if (trade.systemStatus === 'no_trade') return { ok: true };
    if (trade.systemStatus !== 'pending') {
      return { ok: false, code: 'invalid_system_status_transition' };
    }

    await tx
      .update(trades)
      .set({
        systemStatus: 'no_trade',
        systemExitPrice: null,
        systemExitedAt: null,
        systemExitReason: 'setup_invalidated',
        systemCostR: '0',
        systemResolvedAt: clock.now(),
        systemR: null,
        systemOutcome: null,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.system_no_trade',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'pending', newStatus: 'no_trade' },
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 10. correctSystemResolution
// ---------------------------------------------------------------------------

export type CorrectSystemResolutionInput =
  | {
      readonly target: 'resolved';
      readonly systemExitPrice: string;
      readonly systemExitedAt: Date;
      readonly systemExitReason: string;
      readonly systemCostR: string;
    }
  | { readonly target: 'no_trade' };

export type CorrectSystemResolutionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_system_status_transition'
        | 'invalid_system_exit_reason';
      readonly calcReason?: CalcFailureReason;
    };

/**
 * The explicit correction path for the System axis, covering exactly three
 * transitions: `resolved -> resolved` (corrected primitive inputs),
 * `resolved -> no_trade`, and `no_trade -> resolved`. Never reverts terminal
 * System state to `pending` — that target does not exist in
 * {@link CorrectSystemResolutionInput}'s type, so it is structurally
 * unreachable, not merely runtime-checked. Requires `system_status` to
 * already be `resolved` or `no_trade` — a `pending` Trade has nothing to
 * correct yet and must use `resolveSystemTrade`/`markSystemNoTrade` instead.
 */
export async function correctSystemResolution(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: CorrectSystemResolutionInput,
  clock: Clock = systemClock,
): Promise<CorrectSystemResolutionResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    if (trade.systemStatus !== 'resolved' && trade.systemStatus !== 'no_trade') {
      return { ok: false, code: 'invalid_system_status_transition' };
    }

    const previousStatus = trade.systemStatus;

    if (input.target === 'no_trade') {
      await tx
        .update(trades)
        .set({
          systemStatus: 'no_trade',
          systemExitPrice: null,
          systemExitedAt: null,
          systemExitReason: 'setup_invalidated',
          systemCostR: '0',
          systemResolvedAt: clock.now(),
          systemR: null,
          systemOutcome: null,
          updatedAt: new Date(),
        })
        .where(eq(trades.id, tradeId));

      await insertAuditLog(tx, {
        action: 'trade.corrected',
        workspaceId,
        actorUserId: userId,
        entityType: 'trade',
        entityId: tradeId,
        metadata: {
          tradeId,
          previousStatus,
          newStatus: 'no_trade',
          changedFields: ['systemStatus', 'systemExitReason', 'systemR', 'systemOutcome'],
        },
      });
      return { ok: true };
    }

    if (
      !isSystemExitReason(input.systemExitReason) ||
      input.systemExitReason === 'setup_invalidated'
    ) {
      return { ok: false, code: 'invalid_system_exit_reason' };
    }

    const composed = composeSystemResolve(
      trade.direction,
      trade.plannedEntry,
      trade.plannedStop,
      input.systemExitPrice,
      input.systemCostR,
    );
    if (!composed.ok) {
      return { ok: false, code: 'invalid_system_status_transition', calcReason: composed.reason };
    }

    await tx
      .update(trades)
      .set({
        systemStatus: 'resolved',
        systemExitPrice: input.systemExitPrice,
        systemExitedAt: input.systemExitedAt,
        systemExitReason: input.systemExitReason,
        systemCostR: input.systemCostR,
        systemResolvedAt: clock.now(),
        systemR: composed.value.systemR,
        systemOutcome: composed.value.systemOutcome,
        calcVersion: composed.value.calcVersion,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.corrected',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: {
        tradeId,
        previousStatus,
        newStatus: 'resolved',
        changedFields: [
          'systemStatus',
          'systemExitPrice',
          'systemExitedAt',
          'systemExitReason',
          'systemCostR',
          'systemR',
          'systemOutcome',
        ],
      },
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 11. softDeleteTrade
// ---------------------------------------------------------------------------

export type SoftDeleteTradeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: WorkspaceAccessDenial | 'trade_not_found' };

/**
 * Sets `deleted_at`; never hard-deletes. Deliberately does NOT use the
 * shared `lockTradeRow` (which treats an already-soft-deleted Trade as
 * not-found) — a repeated soft-delete must succeed as a no-op, matching
 * every other lifecycle operation's idempotency posture in this codebase.
 * No restore operation exists (locked Phase 08B decision).
 */
export async function softDeleteTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  clock: Clock = systemClock,
): Promise<SoftDeleteTradeResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };

    const [row] = await tx
      .select()
      .from(trades)
      .where(and(eq(trades.id, tradeId), eq(trades.workspaceId, workspaceId)))
      .for('update');
    if (row === undefined) return { ok: false, code: 'trade_not_found' };
    if (row.deletedAt !== null) return { ok: true };

    await tx
      .update(trades)
      .set({ deletedAt: clock.now(), updatedAt: new Date() })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.deleted',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId },
    });

    return { ok: true };
  });
}
