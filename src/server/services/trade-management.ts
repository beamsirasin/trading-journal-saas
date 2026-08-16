import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { isCanonicalEmotionKey } from '@/config/emotions';
import { CALC_VERSION } from '@/config/trade-calc';
import {
  composePlannedR,
  composeRealizedActual,
  composeSystemResolve,
  composeSystemResolveV2,
  composeTraderCloseV2,
} from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { authorizeWorkspaceMutation, type MutationDenialReason } from '@/lib/entitlements/resolve';
import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import type { SetupConditionAnswer } from '@/lib/setup-conditions/snapshots';
import { getChartAttachmentStorage } from '@/lib/storage/chart-attachment-storage';
import { systemClock, type Clock } from '@/lib/time';
import {
  isSystemExitReason,
  isSystemResolutionKind,
  isTradeDirection,
  type ActualResultMode,
  type OutcomeValue,
  type SystemResolutionKind,
  type TradeStatus,
} from '@/lib/trades/constants';
import { normalizeOptionalText, normalizeRequiredText } from '@/lib/trades/validation';
import { getDb, type Database } from '@/server/db/client';
import {
  emotionTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeExits,
  tradeRuleChecks,
  trades,
  tradingAccounts,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { lockAndResolveEntitlement } from './entitlement';
import { snapshotTradeSetupConditionsInTx } from './setup-condition-snapshots';
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
 * Phase 08B — Trade domain services and lifecycle. The Phase 08C–E
 * DAL/Server Action/UI layers call these functions with `workspaceId`/
 * `actorUserId` resolved from the session (never client input — CLAUDE.md §4),
 * and every service independently re-verifies
 * active membership and entitlement itself, the same defense-in-depth
 * posture `strategy-management.ts`/`trading-account-management.ts` already
 * establish. This file must not be trusted to run correctly merely because a
 * Server Action layer also checks authorization first.
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
 * 11. Compare the opaque Condition-set concurrency token against that
 *     server-resolved Setup Version; stale entry screens stop here.
 * 12. `lockStrategyVersionForReferenceInTx` (`strategy-versioning.ts`,
 *     already built in Phase 06) — locks the Version this Trade references,
 *     idempotently, exactly once per Version's lifetime.
 * 13. Insert the Trade row.
 * 14. Snapshot every applicable `strategy_rules` row into `trade_rule_checks`
 *     (`not_checked`).
 * 15. Validate and snapshot every authoritative Setup Condition with its
 *     explicit `met`/`not_met` answer.
 * 16. Write the `trade.created` audit event. Any Condition failure throws
 *     through the transaction so every create-side write is all-or-nothing.
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
 * Only the per-Trade composers (`composePlannedR`/`composeTraderClose`/
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
  /** Opaque optimistic-concurrency token for the Condition set rendered by the client. */
  readonly conditionSetToken: string;
  /** Stable logical keys plus binary answers only; all snapshot content remains server-owned. */
  readonly conditionAnswers: readonly SetupConditionAnswer[];
  readonly symbol: string;
  readonly direction: string;
  /**
   * Price and Money are independent, both-optional representations of the
   * same Plan (Founder-UAT Trade Plan UX correction slice, migration 0010)
   * — a Trade may supply Price only, Money only, or both. Neither is
   * "required" at this interface's level; `createTrade` itself enforces the
   * "at least one representation" floor (`no_plan_representation`), the
   * same floor `trades_plan_minimum_check` enforces at the database layer.
   */
  readonly plannedEntry?: string | null;
  readonly plannedStop?: string | null;
  /** Optional (locked Phase 08B decision) — a Price plan may have no Target. */
  readonly plannedTarget?: string | null;
  readonly plannedPositionSize?: string | null;
  /** Account-currency minor units, in the Trading Account's own `base_currency`. Reward may be omitted (a Money plan may have no Reward, symmetric with Target). */
  readonly plannedRiskMinor?: bigint | null;
  readonly plannedRewardMinor?: bigint | null;
  readonly timeframe?: string | null;
  readonly session?: string | null;
  readonly confirmationNotes?: string | null;
  readonly confidence?: number | null;
  readonly emotionKeys?: readonly string[];
  readonly tradingviewUrl?: string | null;
  readonly notes?: string | null;
  /**
   * The private object-storage key, already uploaded (via
   * `src/lib/storage/`'s adapter, `access: 'private'`) before this call —
   * `createTrade` never performs the upload itself. If this transaction
   * ultimately fails for any reason, the caller's `createTrade` wrapper
   * best-effort deletes the now-orphaned object (see below) — never a
   * public URL, only this stable private key.
   */
  readonly chartAttachmentStorageKey?: string | null;
}

export type CreateTradeErrorCode =
  | WorkspaceAccessDenial
  | 'blank_symbol'
  | 'invalid_direction'
  | 'invalid_plan'
  | 'no_plan_representation'
  | 'planned_r_mismatch'
  | 'trading_account_not_found'
  | 'trading_account_archived'
  | 'strategy_not_found'
  | 'strategy_archived'
  | 'strategy_current_version_missing'
  | 'setup_not_found'
  | 'setup_archived'
  | 'setup_snapshot_missing'
  | 'stale_setup_conditions'
  | 'duplicate_condition_answer'
  | 'unknown_condition_answer'
  | 'incomplete_condition_answers'
  | 'invalid_condition_status'
  | 'duplicate_emotion_key'
  | 'unknown_emotion_key'
  | 'emotion_type_not_usable';

type SetupConditionInputErrorCode = Extract<
  CreateTradeErrorCode,
  | 'duplicate_condition_answer'
  | 'unknown_condition_answer'
  | 'incomplete_condition_answers'
  | 'invalid_condition_status'
>;

class SetupConditionSnapshotFailure extends Error {
  constructor(readonly code: SetupConditionInputErrorCode) {
    super(code);
    this.name = 'SetupConditionSnapshotFailure';
  }
}

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

  let result: CreateTradeResult;
  try {
    result = await db.transaction(async (tx): Promise<CreateTradeResult> => {
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

      const emotionKeys = input.emotionKeys ?? [];
      if (new Set(emotionKeys).size !== emotionKeys.length) {
        return { ok: false, code: 'duplicate_emotion_key' };
      }
      if (!emotionKeys.every(isCanonicalEmotionKey)) {
        return { ok: false, code: 'unknown_emotion_key' };
      }
      const selectedEmotionTypes =
        emotionKeys.length === 0
          ? []
          : await tx
              .select({
                id: emotionTypes.id,
                key: emotionTypes.key,
                workspaceId: emotionTypes.workspaceId,
              })
              .from(emotionTypes)
              .where(
                and(
                  inArray(emotionTypes.key, emotionKeys),
                  eq(emotionTypes.isSystem, true),
                  eq(emotionTypes.isArchived, false),
                ),
              );
      if (
        selectedEmotionTypes.length !== emotionKeys.length ||
        selectedEmotionTypes.some((emotion) => emotion.workspaceId !== null)
      ) {
        return { ok: false, code: 'emotion_type_not_usable' };
      }

      const symbol = normalizeRequiredText(input.symbol);
      if (!symbol.ok) return { ok: false, code: 'blank_symbol' };
      if (!isTradeDirection(input.direction)) return { ok: false, code: 'invalid_direction' };

      // The Founder-UAT "minimum plan validity" floor (migration 0010) — the
      // same invariant `trades_plan_minimum_check` enforces at the database
      // layer, checked here first so its dedicated error code is never masked
      // by a generic `invalid_plan`/`missing_input`.
      const hasPricePlan =
        input.plannedEntry !== null &&
        input.plannedEntry !== undefined &&
        input.plannedStop !== null &&
        input.plannedStop !== undefined;
      const hasMoneyPlan = input.plannedRiskMinor !== null && input.plannedRiskMinor !== undefined;
      if (!hasPricePlan && !hasMoneyPlan) {
        return { ok: false, code: 'no_plan_representation' };
      }

      // `composePlannedR` validates whichever representation(s) are present
      // (never hand-duplicating the risk-per-unit/Money-ratio formulas) and
      // detects a Price/Money disagreement rather than silently picking one —
      // see `src/lib/calc/trade.ts`'s own doc comment.
      const composed = composePlannedR({
        direction: input.direction,
        plannedEntry: input.plannedEntry ?? null,
        plannedStop: input.plannedStop ?? null,
        plannedTarget: input.plannedTarget ?? null,
        plannedRiskMinor: input.plannedRiskMinor ?? null,
        plannedRewardMinor: input.plannedRewardMinor ?? null,
      });
      if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
      if (composed.value.mismatch) return { ok: false, code: 'planned_r_mismatch' };
      const plannedR = composed.value.plannedR;

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
      if (input.conditionSetToken !== createConditionSetToken(setupVersion.id)) {
        return { ok: false, code: 'stale_setup_conditions' };
      }

      // Step 12.
      const lockResult = await lockStrategyVersionForReferenceInTx(
        tx,
        { workspaceId, strategyId: input.strategyId, versionId: version.id, actorUserId: userId },
        clock,
      );
      if (!lockResult.ok) return lockResult;

      // Step 13.
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
          emotionsRecordedAt: clock.now(),
          tradingviewUrl: normalizeOptionalText(input.tradingviewUrl),
          notes: normalizeOptionalText(input.notes),
          chartAttachmentStorageKey: input.chartAttachmentStorageKey ?? null,
          chartAttachmentUploadedAt: input.chartAttachmentStorageKey ? clock.now() : null,
          plannedEntry: input.plannedEntry ?? null,
          plannedStop: input.plannedStop ?? null,
          plannedTarget: input.plannedTarget ?? null,
          plannedPositionSize: input.plannedPositionSize ?? null,
          plannedRiskMinor: input.plannedRiskMinor ?? null,
          plannedRewardMinor: input.plannedRewardMinor ?? null,
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
          where: and(
            eq(trades.workspaceId, workspaceId),
            eq(trades.mutationKey, input.mutationKey),
          ),
        });
        if (raced === undefined) {
          throw new Error(
            `createTrade: conflict reported but no row found for mutation key in workspace ${workspaceId}`,
          );
        }
        return { ok: true, tradeId: raced.id, alreadyCreated: true };
      }

      // Step 14.
      const conditionSnapshots = await snapshotTradeSetupConditionsInTx(tx, {
        workspaceId,
        tradeId: created.id,
        setupVersionId: setupVersion.id,
        answers: input.conditionAnswers,
      });
      if (!conditionSnapshots.ok) {
        switch (conditionSnapshots.code) {
          case 'duplicate_condition_answer':
          case 'unknown_condition_answer':
          case 'incomplete_condition_answers':
          case 'invalid_condition_status':
            throw new SetupConditionSnapshotFailure(conditionSnapshots.code);
          default:
            throw new Error(
              `createTrade condition snapshot invariant failed: ${conditionSnapshots.code}`,
            );
        }
      }

      // Step 15.
      await insertRuleSnapshotsInTx(tx, {
        workspaceId,
        tradeId: created.id,
        strategyVersionId: version.id,
        setupVersionId: setupVersion.id,
      });

      if (selectedEmotionTypes.length > 0) {
        await tx.insert(tradeEmotions).values(
          selectedEmotionTypes.map((emotion) => ({
            tradeId: created.id,
            emotionTypeId: emotion.id,
            workspaceId,
          })),
        );
      }

      // Step 16.
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
  } catch (error) {
    if (error instanceof SetupConditionSnapshotFailure) {
      result = { ok: false, code: error.code };
    } else {
      throw error;
    }
  }

  // Best-effort orphan cleanup (Founder review §5): if a Chart image was
  // already uploaded to private storage but this transaction did NOT end in
  // a usable Trade, the object is now unreferenced by anything. Deleting it
  // is attempted here, with the request's own knowledge of the key, but its
  // success is never allowed to affect the function's real result — DB
  // correctness must never depend on storage cleanup succeeding. A rare
  // process/network failure between the transaction's outcome and this
  // delete can still leave a private orphan object; that residual case is
  // acceptable operational storage-GC work (private orphans carry only a
  // storage-cost risk, never a confidentiality one), not a correctness bug.
  if (
    !result.ok &&
    input.chartAttachmentStorageKey !== null &&
    input.chartAttachmentStorageKey !== undefined
  ) {
    const storage = getChartAttachmentStorage();
    if (storage !== null) {
      try {
        await storage.delete(input.chartAttachmentStorageKey);
      } catch {
        // Best-effort only — see doc comment above.
      }
    }
  }

  return result;
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
  | {
      readonly ok: true;
      readonly changedFields: readonly string[];
      readonly plannedR: string | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_plan'
        | 'no_plan_representation'
        | 'planned_r_mismatch'
        | 'system_requires_price_plan';
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
        plannedRiskMinor: trade.plannedRiskMinor,
        plannedRewardMinor: trade.plannedRewardMinor,
      },
      input,
    );

    let plannedR = trade.plannedR;
    let systemR = trade.systemR;
    let systemOutcome = trade.systemOutcome;
    let systemGrossRInput = trade.systemGrossRInput;
    let calcVersionBump = false;

    if (resolved.planFieldsTouched) {
      // The Founder-UAT "minimum plan validity" floor — an edit must never
      // leave a Trade with neither a Price nor a Money representation.
      const hasPricePlan = resolved.plannedEntry !== null && resolved.plannedStop !== null;
      const hasMoneyPlan = resolved.plannedRiskMinor !== null;
      if (!hasPricePlan && !hasMoneyPlan) {
        return { ok: false, code: 'no_plan_representation' };
      }

      const composed = composePlannedR({
        direction: trade.direction,
        plannedEntry: resolved.plannedEntry,
        plannedStop: resolved.plannedStop,
        plannedTarget: resolved.plannedTarget,
        plannedRiskMinor: resolved.plannedRiskMinor,
        plannedRewardMinor: resolved.plannedRewardMinor,
      });
      if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
      if (composed.value.mismatch) return { ok: false, code: 'planned_r_mismatch' };
      plannedR = composed.value.plannedR;

      if (trade.systemStatus === 'resolved') {
        if (trade.systemResolutionKind === 'price_exit' && resolved.entryOrStopChanged) {
          if (resolved.plannedEntry === null || resolved.plannedStop === null) {
            return { ok: false, code: 'system_requires_price_plan' };
          }
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
        } else if (trade.systemResolutionKind !== 'price_exit') {
          // Price becomes canonical as soon as complete geometry exists; a
          // Money result cannot be silently reinterpreted as Price-derived.
          if (hasPricePlan) return { ok: false, code: 'invalid_plan' };
          if (trade.systemResolutionKind === 'money_target') {
            const composedSystem = composeSystemResolveV2({
              resolutionKind: 'money_target',
              direction: trade.direction,
              plannedEntry: null,
              plannedStop: null,
              plannedRiskMinor: resolved.plannedRiskMinor,
              plannedRewardMinor: resolved.plannedRewardMinor,
              systemCostR: trade.systemCostR,
            });
            if (!composedSystem.ok) {
              return { ok: false, code: 'invalid_plan', calcReason: composedSystem.reason };
            }
            systemGrossRInput = composedSystem.value.grossSystemR;
            systemR = composedSystem.value.systemR;
            systemOutcome = composedSystem.value.systemOutcome;
            calcVersionBump = true;
          }
        }
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
    if (resolved.plannedRiskMinor !== trade.plannedRiskMinor)
      changedFields.push('plannedRiskMinor');
    if (resolved.plannedRewardMinor !== trade.plannedRewardMinor)
      changedFields.push('plannedRewardMinor');
    if (nextPlannedPositionSize !== trade.plannedPositionSize)
      changedFields.push('plannedPositionSize');
    if (nextTimeframe !== trade.timeframe) changedFields.push('timeframe');
    if (nextSession !== trade.session) changedFields.push('session');
    if (nextConfirmationNotes !== trade.confirmationNotes) changedFields.push('confirmationNotes');
    if (nextConfidence !== trade.confidence) changedFields.push('confidence');
    if (nextTradingviewUrl !== trade.tradingviewUrl) changedFields.push('tradingviewUrl');
    if (nextNotes !== trade.notes) changedFields.push('notes');
    if (plannedR !== trade.plannedR) changedFields.push('plannedR');
    if (systemGrossRInput !== trade.systemGrossRInput) changedFields.push('systemGrossRInput');
    if (systemR !== trade.systemR) changedFields.push('systemR');

    if (changedFields.length === 0) return { ok: true, changedFields: [], plannedR };

    await tx
      .update(trades)
      .set({
        plannedEntry: resolved.plannedEntry,
        plannedStop: resolved.plannedStop,
        plannedTarget: resolved.plannedTarget,
        plannedRiskMinor: resolved.plannedRiskMinor,
        plannedRewardMinor: resolved.plannedRewardMinor,
        plannedPositionSize: nextPlannedPositionSize,
        timeframe: nextTimeframe,
        session: nextSession,
        confirmationNotes: nextConfirmationNotes,
        confidence: nextConfidence,
        tradingviewUrl: nextTradingviewUrl,
        notes: nextNotes,
        plannedR,
        systemGrossRInput,
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

    return { ok: true, changedFields, plannedR };
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
  | {
      readonly ok: true;
      readonly changedFields: readonly string[];
      readonly plannedR: string | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'blank_symbol'
        | 'invalid_direction'
        | 'invalid_plan'
        | 'planned_r_mismatch'
        | 'system_requires_price_plan';
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
      // `composePlannedR` gracefully handles `nextEntry`/`nextStop` both
      // being `null` (a Money-only Trade whose Symbol/Direction is being
      // corrected without ever having had a Price plan) — no separate
      // risk-shape-only branch is needed, unlike the pre-0010 synthetic-
      // Target workaround this replaced. Direction changing under an
      // existing Money plan is also re-validated here: a flip can newly
      // put a previously-agreeing Price/Money pair into disagreement.
      const composed = composePlannedR({
        direction: nextDirection,
        plannedEntry: nextEntry,
        plannedStop: nextStop,
        plannedTarget: trade.plannedTarget,
        plannedRiskMinor: trade.plannedRiskMinor,
        plannedRewardMinor: trade.plannedRewardMinor,
      });
      if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
      if (composed.value.mismatch) return { ok: false, code: 'planned_r_mismatch' };
      plannedR = composed.value.plannedR;

      if (trade.systemStatus === 'resolved') {
        if (trade.systemResolutionKind === 'price_exit') {
          if (nextEntry === null || nextStop === null) {
            return { ok: false, code: 'system_requires_price_plan' };
          }
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
        } else if (nextEntry !== null || nextStop !== null) {
          // Adding Price geometry changes the canonical System authority and
          // therefore requires an explicit System correction, never an
          // automatic reinterpretation of a Money result.
          return { ok: false, code: 'invalid_plan' };
        }
      }
    }

    const changedFields: string[] = [];
    if (nextSymbol !== trade.symbol) changedFields.push('symbol');
    if (nextDirection !== trade.direction) changedFields.push('direction');
    if (nextEntry !== trade.plannedEntry) changedFields.push('plannedEntry');
    if (nextStop !== trade.plannedStop) changedFields.push('plannedStop');
    if (plannedR !== trade.plannedR) changedFields.push('plannedR');
    if (systemR !== trade.systemR) changedFields.push('systemR');

    if (changedFields.length === 0) return { ok: true, changedFields: [], plannedR };

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

    return { ok: true, changedFields, plannedR };
  });
}

// ---------------------------------------------------------------------------
// 4. openTrade
// ---------------------------------------------------------------------------

export interface OpenTradeInput {
  readonly actualResultMode: ActualResultMode;
  readonly actualEntry?: string | null;
  readonly actualInitialStop?: string | null;
  readonly actualInitialRiskMinor?: bigint | null;
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
        | 'invalid_execution_context'
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
    const actualResultMode = input.actualResultMode;
    const actualEntry = input.actualEntry ?? null;
    const actualInitialStop = input.actualInitialStop ?? null;
    const actualInitialRiskMinor = input.actualInitialRiskMinor ?? null;
    if (actualResultMode === 'price') {
      if (actualInitialRiskMinor !== null) return { ok: false, code: 'invalid_execution_context' };
      const context = composeRealizedActual({
        actualResultMode: 'price',
        direction: trade.direction,
        actualEntry,
        actualInitialStop,
        exits: [],
      });
      if (!context.ok) return { ok: false, code: 'invalid_execution_context' };
    } else {
      if (actualInitialRiskMinor === null || actualInitialRiskMinor <= 0n) {
        return { ok: false, code: 'invalid_initial_risk' };
      }
      if ((actualEntry === null) !== (actualInitialStop === null)) {
        return { ok: false, code: 'invalid_execution_context' };
      }
      if (actualEntry !== null) {
        const context = composeRealizedActual({
          actualResultMode: 'price',
          direction: trade.direction,
          actualEntry,
          actualInitialStop,
          exits: [],
        });
        if (!context.ok) return { ok: false, code: 'invalid_execution_context' };
      }
    }

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
        actualResultMode,
        actualEntry,
        actualInitialStop,
        actualInitialRiskMinor,
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
  | { readonly ok: true; readonly actualR: string; readonly traderOutcome: OutcomeValue }
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
 * caller toward `correctTradeExit` (locked Phase 08B decision:
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
        trade.actualR !== null &&
        trade.traderOutcome !== null &&
        matchesCloseRetry(
          {
            actualExit: trade.actualExit,
            netPnlMinor: trade.netPnlMinor,
            exitedAt: trade.exitedAt,
          },
          input,
        )
      ) {
        return {
          ok: true,
          actualR: trade.actualR,
          traderOutcome: trade.traderOutcome as OutcomeValue,
        };
      }
      return { ok: false, code: 'invalid_status_transition' };
    }
    if (!canCloseFromStatus(trade.status as TradeStatus)) {
      return { ok: false, code: 'invalid_status_transition' };
    }
    if (trade.enteredAt !== null && input.exitedAt.getTime() < trade.enteredAt.getTime()) {
      return { ok: false, code: 'invalid_exit_time' };
    }

    if (trade.actualResultMode !== 'money') {
      return { ok: false, code: 'invalid_status_transition' };
    }
    const existingExits = await tx
      .select()
      .from(tradeExits)
      .where(eq(tradeExits.tradeId, tradeId))
      .orderBy(asc(tradeExits.sequence), asc(tradeExits.id));
    const alreadyClosedBps = existingExits.reduce((sum, exit) => sum + exit.closedBps, 0);
    const remainingBps = 10_000 - alreadyClosedBps;
    if (remainingBps <= 0) return { ok: false, code: 'invalid_status_transition' };
    const [newExit] = await tx
      .insert(tradeExits)
      .values({
        workspaceId,
        tradeId,
        sequence: existingExits.reduce((max, exit) => Math.max(max, exit.sequence), 0) + 1,
        closedBps: remainingBps,
        exitPrice: input.actualExit,
        realizedPnlMinor: input.netPnlMinor,
        exitedAt: input.exitedAt,
      })
      .returning();
    if (newExit === undefined) throw new Error('closeTrade: Exit insert returned no row');
    const allExits = [...existingExits, newExit];
    const composed = composeTraderCloseV2({
      actualResultMode: 'money',
      direction: trade.direction,
      actualEntry: trade.actualEntry,
      actualInitialStop: trade.actualInitialStop,
      actualInitialRiskMinor: trade.actualInitialRiskMinor,
      exits: allExits,
    });
    if (!composed.ok)
      return { ok: false, code: 'invalid_status_transition', calcReason: composed.reason };
    const netPnlMinor = allExits.reduce((sum, exit) => sum + (exit.realizedPnlMinor ?? 0n), 0n);
    const chronologicalFinal = [...allExits].sort(
      (a, b) =>
        b.exitedAt.getTime() - a.exitedAt.getTime() ||
        b.sequence - a.sequence ||
        b.id.localeCompare(a.id),
    )[0]!;

    await tx
      .update(trades)
      .set({
        actualExit: chronologicalFinal.exitPrice,
        netPnlMinor,
        exitedAt: chronologicalFinal.exitedAt,
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
      action: 'trade.exit_added',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade_exit',
      entityId: newExit.id,
      metadata: {
        tradeId,
        exitId: newExit.id,
        sequence: newExit.sequence,
        closedBps: remainingBps,
      },
    });

    await insertAuditLog(tx, {
      action: 'trade.closed',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'open', newStatus: 'closed' },
    });

    return {
      ok: true,
      actualR: composed.value.actualR,
      traderOutcome: composed.value.traderOutcome,
    };
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
  readonly actualResultMode?: ActualResultMode;
  readonly actualEntry?: string | null;
  readonly actualInitialStop?: string | null;
  readonly actualInitialRiskMinor?: bigint | null;
  readonly actualPositionSize?: string | null;
  readonly enteredAt?: Date;
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
        | 'invalid_execution_context'
        | 'invalid_exit_time';
      readonly calcReason?: CalcFailureReason;
    };

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

    const exits = await tx
      .select()
      .from(tradeExits)
      .where(and(eq(tradeExits.workspaceId, workspaceId), eq(tradeExits.tradeId, tradeId)))
      .orderBy(asc(tradeExits.sequence), asc(tradeExits.id));
    const nextActualResultMode = input.actualResultMode ?? trade.actualResultMode;
    if (
      exits.length > 0 &&
      input.actualResultMode !== undefined &&
      input.actualResultMode !== trade.actualResultMode
    ) {
      return { ok: false, code: 'invalid_status_transition' };
    }
    const nextActualEntry =
      'actualEntry' in input ? (input.actualEntry ?? null) : trade.actualEntry;
    const nextActualInitialStop =
      'actualInitialStop' in input ? (input.actualInitialStop ?? null) : trade.actualInitialStop;
    const nextActualInitialRiskMinor =
      'actualInitialRiskMinor' in input
        ? (input.actualInitialRiskMinor ?? null)
        : trade.actualInitialRiskMinor;
    const nextActualPositionSize =
      'actualPositionSize' in input ? (input.actualPositionSize ?? null) : trade.actualPositionSize;
    const nextEnteredAt = input.enteredAt ?? trade.enteredAt;

    if (nextActualResultMode === null) {
      return { ok: false, code: 'invalid_execution_context' };
    }
    if (nextActualInitialRiskMinor !== null && nextActualInitialRiskMinor <= 0n) {
      return { ok: false, code: 'invalid_initial_risk' };
    }
    const hasPriceContext = nextActualEntry !== null && nextActualInitialStop !== null;
    if ((nextActualEntry === null) !== (nextActualInitialStop === null)) {
      return { ok: false, code: 'invalid_execution_context' };
    }
    if (nextActualResultMode === 'price') {
      if (!hasPriceContext || nextActualInitialRiskMinor !== null) {
        return { ok: false, code: 'invalid_execution_context' };
      }
    } else if (nextActualInitialRiskMinor === null) {
      return { ok: false, code: 'invalid_initial_risk' };
    }
    if (hasPriceContext) {
      const context = composeRealizedActual({
        actualResultMode: 'price',
        direction: trade.direction,
        actualEntry: nextActualEntry,
        actualInitialStop: nextActualInitialStop,
        exits: [],
      });
      if (!context.ok) return { ok: false, code: 'invalid_execution_context' };
    }
    if (
      nextEnteredAt === null ||
      exits.some((exit) => exit.exitedAt.getTime() < nextEnteredAt.getTime())
    ) {
      return { ok: false, code: 'invalid_exit_time' };
    }

    const nextGrossPnlMinor =
      'grossPnlMinor' in input ? (input.grossPnlMinor ?? null) : trade.grossPnlMinor;
    const nextCommissionMinor = input.commissionMinor ?? trade.commissionMinor;
    const nextFeesMinor = input.feesMinor ?? trade.feesMinor;
    const nextSwapMinor = input.swapMinor ?? trade.swapMinor;
    let nextActualExit = trade.actualExit;
    let nextNetPnlMinor = trade.netPnlMinor;
    let nextExitedAt = trade.exitedAt;
    let actualR = trade.actualR;
    let traderOutcome = trade.traderOutcome;
    let calcVersion = trade.calcVersion;

    if (exits.length > 0) {
      const calculation = {
        actualResultMode: nextActualResultMode,
        direction: trade.direction,
        actualEntry: nextActualEntry,
        actualInitialStop: nextActualInitialStop,
        actualInitialRiskMinor: nextActualInitialRiskMinor,
        exits: exits.map((exit) => ({
          closedBps: exit.closedBps,
          exitPrice: exit.exitPrice,
          realizedPnlMinor: exit.realizedPnlMinor,
        })),
      };
      const realized = composeRealizedActual(calculation);
      if (!realized.ok) {
        return { ok: false, code: 'invalid_execution_context', calcReason: realized.reason };
      }
      if (status === 'closed') {
        const final = composeTraderCloseV2(calculation);
        if (!final.ok) {
          return { ok: false, code: 'invalid_execution_context', calcReason: final.reason };
        }
        const chronologicalFinal = [...exits].sort(
          (a, b) =>
            b.exitedAt.getTime() - a.exitedAt.getTime() ||
            b.sequence - a.sequence ||
            b.id.localeCompare(a.id),
        )[0]!;
        nextActualExit = chronologicalFinal.exitPrice;
        nextNetPnlMinor = realized.value.realizedPnlMinor;
        nextExitedAt = chronologicalFinal.exitedAt;
        actualR = final.value.actualR;
        traderOutcome = final.value.traderOutcome;
        calcVersion = final.value.calcVersion;
      } else {
        nextActualExit = null;
        nextNetPnlMinor = null;
        nextExitedAt = null;
        actualR = null;
        traderOutcome = null;
      }
    } else if (status === 'closed') {
      return { ok: false, code: 'invalid_execution_context' };
    }

    const changedFields: string[] = [];
    if (nextActualResultMode !== trade.actualResultMode) changedFields.push('actualResultMode');
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
        actualResultMode: nextActualResultMode,
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

interface SystemResolveCommonInput {
  readonly systemExitedAt: Date;
  readonly systemCostR: string;
}

export type ResolveSystemTradeInput =
  | (SystemResolveCommonInput & {
      readonly resolutionKind: 'price_exit';
      readonly systemExitPrice: string;
      readonly systemExitReason: string;
    })
  | (SystemResolveCommonInput & {
      readonly resolutionKind: 'money_target' | 'money_stop' | 'money_break_even';
    })
  | (SystemResolveCommonInput & {
      readonly resolutionKind: 'money_custom';
      readonly systemGrossRInput: string;
    });

type PreparedSystemResolution = {
  readonly systemResolutionKind: SystemResolutionKind;
  readonly systemExitPrice: string | null;
  readonly systemGrossRInput: string | null;
  readonly systemExitedAt: Date;
  readonly systemExitReason: string;
  readonly systemCostR: string;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
  readonly calcVersion: number;
};

type PrepareSystemResolutionResult =
  | { readonly ok: true; readonly value: PreparedSystemResolution }
  | {
      readonly ok: false;
      readonly code:
        | 'system_requires_price_plan'
        | 'invalid_system_status_transition'
        | 'invalid_system_exit_reason';
      readonly calcReason?: CalcFailureReason;
    };

const MONEY_SYSTEM_EXIT_REASON = {
  money_target: 'target_hit',
  money_stop: 'stop_hit',
  money_break_even: 'break_even_rule',
  money_custom: 'manual_system_valid_exit',
} as const;

function prepareSystemResolution(
  trade: TradeRow,
  input: ResolveSystemTradeInput,
): PrepareSystemResolutionResult {
  if (!isSystemResolutionKind(input.resolutionKind)) {
    return { ok: false, code: 'invalid_system_status_transition' };
  }

  const hasPricePlan = trade.plannedEntry !== null && trade.plannedStop !== null;
  if (input.resolutionKind === 'price_exit') {
    if (!hasPricePlan) return { ok: false, code: 'system_requires_price_plan' };
    if (
      !isSystemExitReason(input.systemExitReason) ||
      input.systemExitReason === 'setup_invalidated'
    ) {
      return { ok: false, code: 'invalid_system_exit_reason' };
    }
  } else if (hasPricePlan) {
    // Price geometry is canonical whenever it exists; Money resolution is a
    // fallback, never an alternate authority on a Both-plan Trade.
    return { ok: false, code: 'invalid_system_status_transition' };
  }

  const composed = composeSystemResolveV2({
    resolutionKind: input.resolutionKind,
    direction: trade.direction,
    plannedEntry: trade.plannedEntry,
    plannedStop: trade.plannedStop,
    plannedRiskMinor: trade.plannedRiskMinor,
    plannedRewardMinor: trade.plannedRewardMinor,
    systemExitPrice: input.resolutionKind === 'price_exit' ? input.systemExitPrice : null,
    systemGrossRInput: input.resolutionKind === 'money_custom' ? input.systemGrossRInput : null,
    systemCostR: input.systemCostR,
  });
  if (!composed.ok) {
    return {
      ok: false,
      code: 'invalid_system_status_transition',
      calcReason: composed.reason,
    };
  }

  return {
    ok: true,
    value: {
      systemResolutionKind: input.resolutionKind,
      systemExitPrice: input.resolutionKind === 'price_exit' ? input.systemExitPrice : null,
      systemGrossRInput: input.resolutionKind === 'price_exit' ? null : composed.value.grossSystemR,
      systemExitedAt: input.systemExitedAt,
      systemExitReason:
        input.resolutionKind === 'price_exit'
          ? input.systemExitReason
          : MONEY_SYSTEM_EXIT_REASON[input.resolutionKind],
      systemCostR: composed.value.systemCostR,
      systemR: composed.value.systemR,
      systemOutcome: composed.value.systemOutcome,
      calcVersion: composed.value.calcVersion,
    },
  };
}

export type ResolveSystemTradeResult =
  | { readonly ok: true; readonly systemR: string; readonly systemOutcome: OutcomeValue }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'system_requires_price_plan'
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

    if (trade.systemStatus !== 'pending' && trade.systemStatus !== 'resolved') {
      return { ok: false, code: 'invalid_system_status_transition' };
    }
    const prepared = prepareSystemResolution(trade, input);
    if (!prepared.ok) return prepared;

    if (trade.systemStatus === 'resolved') {
      if (
        trade.systemResolutionKind !== null &&
        trade.systemExitedAt !== null &&
        trade.systemExitReason !== null &&
        trade.systemR !== null &&
        trade.systemOutcome !== null &&
        matchesSystemResolveRetry(
          {
            systemResolutionKind: trade.systemResolutionKind,
            systemExitPrice: trade.systemExitPrice,
            systemGrossRInput: trade.systemGrossRInput,
            systemExitedAt: trade.systemExitedAt,
            systemExitReason: trade.systemExitReason,
            systemCostR: trade.systemCostR,
          },
          prepared.value,
        )
      ) {
        return {
          ok: true,
          systemR: trade.systemR,
          systemOutcome: trade.systemOutcome as OutcomeValue,
        };
      }
      return { ok: false, code: 'invalid_system_status_transition' };
    }

    await tx
      .update(trades)
      .set({
        systemStatus: 'resolved',
        systemResolutionKind: prepared.value.systemResolutionKind,
        systemExitPrice: prepared.value.systemExitPrice,
        systemGrossRInput: prepared.value.systemGrossRInput,
        systemExitedAt: prepared.value.systemExitedAt,
        systemExitReason: prepared.value.systemExitReason,
        systemCostR: prepared.value.systemCostR,
        systemResolvedAt: clock.now(),
        systemR: prepared.value.systemR,
        systemOutcome: prepared.value.systemOutcome,
        calcVersion: prepared.value.calcVersion,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    await insertAuditLog(tx, {
      action: 'trade.system_resolved',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: {
        tradeId,
        previousStatus: 'pending',
        newStatus: 'resolved',
        resolutionKind: prepared.value.systemResolutionKind,
      },
    });

    return {
      ok: true,
      systemR: prepared.value.systemR,
      systemOutcome: prepared.value.systemOutcome,
    };
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
        systemResolutionKind: null,
        systemExitPrice: null,
        systemGrossRInput: null,
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
  (ResolveSystemTradeInput & { readonly target: 'resolved' }) | { readonly target: 'no_trade' };

export type CorrectSystemResolutionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'system_requires_price_plan'
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
          systemResolutionKind: null,
          systemExitPrice: null,
          systemGrossRInput: null,
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
          changedFields: [
            'systemStatus',
            'systemResolutionKind',
            'systemExitPrice',
            'systemGrossRInput',
            'systemExitReason',
            'systemR',
            'systemOutcome',
          ],
        },
      });
      return { ok: true };
    }

    const prepared = prepareSystemResolution(trade, input);
    if (!prepared.ok) return prepared;

    await tx
      .update(trades)
      .set({
        systemStatus: 'resolved',
        systemResolutionKind: prepared.value.systemResolutionKind,
        systemExitPrice: prepared.value.systemExitPrice,
        systemGrossRInput: prepared.value.systemGrossRInput,
        systemExitedAt: prepared.value.systemExitedAt,
        systemExitReason: prepared.value.systemExitReason,
        systemCostR: prepared.value.systemCostR,
        systemResolvedAt: clock.now(),
        systemR: prepared.value.systemR,
        systemOutcome: prepared.value.systemOutcome,
        calcVersion: prepared.value.calcVersion,
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
          'systemResolutionKind',
          'systemExitPrice',
          'systemGrossRInput',
          'systemExitedAt',
          'systemExitReason',
          'systemCostR',
          'systemR',
          'systemOutcome',
        ],
        resolutionKind: prepared.value.systemResolutionKind,
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
