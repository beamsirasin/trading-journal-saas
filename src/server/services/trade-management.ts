import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { isCanonicalEmotionKey } from '@/config/emotions';
import { buildSystemDependencySnapshot } from '@/lib/calc/system-assessment';
import {
  actualR,
  composePlannedR,
  composeRealizedActual,
  composeSystemResolveGrossOnly,
  composeSystemResolveV2,
  composeTraderClose,
  composeTraderCloseV2,
} from '@/lib/calc/trade';
import type { CalcFailureReason } from '@/lib/calc/types';
import { authorizeWorkspaceMutation, type MutationDenialReason } from '@/lib/entitlements/resolve';
import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import type { SetupConditionAnswer } from '@/lib/setup-conditions/snapshots';
import { getChartAttachmentStorage } from '@/lib/storage/chart-attachment-storage';
import { systemClock, type Clock } from '@/lib/time';
import {
  actualRDenominatorMinor,
  contractActualRiskMinor,
  hasStatedClosedResult,
  isContractRow,
  laterCaptureOrigin,
  RECORDING_CONTRACT_ADD_TRADE_V1,
  type ActualRiskAnswer,
  type CaptureOrigin,
  type EnteredAtSource,
  type ExitPlanProvenance,
  type PlannedRiskState,
  type PlannedStopMethod,
  type TargetState,
} from '@/lib/trades/add-trade-contract';
import {
  isSystemExitReason,
  isSystemResolutionKind,
  isTradeDirection,
  type ActualResultMode,
  type OutcomeValue,
  type PlanAdherence,
  type SystemPlanProvenance,
  type SystemResolutionKind,
  type TradeStatus,
} from '@/lib/trades/constants';
import {
  inferPersistedSystemPlanBasis,
  validateNewWritePlanAuthority,
  type RecordingTiming,
  type SystemPlanBasis,
} from '@/lib/trades/recording-model';
import { normalizeOptionalText, normalizeRequiredText } from '@/lib/trades/validation';
import { getDb, type Database } from '@/server/db/client';
import {
  emotionTypes,
  exitPlans,
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
import { tradeMutationFingerprint } from './trade-mutation-fingerprint';
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
export type TradeTransactionExecutor = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete' | 'query'
>;
type Executor = TradeTransactionExecutor;

export type WorkspaceAccessDenial = 'workspace_access_denied' | MutationDenialReason;

export type TradeServiceTradeRow = typeof trades.$inferSelect;
type TradeRow = TradeServiceTradeRow;
type ExitRow = typeof tradeExits.$inferSelect;
type CompleteExecutionExit = ExitRow & { readonly closedBps: number; readonly exitedAt: Date };
type StrategyRow = typeof strategies.$inferSelect;
type StrategyVersionRow = typeof strategyVersions.$inferSelect;

function isCompleteExecutionExit(exit: ExitRow): exit is CompleteExecutionExit {
  return exit.closedBps !== null && exit.exitedAt !== null;
}

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

export async function resolveMutationDenial(
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
export async function lockWorkspaceAndVerifyMembership(
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
export async function lockTradeRow(
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

/** The Exit Plan answer on a contract At Entry write. Absent = Not recorded. */
export type CreateTradeExitPlanChoice =
  | {
      readonly state: 'saved';
      readonly exitPlanId: string;
      readonly provenance: ExitPlanProvenance;
    }
  | {
      readonly state: 'customized';
      readonly baseExitPlanId: string | null;
      readonly instructions: string;
    }
  | { readonly state: 'no_rule' };

export interface CreateTradeInput {
  readonly mutationKey: string;
  readonly tradingAccountId: string;
  /** Explicit for canonical 15G.5A writes; omitted only by the legacy internal compatibility facade. */
  readonly recordingTiming?: RecordingTiming | undefined;
  /** Required by canonical callers when Plan data exists; never persisted as a column. */
  readonly systemPlanBasis?: SystemPlanBasis | undefined;
  /**
   * Optional since Phase 14B — a Trade may be captured with no Strategy
   * classification. `setupId` may be present only alongside `strategyId`
   * (validated below, and by `trades_setup_requires_strategy_check` at the
   * database layer); `conditionSetToken`/`conditionAnswers` are meaningful,
   * and required, exactly when `setupId` is present.
   */
  readonly strategyId?: string | undefined;
  readonly setupId?: string | undefined;
  /** Opaque optimistic-concurrency token for the Condition set rendered by the client. Required exactly when `setupId` is present. */
  readonly conditionSetToken?: string | undefined;
  /** Stable logical keys plus binary answers only; all snapshot content remains server-owned. Empty/omitted whenever `setupId` is absent. */
  readonly conditionAnswers?: readonly SetupConditionAnswer[] | undefined;
  readonly symbol: string;
  readonly direction: string;
  /**
   * Price and Money are independent, both-optional representations of the
   * same Plan (Founder-UAT Trade Plan UX correction slice, migration 0010).
   * Since migration 0016 (Phase 14C.1) a Trade may supply Price only, Money
   * only, both, or NEITHER — the frozen Quick Capture contract requires
   * Trading Account/Symbol/Direction alone to be sufficient. There is no
   * "at least one representation" floor here anymore.
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
  /**
   * Phase 14E — Open/Close-Only Trade Flow. Present exactly when the caller
   * wants this Trade to be created ALREADY `open` (the normal customer New
   * Trade flow) — omitted entirely means the pre-14E `status = 'planned'`
   * path (retained internally for backward compatibility and any future
   * Quick Capture/completed-trade-import use, deliberately no longer
   * produced by the normal customer form — see the module doc comment).
   * When present, this is the SAME atomic transaction as everything else
   * `createTrade` already does — one insert, one lock order, one audit
   * event — never a second `openTrade` call chained afterward, so a
   * mid-flow failure can never leave a half-created Trade stuck `planned`.
   * Validated identically to `openTrade`'s own Price/Money checks (inline,
   * near the top of `createTrade`'s body, guarded by `openAtCreation`);
   * `enteredAt` is REQUIRED whenever `actualResultMode` is present, matching
   * `OpenTradeInput`'s own contract exactly.
   */
  readonly actualResultMode?: ActualResultMode | undefined;
  readonly actualEntry?: string | null;
  readonly actualInitialStop?: string | null;
  readonly actualInitialRiskMinor?: bigint | null;
  readonly actualPositionSize?: string | null;
  readonly enteredAt?: Date | undefined;
  /** Add Trade contract v1 — see `src/lib/trades/add-trade-contract.ts`. Absent = a legacy write. */
  readonly recordingContract?: typeof RECORDING_CONTRACT_ADD_TRADE_V1 | undefined;
  /** The explicit risk decision; 'no_defined' forecloses every R figure. */
  readonly plannedRiskState?: PlannedRiskState | undefined;
  /** A plan answer only: no figure, outcome or adherence is derived from it. */
  readonly plannedStopMethod?: PlannedStopMethod | undefined;
  readonly targetState?: TargetState | undefined;
  readonly targetPrice?: string | null;
  readonly contextEntryPrice?: string | null;
  readonly contextStopPrice?: string | null;
  readonly contextPositionSize?: string | null;
  /** At Entry: `matched` or `different`. After Trade may also say `unknown`, or leave it Unanswered. */
  readonly actualRiskAnswer?: ActualRiskAnswer | undefined;
  readonly enteredAtSource?: EnteredAtSource | undefined;
  readonly exitPlan?: CreateTradeExitPlanChoice | undefined;
  readonly exitPlanInheritanceDeclined?: boolean | undefined;
  readonly noStrategy?: boolean | undefined;
  readonly noSetup?: boolean | undefined;
  /** Post-Trade Emotion (After Trade). Omitted = Unanswered; `[]` = None of these. */
  readonly postTradeEmotionKeys?: readonly string[] | undefined;
  /**
   * The closed result a contract After Trade write carries, inserted with the
   * row itself — a contract row is never `planned`, so it cannot be inserted
   * first and closed afterwards. Internal: set only by `createCompletedTrade`.
   */
  readonly closedAtCreation?: ContractClosedColumns | undefined;
}

/** The whole-Trade result columns of a Save Closed Trade (contract §11–§13). */
export interface ContractClosedColumns {
  readonly exitedAt: Date | null;
  readonly netPnlMinor: bigint | null;
  readonly finalPnlSource: 'manual_total' | 'exit_history' | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly traderOutcomeSelectedAt: Date | null;
  readonly exitHistoryCompleteness: 'unknown' | 'incomplete' | 'complete' | null;
  readonly actualExit: string | null;
}

export type CreateTradeErrorCode =
  | WorkspaceAccessDenial
  | 'blank_symbol'
  | 'invalid_direction'
  | 'invalid_plan'
  | 'invalid_plan_authority'
  | 'completed_trade_path_required'
  | 'planned_r_mismatch'
  | 'trading_account_not_found'
  | 'trading_account_archived'
  | 'setup_requires_strategy'
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
  | 'emotion_type_not_usable'
  /** Phase 14E — same two codes `openTrade` returns for the same checks, reused verbatim so client error-mapping never has to distinguish the two mutation paths. */
  | 'invalid_initial_risk'
  | 'invalid_execution_context'
  | 'invalid_exit_plan'
  | 'invalid_classification_request'
  /** The Save key was already used by a request that said something else (contract §23). */
  | 'mutation_replay_conflict';

export type SetupConditionInputErrorCode = Extract<
  CreateTradeErrorCode,
  | 'duplicate_condition_answer'
  | 'unknown_condition_answer'
  | 'incomplete_condition_answers'
  | 'invalid_condition_status'
>;

export class SetupConditionSnapshotFailure extends Error {
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
      /** With `mutation_replay_conflict`: the Trade the key already created, in this workspace. */
      readonly existingTradeId?: string;
      /** With `mutation_replay_conflict`: why the replay could not be honoured. */
      readonly replayConflict?: ReplayConflictReason;
    };

/**
 * `different`: the stored fingerprint shows the key was used by a request
 * that said something else. `unverifiable`: the Trade predates migration
 * 0024 and has no fingerprint, so nothing proves this request is the one that
 * created it.
 */
export type ReplayConflictReason = 'different' | 'unverifiable';

/**
 * AN HONEST REPLAY SAID THE SAME THING (contract §23).
 *
 * The key found a Trade. It is that Trade's replay only when the stored
 * fingerprint of the committed request matches this one; otherwise the key was
 * reused for different content — a second tab, an edit after a lost answer, the
 * other recording mode — and answering with the existing Trade would report a
 * Save that never happened. The existing Trade is never overwritten.
 *
 * A ROW WITH NO FINGERPRINT CANNOT BE REPLAYED HONESTLY. A Trade created
 * before migration 0024 stored only its key; the request that created it is
 * not provable, so a matching key proves nothing about matching content, and
 * even identical-looking answers are an unverifiable conflict. No fingerprint
 * is ever backfilled from the new request — that would manufacture history.
 */
function replayOf(
  existing: { readonly id: string; readonly mutationFingerprint: string | null },
  fingerprint: string,
): CreateTradeResult {
  if (existing.mutationFingerprint === null) {
    return {
      ok: false,
      code: 'mutation_replay_conflict',
      existingTradeId: existing.id,
      replayConflict: 'unverifiable',
    };
  }
  if (existing.mutationFingerprint !== fingerprint) {
    return {
      ok: false,
      code: 'mutation_replay_conflict',
      existingTradeId: existing.id,
      replayConflict: 'different',
    };
  }
  return { ok: true, tradeId: existing.id, alreadyCreated: true };
}

/**
 * The Add Trade contract write, validated before any lock or read beyond
 * membership. Common to both recording modes: Money is result authority,
 * price is context, a known Risk at Entry is positive, and an explicit Fixed
 * Target carries Target Profit or a TP price.
 *
 * At Entry (Save Open Trade) requires Risk at Entry and a Matched / Different
 * Actual Risk answer, and may inherit the Strategy's default Exit Plan.
 *
 * After Trade (Save Closed Trade) requires nothing beyond identity: Risk at
 * Entry, Actual Risk and every other answer may be Unanswered. It never
 * inherits a current default, and "Matched" needs a Risk at Entry to match.
 */
function validateContractCreate(
  input: CreateTradeInput,
  actualResultMode: ActualResultMode | undefined,
  path: 'at_entry' | 'completed',
): CreateTradeErrorCode | null {
  const afterTrade = path === 'completed';
  if (afterTrade) {
    if (
      input.recordingTiming !== 'after_trade' ||
      actualResultMode !== undefined ||
      input.closedAtCreation === undefined
    ) {
      return 'invalid_plan_authority';
    }
  } else if (input.recordingTiming !== 'at_entry' || actualResultMode !== 'money') {
    return 'invalid_plan_authority';
  }
  if (
    [
      input.plannedEntry,
      input.plannedStop,
      input.plannedTarget,
      input.plannedPositionSize,
      input.actualEntry,
      input.actualInitialStop,
      input.actualPositionSize,
    ].some((value) => value != null)
  ) {
    return 'invalid_plan_authority';
  }
  if (input.plannedRiskMinor != null && input.plannedRiskMinor <= 0n) return 'invalid_initial_risk';
  if (afterTrade) {
    if (input.actualRiskAnswer === 'matched' && input.plannedRiskMinor == null) {
      return 'invalid_initial_risk';
    }
    if (input.actualRiskAnswer !== 'different' && input.actualInitialRiskMinor != null) {
      return 'invalid_initial_risk';
    }
    if (input.enteredAtSource !== undefined && input.enteredAtSource !== 'trader') {
      return 'invalid_execution_context';
    }
    if (input.exitPlan?.state === 'saved' && input.exitPlan.provenance !== 'selected') {
      return 'invalid_exit_plan';
    }
    if (input.exitPlanInheritanceDeclined === true) return 'invalid_exit_plan';
  } else {
    /*
      A RISK DECISION, NOT NECESSARILY AN AMOUNT (contract decision 54). An
      Open contract Trade records Defined Risk with its 1R, or an explicit No
      Defined Risk with none; Unanswered is not a Save. A payload that claims
      No Defined Risk while carrying an amount contradicts itself.
    */
    if (input.plannedRiskState === undefined) return 'invalid_initial_risk';
    if (input.plannedRiskState === 'defined' && input.plannedRiskMinor == null) {
      return 'invalid_initial_risk';
    }
    if (input.plannedRiskState === 'no_defined' && input.plannedRiskMinor != null) {
      return 'invalid_initial_risk';
    }
    // Actual Risk is the trader's to answer or leave Unanswered; only a
    // stated answer must be one this contract knows (contract §2, §8).
    if (
      input.actualRiskAnswer !== undefined &&
      input.actualRiskAnswer !== 'matched' &&
      input.actualRiskAnswer !== 'different'
    ) {
      return 'invalid_initial_risk';
    }
    if (input.postTradeEmotionKeys !== undefined || input.closedAtCreation !== undefined) {
      return 'invalid_plan_authority';
    }
  }
  if (input.plannedRiskState === 'no_defined' && input.plannedRiskMinor != null) {
    return 'invalid_initial_risk';
  }
  // No planned 1R exists to match, so Actual Risk cannot claim it matched one.
  if (input.plannedRiskState === 'no_defined' && input.actualRiskAnswer === 'matched') {
    return 'invalid_initial_risk';
  }
  if (input.actualRiskAnswer === 'matched' && input.actualInitialRiskMinor != null) {
    return 'invalid_initial_risk';
  }
  if (input.actualInitialRiskMinor != null && input.actualInitialRiskMinor <= 0n) {
    return 'invalid_initial_risk';
  }
  // A Different Actual Risk that states Risk at Entry's own amount is a
  // contradiction, and `trades_actual_risk_answer_check` refuses it.
  if (
    input.actualRiskAnswer === 'different' &&
    input.actualInitialRiskMinor != null &&
    input.actualInitialRiskMinor === input.plannedRiskMinor
  ) {
    return 'invalid_initial_risk';
  }
  const hasTargetProfit = input.plannedRewardMinor != null;
  const hasTargetPrice = input.targetPrice != null;
  if (input.targetState === 'fixed') {
    if ((!hasTargetProfit && !hasTargetPrice) || input.plannedRewardMinor === 0n) {
      return 'invalid_plan';
    }
  } else if (hasTargetProfit || hasTargetPrice) {
    return 'invalid_plan';
  }
  if ((input.enteredAt === undefined) !== (input.enteredAtSource === undefined)) {
    return 'invalid_execution_context';
  }
  if (input.noStrategy === true && input.strategyId !== undefined) {
    return 'invalid_classification_request';
  }
  if (input.noSetup === true && (input.strategyId === undefined || input.setupId !== undefined)) {
    return 'invalid_classification_request';
  }
  // An inherited plan and a declined inheritance cannot both be true.
  if (
    input.exitPlan?.state === 'saved' &&
    input.exitPlan.provenance === 'strategy_default' &&
    input.exitPlanInheritanceDeclined === true
  ) {
    return 'invalid_exit_plan';
  }
  return null;
}

/** Stable emotion keys → usable system emotion types, or the refusal code. */
export async function resolveEmotionTypesInTx(
  tx: Executor,
  keys: readonly string[],
): Promise<
  | { readonly ok: true; readonly value: readonly { readonly id: string }[] }
  | {
      readonly ok: false;
      readonly code: 'duplicate_emotion_key' | 'unknown_emotion_key' | 'emotion_type_not_usable';
    }
> {
  if (new Set(keys).size !== keys.length) return { ok: false, code: 'duplicate_emotion_key' };
  if (!keys.every(isCanonicalEmotionKey)) return { ok: false, code: 'unknown_emotion_key' };
  if (keys.length === 0) return { ok: true, value: [] };
  const found = await tx
    .select({ id: emotionTypes.id, workspaceId: emotionTypes.workspaceId })
    .from(emotionTypes)
    .where(
      and(
        inArray(emotionTypes.key, [...keys]),
        eq(emotionTypes.isSystem, true),
        eq(emotionTypes.isArchived, false),
      ),
    );
  if (found.length !== keys.length || found.some((emotion) => emotion.workspaceId !== null)) {
    return { ok: false, code: 'emotion_type_not_usable' };
  }
  return { ok: true, value: found };
}

interface ContractExitPlanSnapshot {
  readonly exitPlanState: 'saved' | 'customized' | 'no_rule' | null;
  readonly exitPlanProvenance: ExitPlanProvenance | null;
  readonly exitPlanId: string | null;
  readonly exitPlanName: string | null;
  readonly exitPlanInstructions: string | null;
}

const NO_EXIT_PLAN_SNAPSHOT: ContractExitPlanSnapshot = {
  exitPlanState: null,
  exitPlanProvenance: null,
  exitPlanId: null,
  exitPlanName: null,
  exitPlanInstructions: null,
};

/**
 * SNAPSHOTS THE EXIT PLAN FROM THE LIBRARY, NEVER FROM THE CLIENT.
 *
 * A saved plan's name and instructions are copied from its workspace-scoped,
 * unarchived library row. An inherited (`strategy_default`) plan must still be
 * the default of the Strategy this Trade is being classified under. A
 * customized plan keeps the trader's own instructions and, when it started
 * from a library plan, that plan's identity as provenance.
 */
async function resolveContractExitPlanInTx(
  tx: Executor,
  workspaceId: string,
  choice: CreateTradeExitPlanChoice | undefined,
  strategyId: string | null,
): Promise<
  { readonly ok: true; readonly value: ContractExitPlanSnapshot } | { readonly ok: false }
> {
  if (choice === undefined) return { ok: true, value: NO_EXIT_PLAN_SNAPSHOT };
  if (choice.state === 'no_rule') {
    return { ok: true, value: { ...NO_EXIT_PLAN_SNAPSHOT, exitPlanState: 'no_rule' } };
  }
  const planId = choice.state === 'saved' ? choice.exitPlanId : choice.baseExitPlanId;
  let plan: typeof exitPlans.$inferSelect | null = null;
  if (planId !== null) {
    const found = await tx.query.exitPlans.findFirst({
      where: and(eq(exitPlans.id, planId), eq(exitPlans.workspaceId, workspaceId)),
    });
    if (found === undefined || found.isArchived) return { ok: false };
    plan = found;
  }
  if (choice.state === 'saved') {
    if (plan === null) return { ok: false };
    if (
      choice.provenance === 'strategy_default' &&
      (strategyId === null || plan.strategyId !== strategyId)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      value: {
        exitPlanState: 'saved',
        exitPlanProvenance: choice.provenance,
        exitPlanId: plan.id,
        exitPlanName: plan.name,
        exitPlanInstructions: plan.instructions,
      },
    };
  }
  const instructions = choice.instructions.trim();
  if (instructions === '') return { ok: false };
  return {
    ok: true,
    value: {
      exitPlanState: 'customized',
      exitPlanProvenance: 'selected',
      exitPlanId: plan?.id ?? null,
      exitPlanName: plan?.name ?? null,
      exitPlanInstructions: instructions,
    },
  };
}

/**
 * Internal transaction primitive for canonical Trade/Plan/Actual-opening
 * persistence. It deliberately accepts an existing executor and never opens
 * or commits a transaction, so Phase 15G.5B can reuse it inside the SAME
 * outer completed-create transaction. The export is an internal service
 * composition seam, not a public action or transaction owner.
 */
export async function createTradeInTx(
  tx: Executor,
  workspaceId: string,
  userId: string,
  input: CreateTradeInput,
  clock: Clock,
  path: 'at_entry' | 'completed',
  /** `tradeMutationFingerprint(path, <the caller's request>)`. */
  fingerprint: string,
): Promise<CreateTradeResult> {
  // Steps 1–2.
  const membershipDenial = await lockWorkspaceAndVerifyMembership(tx, workspaceId, userId);
  if (membershipDenial !== null) return { ok: false, code: membershipDenial };

  // Step 3 — exact workspace-scoped mutation-key replay lookup, BEFORE
  // entitlement. The replay is compared with the REQUEST that created the
  // Trade (its stored fingerprint), never with the stored Trade, whose fields
  // may legitimately have been edited since (locked Phase 08B decision) —
  // see `replayOf`.
  const existing = await tx.query.trades.findFirst({
    where: and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, input.mutationKey)),
  });
  if (existing !== undefined) return replayOf(existing, fingerprint);

  // Step 4.
  const denial = await resolveMutationDenial(tx, workspaceId, clock);
  if (denial !== null) return { ok: false, code: denial };

  const emotionsRecorded = input.emotionKeys !== undefined;
  const entryEmotions = await resolveEmotionTypesInTx(tx, input.emotionKeys ?? []);
  if (!entryEmotions.ok) return entryEmotions;
  const selectedEmotionTypes = entryEmotions.value;
  const postTradeEmotionsRecorded = input.postTradeEmotionKeys !== undefined;
  const postTradeEmotions = await resolveEmotionTypesInTx(tx, input.postTradeEmotionKeys ?? []);
  if (!postTradeEmotions.ok) return postTradeEmotions;

  const symbol = normalizeRequiredText(input.symbol);
  if (!symbol.ok) return { ok: false, code: 'blank_symbol' };
  if (!isTradeDirection(input.direction)) return { ok: false, code: 'invalid_direction' };

  if (input.recordingTiming === 'after_trade' && path !== 'completed') {
    return { ok: false, code: 'completed_trade_path_required' };
  }

  const planAuthority = validateNewWritePlanAuthority(input, input.systemPlanBasis, {
    // Pre-15G.5A internal callers remain source-compatible. The action
    // boundary and normal UI supply the explicit basis for every new
    // canonical write.
    allowInferredBasis: input.recordingTiming === undefined,
  });
  if (!planAuthority.ok) return { ok: false, code: 'invalid_plan_authority' };

  // Since migration 0016 (Phase 14C.1) there is no "at least one
  // representation" floor here — `composePlannedR` (below) already
  // handles an entirely-absent Plan gracefully, returning `plannedR:
  // null`/`source: 'none'` rather than an error, exactly matching the
  // frozen Quick Capture contract (Trading Account + Symbol + Direction
  // alone is a valid, persistable Trade).
  //
  // `composePlannedR` validates whichever representation(s) are present
  // (never hand-duplicating the risk-per-unit/Money-ratio formulas) and
  // detects a Price/Money disagreement rather than silently picking one —
  // see `src/lib/calc/trade.ts`'s own doc comment.
  const contract = input.recordingContract === RECORDING_CONTRACT_ADD_TRADE_V1;
  const composed = composePlannedR({
    direction: input.direction,
    plannedEntry: input.plannedEntry ?? null,
    plannedStop: input.plannedStop ?? null,
    plannedTarget: input.plannedTarget ?? null,
    plannedRiskMinor: input.plannedRiskMinor ?? null,
    // A contract Target Profit without Risk at Entry is a remembered Target,
    // not an incomplete plan: Planned R is simply unavailable (contract §13).
    plannedRewardMinor:
      contract && input.plannedRiskMinor == null ? null : (input.plannedRewardMinor ?? null),
  });
  if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
  if (composed.value.mismatch) return { ok: false, code: 'planned_r_mismatch' };
  const plannedR = composed.value.plannedR;

  // Phase 14E — Open/Close-Only Trade Flow. `actualResultMode` present
  // means this Trade must be created already `open`; validated
  // identically to `openTrade`'s own Price/Money checks (same error
  // codes), just before the insert rather than in a second mutation.
  const defaultActualMode =
    input.recordingTiming === 'at_entry' ? planAuthority.systemPlanBasis : null;
  const actualResultMode = input.actualResultMode ?? defaultActualMode ?? undefined;
  const defaultingActualFromPlan =
    input.actualResultMode === undefined && actualResultMode !== undefined;
  const actualEntry =
    defaultingActualFromPlan && actualResultMode === 'price'
      ? (input.plannedEntry ?? null)
      : (input.actualEntry ?? null);
  const actualInitialStop =
    defaultingActualFromPlan && actualResultMode === 'price'
      ? (input.plannedStop ?? null)
      : (input.actualInitialStop ?? null);
  // Add Trade contract v1: Risk at Entry is the 1R baseline and Actual Risk
  // is separate Risk Discipline evidence. Matched copies Risk at Entry;
  // Different keeps the stated amount, or NULL when the amount is unknown.
  const actualInitialRiskMinor = contract
    ? contractActualRiskMinor({
        answer: input.actualRiskAnswer,
        riskAtEntryMinor: input.plannedRiskMinor ?? null,
        statedMinor: input.actualInitialRiskMinor ?? null,
      })
    : defaultingActualFromPlan && actualResultMode === 'money'
      ? (input.plannedRiskMinor ?? null)
      : (input.actualInitialRiskMinor ?? null);
  const openAtCreation = actualResultMode !== undefined;
  if (contract) {
    const contractFailure = validateContractCreate(input, actualResultMode, path);
    if (contractFailure !== null) return { ok: false, code: contractFailure };
  } else if (input.closedAtCreation !== undefined || input.postTradeEmotionKeys !== undefined) {
    // Closed-at-creation and Post-Trade Emotion are contract-era writes only.
    return { ok: false, code: 'invalid_plan_authority' };
  }
  const closedAtCreation = contract ? input.closedAtCreation : undefined;
  if (openAtCreation) {
    if (input.enteredAt === undefined && !contract) {
      return { ok: false, code: 'invalid_execution_context' };
    }
    if (actualResultMode === 'price') {
      if (actualInitialRiskMinor !== null) {
        return { ok: false, code: 'invalid_execution_context' };
      }
      const context = composeRealizedActual({
        actualResultMode: 'price',
        direction: input.direction,
        actualEntry,
        actualInitialStop,
        exits: [],
      });
      if (!context.ok) return { ok: false, code: 'invalid_execution_context' };
    } else {
      if (!contract && (actualInitialRiskMinor === null || actualInitialRiskMinor <= 0n)) {
        return { ok: false, code: 'invalid_initial_risk' };
      }
      if ((actualEntry === null) !== (actualInitialStop === null)) {
        return { ok: false, code: 'invalid_execution_context' };
      }
      if (actualEntry !== null) {
        const context = composeRealizedActual({
          actualResultMode: 'price',
          direction: input.direction,
          actualEntry,
          actualInitialStop,
          exits: [],
        });
        if (!context.ok) return { ok: false, code: 'invalid_execution_context' };
      }
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

  // Phase 14B: Strategy/Setup classification is optional at creation —
  // a Setup never exists without a Strategy, the same rule the Zod
  // schema and `trades_setup_requires_strategy_check` both enforce
  // (defense-in-depth, matching this module's usual posture).
  if (input.setupId !== undefined && input.strategyId === undefined) {
    return { ok: false, code: 'setup_requires_strategy' };
  }

  // Steps 6–12 — entirely skipped when no Strategy is selected (Phase
  // 14B; see the module doc comment on optional classification).
  // `strategyVersionId`/`setupId`/`setupVersionId` stay null in that
  // case, and no Version is ever locked/referenced.
  let strategyVersionId: string | null = null;
  let setupId: string | null = null;
  let setupVersionId: string | null = null;
  let classificationAssignedAt: Date | null = null;

  if (input.strategyId !== undefined) {
    const targetStrategyId = input.strategyId;
    classificationAssignedAt = clock.now();

    // Step 6.
    const strategyLock = await lockStrategyRowForTrade(tx, workspaceId, targetStrategyId);
    if (!strategyLock.ok) return strategyLock;
    if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

    // Steps 7–8.
    const versionLock = await lockCurrentVersionRowForTrade(tx, strategyLock.strategy);
    if (!versionLock.ok) return versionLock;
    const version = versionLock.version;
    strategyVersionId = version.id;

    if (input.setupId !== undefined) {
      const targetSetupId = input.setupId;

      // Step 9 — plain scoped read, not FOR UPDATE (see module comment).
      const setup = await tx.query.setups.findFirst({
        where: and(
          eq(setups.id, targetSetupId),
          eq(setups.workspaceId, workspaceId),
          eq(setups.strategyId, targetStrategyId),
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

      setupId = setup.id;
      setupVersionId = setupVersion.id;
    }

    // Step 12.
    const lockResult = await lockStrategyVersionForReferenceInTx(
      tx,
      {
        workspaceId,
        strategyId: targetStrategyId,
        versionId: version.id,
        actorUserId: userId,
      },
      clock,
    );
    if (!lockResult.ok) return lockResult;
  }

  // Add Trade contract v1 — the Exit Plan snapshot, resolved after the
  // Strategy so an inherited plan can be proven to belong to it.
  const exitPlanSnapshot = contract
    ? await resolveContractExitPlanInTx(tx, workspaceId, input.exitPlan, input.strategyId ?? null)
    : ({ ok: true, value: NO_EXIT_PLAN_SNAPSHOT } as const);
  if (!exitPlanSnapshot.ok) return { ok: false, code: 'invalid_exit_plan' };
  // Capture origin follows when an answer was supplied: at entry here, or
  // recalled after close for the completed-trade path (contract §7, §9).
  const origin: CaptureOrigin = path === 'at_entry' ? 'recorded_at_entry' : 'recalled_after_trade';

  // Step 13.
  const inserted = await tx
    .insert(trades)
    .values({
      workspaceId,
      mutationKey: input.mutationKey,
      mutationFingerprint: fingerprint,
      tradingAccountId: input.tradingAccountId,
      strategyId: input.strategyId ?? null,
      strategyVersionId,
      strategyAssignedAt: input.strategyId !== undefined ? classificationAssignedAt : null,
      setupId,
      setupVersionId,
      setupAssignedAt: setupId !== null ? classificationAssignedAt : null,
      symbol: symbol.value,
      direction: input.direction,
      timeframe: normalizeOptionalText(input.timeframe),
      session: normalizeOptionalText(input.session),
      confirmationNotes: normalizeOptionalText(input.confirmationNotes),
      confidence: input.confidence ?? null,
      emotionsRecordedAt: emotionsRecorded ? clock.now() : null,
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
      ...(contract
        ? {
            recordingContract: RECORDING_CONTRACT_ADD_TRADE_V1,
            enteredAtSource: input.enteredAt === undefined ? null : (input.enteredAtSource ?? null),
            plannedRiskState: input.plannedRiskState ?? null,
            plannedStopMethod: input.plannedStopMethod ?? null,
            targetState: input.targetState ?? null,
            targetPrice: input.targetPrice ?? null,
            contextEntryPrice: input.contextEntryPrice ?? null,
            contextStopPrice: input.contextStopPrice ?? null,
            contextPositionSize: input.contextPositionSize ?? null,
            actualRiskAnswer: input.actualRiskAnswer ?? null,
            ...exitPlanSnapshot.value,
            exitPlanInheritanceDeclined: input.exitPlanInheritanceDeclined === true,
            exitPlanOrigin:
              exitPlanSnapshot.value.exitPlanState !== null ||
              input.exitPlanInheritanceDeclined === true
                ? origin
                : null,
            noStrategy: input.noStrategy === true,
            noSetup: input.noSetup === true,
            /*
              CAPTURE ORIGIN IS CONTRACT-ERA EVIDENCE, so it is written ONLY on a
              contract row. It used to be written for every path, which stamped
              contract provenance onto legacy After Trade rows and made
              `recording_contract IS NULL AND strategy_origin IS NOT NULL`
              reachable in production — a legacy row wearing new-model
              provenance (contract §28). Migration 0022 refuses those rows; this
              is the writer that was producing them.
            */
            strategyOrigin:
              input.strategyId !== undefined || input.noStrategy === true ? origin : null,
            setupOrigin: input.setupId !== undefined || input.noSetup === true ? origin : null,
            confidenceOrigin: input.confidence != null ? origin : null,
            emotionsOrigin: emotionsRecorded ? origin : null,
            postTradeEmotionsRecordedAt: postTradeEmotionsRecorded ? clock.now() : null,
          }
        : {}),
      // Save Closed Trade: the row is born closed, with the trader's own
      // result and outcome exactly as given (contract §11–§13).
      ...(closedAtCreation !== undefined
        ? {
            status: 'closed' as const,
            actualResultMode: 'money' as const,
            actualInitialRiskMinor,
            enteredAt: input.enteredAt ?? null,
            ...closedAtCreation,
          }
        : {}),
      // Phase 14E — one atomic insert, never insert-then-update. Absent
      // `actualResultMode` leaves every field below at its column
      // default (`status = 'planned'`, everything else `null`) —
      // byte-for-byte the pre-14E row shape.
      ...(openAtCreation
        ? {
            status: 'open' as const,
            actualResultMode,
            actualEntry,
            actualInitialStop,
            actualInitialRiskMinor,
            actualPositionSize: input.actualPositionSize ?? null,
            enteredAt: input.enteredAt,
          }
        : {}),
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
    return replayOf(raced, fingerprint);
  }

  // Step 14 — skipped entirely without a Setup (Phase 14B): a Trade with
  // no Setup has no Conditions to answer, and none are ever fabricated.
  if (setupVersionId !== null) {
    const conditionSnapshots = await snapshotTradeSetupConditionsInTx(tx, {
      workspaceId,
      tradeId: created.id,
      setupVersionId,
      answers: input.conditionAnswers ?? [],
      allowUnanswered: contract,
      // "Don't remember" is an After Trade answer only (contract §8).
      allowUnknown: contract && path === 'completed',
      origin,
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
  }

  // Step 15 — same gate as Step 14: Rule checks are only ever snapshotted
  // against a fully-resolved Strategy Version + Setup Version pair,
  // unchanged from pre-14B behavior. A Strategy-only (no Setup) Trade
  // gets zero Rule check rows at creation, rather than inventing new
  // partial-snapshot semantics this phase's contract does not specify.
  if (strategyVersionId !== null && setupVersionId !== null) {
    await insertRuleSnapshotsInTx(tx, {
      workspaceId,
      tradeId: created.id,
      strategyVersionId,
      setupVersionId,
    });
  }

  const emotionRows = [
    ...selectedEmotionTypes.map((emotion) => ({ emotionTypeId: emotion.id, phase: 'entry' })),
    ...postTradeEmotions.value.map((emotion) => ({
      emotionTypeId: emotion.id,
      phase: 'post_trade',
    })),
  ];
  if (emotionRows.length > 0) {
    await tx
      .insert(tradeEmotions)
      .values(emotionRows.map((row) => ({ ...row, tradeId: created.id, workspaceId })));
  }

  // Step 16. Atomic completed creation defers its sole audit write until
  // Actual exits and the optional System outcome have also succeeded.
  if (path === 'at_entry') {
    await insertAuditLog(tx, {
      action: 'trade.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: created.id,
      metadata: {
        tradeId: created.id,
        tradingAccountId: input.tradingAccountId,
        // Phase 14E — the normal customer flow now creates a Trade already
        // `open`; the legacy/internal `planned` path remains reachable
        // (never produced by the normal New Trade form) — this makes
        // which one happened explicit in the audit trail, reusing the
        // same `newStatus` field `openTrade`'s own audit event uses.
        newStatus: openAtCreation ? 'open' : 'planned',
        // Phase 14B: omitted entirely (never `null`) when unclassified —
        // `AuditLogMetadata`'s fields are `string | undefined`, never
        // `string | null`, under `exactOptionalPropertyTypes`.
        ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
        ...(strategyVersionId !== null ? { strategyVersionId } : {}),
        ...(setupId !== null ? { setupId } : {}),
        ...(setupVersionId !== null ? { setupVersionId } : {}),
      },
    });
  }

  return { ok: true, tradeId: created.id, alreadyCreated: false };
}

/**
 * Public At Entry create wrapper. Authorization, entitlement, snapshots,
 * persistence and audit remain one atomic transaction; only post-rollback
 * private-storage cleanup stays outside it.
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
    const fingerprint = tradeMutationFingerprint('at_entry', input);
    result = await db.transaction((tx) =>
      createTradeInTx(tx, workspaceId, userId, input, clock, 'at_entry', fingerprint),
    );
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
  /** Omit to edit the current basis; supply to explicitly switch basis. */
  readonly systemPlanBasis?: SystemPlanBasis;
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
        | 'invalid_plan_authority'
        | 'no_plan_representation'
        | 'planned_r_mismatch';
      readonly calcReason?: CalcFailureReason;
    };

/**
 * Plan and context fields are never gated by Trade status — a Trade remains
 * a correctable measurement record at every lifecycle stage (CLAUDE.md
 * A7/`docs/data-dictionary.md`). Recomputes `planned_r` whenever entry/stop/
 * target participate in this edit. A confirmed System result is historical
 * truth: this path never rewrites its gross/net/outcome or dependency snapshot.
 * A dependency divergence is derived as `needs_review`; only explicit System
 * correction re-confirms against current inputs. All validation happens before
 * any write, so an invalid correction is rejected atomically.
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

    // A contract row keeps Money as result authority: its plan is edited as
    // amounts only, never re-based onto price geometry.
    if (isContractRow(trade)) {
      const touchesPrice =
        (['plannedEntry', 'plannedStop', 'plannedTarget', 'plannedPositionSize'] as const).some(
          (field) => Object.hasOwn(input, field) && input[field] != null,
        ) ||
        (input.systemPlanBasis !== undefined && input.systemPlanBasis !== 'money');
      if (touchesPrice) return { ok: false, code: 'invalid_plan_authority' };
    }

    let resolved = resolvePlanFieldsPatch(
      {
        plannedEntry: trade.plannedEntry,
        plannedStop: trade.plannedStop,
        plannedTarget: trade.plannedTarget,
        plannedRiskMinor: trade.plannedRiskMinor,
        plannedRewardMinor: trade.plannedRewardMinor,
      },
      input,
    );

    let nextPlannedPositionSize =
      'plannedPositionSize' in input
        ? (input.plannedPositionSize ?? null)
        : trade.plannedPositionSize;
    const currentPlanBasis = inferPersistedSystemPlanBasis({
      ...trade,
      plannedPositionSize: trade.plannedPositionSize,
    });

    if (input.systemPlanBasis !== undefined) {
      const suppliesConflictingFields =
        input.systemPlanBasis === 'price'
          ? (Object.hasOwn(input, 'plannedRiskMinor') && input.plannedRiskMinor != null) ||
            (Object.hasOwn(input, 'plannedRewardMinor') && input.plannedRewardMinor != null)
          : (Object.hasOwn(input, 'plannedEntry') && input.plannedEntry != null) ||
            (Object.hasOwn(input, 'plannedStop') && input.plannedStop != null) ||
            (Object.hasOwn(input, 'plannedTarget') && input.plannedTarget != null) ||
            (Object.hasOwn(input, 'plannedPositionSize') && input.plannedPositionSize != null);
      if (suppliesConflictingFields) {
        return { ok: false, code: 'invalid_plan_authority' };
      }

      if (input.systemPlanBasis === 'price') {
        resolved = {
          ...resolved,
          plannedRiskMinor: null,
          plannedRewardMinor: null,
          planFieldsTouched: true,
        };
      } else {
        const entryOrStopChanged = resolved.plannedEntry !== null || resolved.plannedStop !== null;
        resolved = {
          ...resolved,
          plannedEntry: null,
          plannedStop: null,
          plannedTarget: null,
          plannedRiskMinor: resolved.plannedRiskMinor,
          plannedRewardMinor: resolved.plannedRewardMinor,
          planFieldsTouched: true,
          entryOrStopChanged: resolved.entryOrStopChanged || entryOrStopChanged,
        };
        nextPlannedPositionSize = null;
      }
    }

    const nextPlanBasis = inferPersistedSystemPlanBasis({
      ...resolved,
      plannedPositionSize: nextPlannedPositionSize,
    });
    if (nextPlanBasis === 'dual' && currentPlanBasis !== 'dual') {
      return { ok: false, code: 'invalid_plan_authority' };
    }
    if (input.systemPlanBasis !== undefined && nextPlanBasis !== input.systemPlanBasis) {
      return { ok: false, code: 'no_plan_representation' };
    }

    let plannedR = trade.plannedR;

    if (resolved.planFieldsTouched) {
      // The Founder-UAT "minimum plan validity" floor — an edit must never
      // leave a Trade with neither a Price nor a Money representation.
      // A contract row's Risk at Entry rule is its own (see below): required
      // while open, optional once closed.
      const hasPricePlan = resolved.plannedEntry !== null && resolved.plannedStop !== null;
      const hasMoneyPlan = resolved.plannedRiskMinor !== null;
      if (!hasPricePlan && !hasMoneyPlan && !isContractRow(trade)) {
        return { ok: false, code: 'no_plan_representation' };
      }

      const composed = composePlannedR({
        direction: trade.direction,
        plannedEntry: resolved.plannedEntry,
        plannedStop: resolved.plannedStop,
        plannedTarget: resolved.plannedTarget,
        plannedRiskMinor: resolved.plannedRiskMinor,
        plannedRewardMinor:
          isContractRow(trade) && resolved.plannedRiskMinor === null
            ? null
            : resolved.plannedRewardMinor,
      });
      if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
      if (composed.value.mismatch) return { ok: false, code: 'planned_r_mismatch' };
      plannedR = composed.value.plannedR;
    }

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

    // Add Trade contract v1: Target Profit implies an explicit Fixed Target, a
    // Fixed Target keeps a representation, a Matched Actual Risk follows Risk at
    // Entry, and a closed Trade re-measures Actual R against the new 1R baseline.
    let nextTargetState = trade.targetState;
    let nextActualInitialRiskMinor = trade.actualInitialRiskMinor;
    let nextActualR = trade.actualR;
    let nextTraderOutcome = trade.traderOutcome;
    let nextCalcVersion = trade.calcVersion;
    if (isContractRow(trade)) {
      /*
        RISK AT ENTRY IS REQUIRED WHILE OPEN, OPTIONAL ONCE CLOSED (contract §6,
        §13). A historical Trade may have none. It still cannot be removed where
        something rests on it: a Matched Actual Risk, or an outcome the
        pre-contract close derived from R.
      */
      const derivedOutcome = trade.traderOutcome !== null && trade.traderOutcomeSelectedAt === null;
      if (
        resolved.plannedRiskMinor === null &&
        (trade.status !== 'closed' || derivedOutcome || trade.actualRiskAnswer === 'matched')
      ) {
        return { ok: false, code: 'no_plan_representation' };
      }
      if (resolved.plannedRewardMinor !== trade.plannedRewardMinor) {
        if (resolved.plannedRewardMinor !== null) {
          if (resolved.plannedRewardMinor <= 0n) return { ok: false, code: 'invalid_plan' };
          nextTargetState = 'fixed';
        } else if (trade.targetPrice === null && trade.targetState === 'fixed') {
          return { ok: false, code: 'no_plan_representation' };
        }
      }
      if (resolved.plannedRiskMinor !== trade.plannedRiskMinor) {
        if (trade.actualRiskAnswer === 'matched') {
          nextActualInitialRiskMinor = resolved.plannedRiskMinor;
        } else if (
          trade.actualRiskAnswer === 'different' &&
          trade.actualInitialRiskMinor === resolved.plannedRiskMinor
        ) {
          /*
            REFUSED, NEVER SILENTLY FLIPPED TO MATCHED. The trader explicitly
            said Actual Risk differed; a Risk at Entry equal to that amount
            would contradict the answer, and rewriting it without asking would
            overwrite an explicit observation (contract §4).
          */
          return { ok: false, code: 'invalid_plan' };
        }
        if (trade.status === 'closed' && trade.netPnlMinor !== null) {
          if (derivedOutcome) {
            const recomputed = composeTraderClose(trade.netPnlMinor, resolved.plannedRiskMinor);
            if (!recomputed.ok) {
              return { ok: false, code: 'invalid_plan', calcReason: recomputed.reason };
            }
            nextActualR = recomputed.value.actualR;
            nextTraderOutcome = recomputed.value.traderOutcome;
            nextCalcVersion = recomputed.value.calcVersion;
          } else if (resolved.plannedRiskMinor === null) {
            // No 1R baseline, no Actual R — never a stale or invented figure.
            nextActualR = null;
          } else {
            // The trader's outcome (or Unanswered) stays; only R is re-measured.
            const measured = actualR(trade.netPnlMinor, resolved.plannedRiskMinor);
            if (!measured.ok)
              return { ok: false, code: 'invalid_plan', calcReason: measured.reason };
            nextActualR = measured.value;
          }
        }
      }
    }

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
    if (nextTargetState !== trade.targetState) changedFields.push('targetState');
    if (nextActualR !== trade.actualR) changedFields.push('actualR');

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
        /*
          First supply records its origin; a later change is a revision and
          never rewrites the origin (contract §9). A LEGACY ROW RECORDS
          NEITHER — those columns describe contract-era capture, and a legacy
          row keeps its own provenance (contract §28).
        */
        ...(isContractRow(trade)
          ? {
              confidenceOrigin:
                nextConfidence !== trade.confidence &&
                nextConfidence !== null &&
                trade.confidenceOrigin === null &&
                trade.confidence === null
                  ? laterCaptureOrigin(trade.status)
                  : trade.confidenceOrigin,
              confidenceRevisedAt:
                nextConfidence !== trade.confidence && trade.confidence !== null
                  ? new Date()
                  : trade.confidenceRevisedAt,
            }
          : {}),
        targetState: nextTargetState,
        actualInitialRiskMinor: nextActualInitialRiskMinor,
        actualR: nextActualR,
        traderOutcome: nextTraderOutcome,
        calcVersion: nextCalcVersion,
        tradingviewUrl: nextTradingviewUrl,
        notes: nextNotes,
        plannedR,
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
        | 'planned_r_mismatch';
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
 * bigints, never prices). Confirmed System fields never recompute here either:
 * a price dependency change makes their frozen snapshot stale until explicit
 * System reconfirmation.
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

    const directionChanged = input.direction !== undefined && input.direction !== trade.direction;
    const entryStopTouched = input.plannedEntry !== undefined || input.plannedStop !== undefined;

    if (directionChanged && !isTradeDirection(input.direction as string)) {
      return { ok: false, code: 'invalid_direction' };
    }
    if (directionChanged) nextDirection = input.direction as string;
    if (input.plannedEntry !== undefined) nextEntry = input.plannedEntry;
    if (input.plannedStop !== undefined) nextStop = input.plannedStop;

    const currentPlanBasis = inferPersistedSystemPlanBasis({
      ...trade,
      plannedPositionSize: trade.plannedPositionSize,
    });
    const nextPlanBasis = inferPersistedSystemPlanBasis({
      ...trade,
      plannedEntry: nextEntry,
      plannedStop: nextStop,
      plannedPositionSize: trade.plannedPositionSize,
    });
    if (currentPlanBasis !== 'dual' && nextPlanBasis === 'dual') {
      return { ok: false, code: 'invalid_plan' };
    }

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
        plannedRewardMinor:
          isContractRow(trade) && trade.plannedRiskMinor === null ? null : trade.plannedRewardMinor,
      });
      if (!composed.ok) return { ok: false, code: 'invalid_plan', calcReason: composed.reason };
      if (composed.value.mismatch) return { ok: false, code: 'planned_r_mismatch' };
      plannedR = composed.value.plannedR;
    }

    const changedFields: string[] = [];
    if (nextSymbol !== trade.symbol) changedFields.push('symbol');
    if (nextDirection !== trade.direction) changedFields.push('direction');
    if (nextEntry !== trade.plannedEntry) changedFields.push('plannedEntry');
    if (nextStop !== trade.plannedStop) changedFields.push('plannedStop');
    if (plannedR !== trade.plannedR) changedFields.push('plannedR');

    if (changedFields.length === 0) return { ok: true, changedFields: [], plannedR };

    await tx
      .update(trades)
      .set({
        symbol: nextSymbol,
        direction: nextDirection,
        plannedEntry: nextEntry,
        plannedStop: nextStop,
        plannedR,
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

    // Phase 14B: Opening must not require classification — only re-check
    // archival for whichever of Strategy/Setup this Trade actually has
    // pinned (frozen contract §11: "Opening must NOT require: Strategy,
    // Setup...").
    if (trade.strategyId !== null) {
      const strategy = await tx.query.strategies.findFirst({
        where: and(eq(strategies.id, trade.strategyId), eq(strategies.workspaceId, workspaceId)),
      });
      if (strategy === undefined) return { ok: false, code: 'strategy_not_found' };
      if (strategy.isArchived) return { ok: false, code: 'strategy_archived' };
    }

    if (trade.setupId !== null) {
      const setup = await tx.query.setups.findFirst({
        where: and(eq(setups.id, trade.setupId), eq(setups.workspaceId, workspaceId)),
      });
      if (setup === undefined) return { ok: false, code: 'setup_not_found' };
      if (setup.isArchived) return { ok: false, code: 'setup_archived' };
    }

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
  /** Authoritative final net P&L for the whole Trade, not only the remaining Exit leg. */
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
        | 'invalid_exit_time'
        | 'contract_close_required';
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
    // RETIRED FOR CONTRACT TRADES: the canonical Final Close is the only way a
    // contract Trade closes. Checked before the retry branch, so no stale
    // client can replay its way past it. Legacy Trades keep this path.
    if (isContractRow(trade)) return { ok: false, code: 'contract_close_required' };

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
    if (!existingExits.every(isCompleteExecutionExit)) {
      return { ok: false, code: 'invalid_status_transition' };
    }
    const priorActual = composeRealizedActual({
      actualResultMode: 'money',
      direction: trade.direction,
      actualEntry: trade.actualEntry,
      actualInitialStop: trade.actualInitialStop,
      actualInitialRiskMinor: actualRDenominatorMinor(trade),
      exits: existingExits,
    });
    if (!priorActual.ok)
      return { ok: false, code: 'invalid_status_transition', calcReason: priorActual.reason };
    if (priorActual.value.realizedPnlMinor === null) {
      return { ok: false, code: 'invalid_status_transition' };
    }
    const remainingBps = 10_000 - priorActual.value.closedBps;
    if (remainingBps <= 0) return { ok: false, code: 'invalid_status_transition' };
    const remainingPnlMinor = input.netPnlMinor - priorActual.value.realizedPnlMinor;
    const [newExit] = await tx
      .insert(tradeExits)
      .values({
        workspaceId,
        tradeId,
        sequence: existingExits.reduce((max, exit) => Math.max(max, exit.sequence), 0) + 1,
        closedBps: remainingBps,
        exitPrice: input.actualExit,
        realizedPnlMinor: remainingPnlMinor,
        exitedAt: input.exitedAt,
      })
      .returning();
    if (newExit === undefined) throw new Error('closeTrade: Exit insert returned no row');
    if (!isCompleteExecutionExit(newExit)) {
      throw new Error('closeTrade: strict Exit insert returned incomplete row');
    }
    const allExits = [...existingExits, newExit];
    const composed = composeTraderCloseV2({
      actualResultMode: 'money',
      direction: trade.direction,
      actualEntry: trade.actualEntry,
      actualInitialStop: trade.actualInitialStop,
      actualInitialRiskMinor: actualRDenominatorMinor(trade),
      exits: allExits,
    });
    if (!composed.ok)
      return { ok: false, code: 'invalid_status_transition', calcReason: composed.reason };
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
        netPnlMinor: input.netPnlMinor,
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
    /*
      A CLOSED CONTRACT ROW WHOSE OUTCOME IS THE TRADER'S (or Unanswered) holds
      a stated Final Net P&L. This correction rebuilds the result from exit legs
      and derives the outcome — both forbidden there (contract §11, §12). Its
      result is corrected through the historical-execution service instead.
    */
    if (hasStatedClosedResult(trade)) return { ok: false, code: 'invalid_execution_context' };

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

    // A contract row never gains Price authority or a Price-mode result.
    if (
      isContractRow(trade) &&
      (nextActualResultMode !== 'money' ||
        nextActualEntry !== null ||
        nextActualInitialStop !== null)
    ) {
      return { ok: false, code: 'invalid_execution_context' };
    }
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
    } else if (nextActualInitialRiskMinor === null && !isContractRow(trade)) {
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
      (nextEnteredAt === null && !isContractRow(trade)) ||
      exits.some(
        (exit) =>
          exit.exitedAt === null ||
          (nextEnteredAt !== null && exit.exitedAt.getTime() < nextEnteredAt.getTime()),
      )
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
      if (!exits.every(isCompleteExecutionExit)) {
        return { ok: false, code: 'invalid_execution_context' };
      }
      const calculation = {
        actualResultMode: nextActualResultMode,
        direction: trade.direction,
        actualEntry: nextActualEntry,
        actualInitialStop: nextActualInitialStop,
        actualInitialRiskMinor: isContractRow(trade)
          ? trade.plannedRiskMinor
          : nextActualInitialRiskMinor,
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
        ...(isContractRow(trade) && nextActualInitialRiskMinor !== trade.actualInitialRiskMinor
          ? {
              actualRiskAnswer:
                nextActualInitialRiskMinor !== null &&
                nextActualInitialRiskMinor === trade.plannedRiskMinor
                  ? ('matched' as const)
                  : ('different' as const),
            }
          : {}),
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

export interface SystemAssessmentMetadataInput {
  readonly systemPlanProvenance?: SystemPlanProvenance | undefined;
  readonly planAdherence?: PlanAdherence | null | undefined;
}

interface SystemResolveCommonInput extends SystemAssessmentMetadataInput {
  /**
   * NULL where the resolution's meaning does not depend on an instant. A
   * counterfactual does not need a fabricated closing time to have a magnitude;
   * only a `time_exit` genuinely does, which the schema's consistency CHECK
   * enforces.
   */
  readonly systemExitedAt: Date | null;
  /** NULL = the cost was never estimated. Never coerced to zero. */
  readonly systemCostR: string | null;
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

/**
 * TWO SHAPES, AND THE DIFFERENCE IS WHETHER THE COST IS KNOWN.
 *
 * `systemGrossR` is always present — the gross figure is what the resolution
 * produces, and it is frozen so a later engine change cannot rewrite a result a
 * trader confirmed. When the cost is unknown, `systemR` and `systemOutcome` are
 * NULL together: a net figure does not exist, and classifying an outcome from a
 * gross number would answer a question the record cannot answer.
 */
type PreparedSystemResolution = {
  readonly systemResolutionKind: SystemResolutionKind;
  readonly systemExitPrice: string | null;
  readonly systemGrossRInput: string | null;
  readonly systemExitedAt: Date | null;
  readonly systemExitReason: string;
  readonly systemGrossR: string;
  readonly systemCostR: string | null;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
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

  const grossInput = {
    resolutionKind: input.resolutionKind,
    direction: trade.direction,
    plannedEntry: trade.plannedEntry,
    plannedStop: trade.plannedStop,
    plannedRiskMinor: trade.plannedRiskMinor,
    plannedRewardMinor: trade.plannedRewardMinor,
    systemExitPrice: input.resolutionKind === 'price_exit' ? input.systemExitPrice : null,
    systemGrossRInput: input.resolutionKind === 'money_custom' ? input.systemGrossRInput : null,
  };

  /*
    ONE ENGINE, TWO ENDINGS. Both branches derive the gross figure through the
    same `resolveSystemGrossR`; the costed one goes on to subtract and classify,
    the uncosted one stops. Nothing here invents a zero to make the second branch
    look like the first.
  */
  const composed =
    input.systemCostR === null
      ? composeSystemResolveGrossOnly(grossInput)
      : composeSystemResolveV2({ ...grossInput, systemCostR: input.systemCostR });
  if (!composed.ok) {
    return {
      ok: false,
      code: 'invalid_system_status_transition',
      calcReason: composed.reason,
    };
  }

  const exitReason =
    input.resolutionKind === 'price_exit'
      ? input.systemExitReason
      : MONEY_SYSTEM_EXIT_REASON[input.resolutionKind];

  // A time-based exit is the one resolution whose own meaning needs an instant.
  // Mirrors `trades_system_status_consistency_check` rather than trusting it.
  if (exitReason === 'time_exit' && input.systemExitedAt === null) {
    return { ok: false, code: 'invalid_system_exit_reason' };
  }

  return {
    ok: true,
    value: {
      systemResolutionKind: input.resolutionKind,
      systemExitPrice: input.resolutionKind === 'price_exit' ? input.systemExitPrice : null,
      systemGrossRInput: input.resolutionKind === 'price_exit' ? null : composed.value.grossSystemR,
      systemExitedAt: input.systemExitedAt,
      systemExitReason: exitReason,
      systemGrossR: composed.value.grossSystemR,
      systemCostR: composed.value.systemCostR,
      systemR: composed.value.systemR,
      systemOutcome: composed.value.systemOutcome,
      calcVersion: composed.value.calcVersion,
    },
  };
}

export type ResolveSystemTradeResult =
  | {
      readonly ok: true;
      /** NULL when the cost was unknown — the result is gross-only. */
      readonly systemR: string | null;
      readonly systemOutcome: OutcomeValue | null;
    }
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
export async function resolveSystemTradeInTx(
  tx: Executor,
  workspaceId: string,
  userId: string,
  tradeId: string,
  trade: TradeRow,
  input: ResolveSystemTradeInput,
  clock: Clock,
  emitAudit: boolean,
): Promise<ResolveSystemTradeResult> {
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
      systemGrossR: prepared.value.systemGrossR,
      systemCostR: prepared.value.systemCostR,
      systemResolvedAt: clock.now(),
      systemR: prepared.value.systemR,
      systemOutcome: prepared.value.systemOutcome,
      /*
        THE FACTS THIS RESULT RESTS ON, FROZEN BESIDE IT.

        Captured at confirmation so a later plan edit is DETECTABLE rather than
        silently re-arithmetic'd into a figure nobody assessed. Basis-scoped —
        a `money_custom` resolution records no planned target, because it did
        not read one. See `src/lib/calc/system-assessment.ts`.
      */
      systemDependencySnapshot: buildSystemDependencySnapshot({
        systemResolutionKind: prepared.value.systemResolutionKind,
        systemExitReason: prepared.value.systemExitReason,
        strategyVersionId: trade.strategyVersionId,
        setupVersionId: trade.setupVersionId,
        plannedRiskMinor: trade.plannedRiskMinor,
        plannedRewardMinor: trade.plannedRewardMinor,
        plannedEntry: trade.plannedEntry,
        plannedStop: trade.plannedStop,
      }),
      systemPlanProvenance: input.systemPlanProvenance ?? trade.systemPlanProvenance,
      planAdherence: input.planAdherence === undefined ? trade.planAdherence : input.planAdherence,
      calcVersion: prepared.value.calcVersion,
      updatedAt: new Date(),
    })
    .where(eq(trades.id, tradeId));

  if (emitAudit) {
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
  }

  return {
    ok: true,
    systemR: prepared.value.systemR,
    systemOutcome: prepared.value.systemOutcome,
  };
}

export async function resolveSystemTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: ResolveSystemTradeInput,
  clock: Clock = systemClock,
): Promise<ResolveSystemTradeResult> {
  return getDb().transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    return resolveSystemTradeInTx(tx, workspaceId, userId, tradeId, ctx.trade, input, clock, true);
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
export type MarkSystemCannotDetermineResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: WorkspaceAccessDenial | 'trade_not_found' | 'invalid_system_status_transition';
    };

/**
 * "I ASSESSED THIS AND THE RULES CANNOT BE RECONSTRUCTED" — a finding, not a gap.
 *
 * `cannot_determine` IS NOT `pending`, and the distinction is the point. Pending
 * means nobody has looked; this means somebody did, and the evidence does not
 * support a System result. Collapsing them would turn every documented dead end
 * back into an open question and every open question into a documented dead end.
 *
 * NOTHING IS INVENTED. No gross R, no net R, no outcome, no resolution kind —
 * the whole result payload stays NULL. What it DOES carry is assessment
 * metadata: a confirmation timestamp and the dependency snapshot, because the
 * conclusion rests on the rules that were pinned when it was reached, and
 * re-classifying the Trade should send it back for review.
 */
export async function markSystemCannotDetermineInTx(
  tx: Executor,
  workspaceId: string,
  userId: string,
  tradeId: string,
  trade: TradeRow,
  clock: Clock,
  emitAudit: boolean,
  metadata: SystemAssessmentMetadataInput = {},
): Promise<MarkSystemCannotDetermineResult> {
  if (trade.systemStatus === 'cannot_determine') return { ok: true };
  if (trade.systemStatus !== 'pending') {
    return { ok: false, code: 'invalid_system_status_transition' };
  }

  await tx
    .update(trades)
    .set({
      systemStatus: 'cannot_determine',
      systemResolutionKind: null,
      systemExitPrice: null,
      systemGrossRInput: null,
      systemExitedAt: null,
      systemExitReason: null,
      systemCostR: null,
      systemResolvedAt: clock.now(),
      systemGrossR: null,
      systemR: null,
      systemOutcome: null,
      systemDependencySnapshot: buildSystemDependencySnapshot({
        systemResolutionKind: null,
        systemExitReason: null,
        strategyVersionId: trade.strategyVersionId,
        setupVersionId: trade.setupVersionId,
        plannedRiskMinor: trade.plannedRiskMinor,
        plannedRewardMinor: trade.plannedRewardMinor,
        plannedEntry: trade.plannedEntry,
        plannedStop: trade.plannedStop,
      }),
      systemPlanProvenance: metadata.systemPlanProvenance ?? trade.systemPlanProvenance,
      planAdherence:
        metadata.planAdherence === undefined ? trade.planAdherence : metadata.planAdherence,
      updatedAt: new Date(),
    })
    .where(eq(trades.id, tradeId));

  if (emitAudit) {
    await insertAuditLog(tx, {
      action: 'trade.system_cannot_determine',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'pending', newStatus: 'cannot_determine' },
    });
  }

  return { ok: true };
}

export async function markSystemNoTradeInTx(
  tx: Executor,
  workspaceId: string,
  userId: string,
  tradeId: string,
  trade: TradeRow,
  clock: Clock,
  emitAudit: boolean,
  metadata: SystemAssessmentMetadataInput = {},
): Promise<MarkSystemNoTradeResult> {
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
      // NULL, not '0'. There is no counterfactual execution to attribute a cost
      // to, and a zero here would read as a costed result of nothing.
      systemCostR: null,
      systemResolvedAt: clock.now(),
      systemGrossR: null,
      systemR: null,
      systemOutcome: null,
      /*
        A FINDING IS A COMPLETED ASSESSMENT, so it records what it rested on.

        `no_trade` says the pinned Strategy and Setup would not have permitted
        the trade — that conclusion is only as current as those versions, so
        re-classifying the Trade must flag it for review rather than leave a
        stale verdict looking settled.
      */
      systemDependencySnapshot: buildSystemDependencySnapshot({
        systemResolutionKind: null,
        systemExitReason: 'setup_invalidated',
        strategyVersionId: trade.strategyVersionId,
        setupVersionId: trade.setupVersionId,
        plannedRiskMinor: trade.plannedRiskMinor,
        plannedRewardMinor: trade.plannedRewardMinor,
        plannedEntry: trade.plannedEntry,
        plannedStop: trade.plannedStop,
      }),
      systemPlanProvenance: metadata.systemPlanProvenance ?? trade.systemPlanProvenance,
      planAdherence:
        metadata.planAdherence === undefined ? trade.planAdherence : metadata.planAdherence,
      updatedAt: new Date(),
    })
    .where(eq(trades.id, tradeId));

  if (emitAudit) {
    await insertAuditLog(tx, {
      action: 'trade.system_no_trade',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: { tradeId, previousStatus: 'pending', newStatus: 'no_trade' },
    });
  }

  return { ok: true };
}

export async function markSystemCannotDetermine(
  workspaceId: string,
  userId: string,
  tradeId: string,
  metadata: SystemAssessmentMetadataInput = {},
  clock: Clock = systemClock,
): Promise<MarkSystemCannotDetermineResult> {
  return getDb().transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    return markSystemCannotDetermineInTx(
      tx,
      workspaceId,
      userId,
      tradeId,
      ctx.trade,
      clock,
      true,
      metadata,
    );
  });
}

export async function markSystemNoTrade(
  workspaceId: string,
  userId: string,
  tradeId: string,
  metadata: SystemAssessmentMetadataInput = {},
  clock: Clock = systemClock,
): Promise<MarkSystemNoTradeResult> {
  return getDb().transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    return markSystemNoTradeInTx(
      tx,
      workspaceId,
      userId,
      tradeId,
      ctx.trade,
      clock,
      true,
      metadata,
    );
  });
}

// ---------------------------------------------------------------------------
// 10. correctSystemResolution
// ---------------------------------------------------------------------------

export type CorrectSystemResolutionInput =
  | (ResolveSystemTradeInput & { readonly target: 'resolved' })
  | (SystemAssessmentMetadataInput & {
      readonly target: 'no_trade' | 'cannot_determine';
    });

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
 * The explicit correction/reconfirmation path for the System axis. It moves
 * among the three terminal findings (`resolved`, `no_trade`, and
 * `cannot_determine`) and never reverts terminal System state to `pending` —
 * that target does not exist in
 * {@link CorrectSystemResolutionInput}'s type, so it is structurally
 * unreachable, not merely runtime-checked. Requires `system_status` to
 * already be terminal — a `pending` Trade has nothing to
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

    if (
      trade.systemStatus !== 'resolved' &&
      trade.systemStatus !== 'no_trade' &&
      trade.systemStatus !== 'cannot_determine'
    ) {
      return { ok: false, code: 'invalid_system_status_transition' };
    }

    const previousStatus = trade.systemStatus;

    if (input.target !== 'resolved') {
      const findingStatus = input.target;
      const findingReason = findingStatus === 'no_trade' ? 'setup_invalidated' : null;
      await tx
        .update(trades)
        .set({
          systemStatus: findingStatus,
          systemResolutionKind: null,
          systemExitPrice: null,
          systemGrossRInput: null,
          systemExitedAt: null,
          systemExitReason: findingReason,
          /*
            NOT `'0'`. A no_trade finding has no cost because it has no trade,
            and the old zero here was schema-mandated filler from when the
            column could not be NULL — the shape migration 0017 removed.
          */
          systemCostR: null,
          systemResolvedAt: clock.now(),
          systemGrossR: null,
          systemR: null,
          systemOutcome: null,
          systemDependencySnapshot: buildSystemDependencySnapshot({
            systemResolutionKind: null,
            systemExitReason: findingReason,
            strategyVersionId: trade.strategyVersionId,
            setupVersionId: trade.setupVersionId,
            plannedRiskMinor: trade.plannedRiskMinor,
            plannedRewardMinor: trade.plannedRewardMinor,
            plannedEntry: trade.plannedEntry,
            plannedStop: trade.plannedStop,
          }),
          systemPlanProvenance: input.systemPlanProvenance ?? trade.systemPlanProvenance,
          planAdherence:
            input.planAdherence === undefined ? trade.planAdherence : input.planAdherence,
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
          newStatus: findingStatus,
          changedFields: [
            'systemStatus',
            'systemResolutionKind',
            'systemExitPrice',
            'systemGrossRInput',
            'systemExitReason',
            'systemGrossR',
            'systemR',
            'systemOutcome',
            'systemDependencySnapshot',
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
        systemGrossR: prepared.value.systemGrossR,
        systemCostR: prepared.value.systemCostR,
        systemResolvedAt: clock.now(),
        systemR: prepared.value.systemR,
        systemOutcome: prepared.value.systemOutcome,
        /*
          A CORRECTION IS A RE-CONFIRMATION, so it promotes a FRESH snapshot.

          This is the one path by which a Trade flagged `needs_review` returns
          to trusted comparison: a human has looked at the moved dependency and
          said what the System result is against it. Carrying the old snapshot
          forward would leave the Trade flagged forever; omitting the snapshot
          entirely — as this path did before — leaves a resolved row that
          analytics cannot trust at all.
        */
        systemDependencySnapshot: buildSystemDependencySnapshot({
          systemResolutionKind: prepared.value.systemResolutionKind,
          systemExitReason: prepared.value.systemExitReason,
          strategyVersionId: trade.strategyVersionId,
          setupVersionId: trade.setupVersionId,
          plannedRiskMinor: trade.plannedRiskMinor,
          plannedRewardMinor: trade.plannedRewardMinor,
          plannedEntry: trade.plannedEntry,
          plannedStop: trade.plannedStop,
        }),
        systemPlanProvenance: input.systemPlanProvenance ?? trade.systemPlanProvenance,
        planAdherence:
          input.planAdherence === undefined ? trade.planAdherence : input.planAdherence,
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
          'systemGrossR',
          'systemCostR',
          'systemR',
          'systemOutcome',
          'systemDependencySnapshot',
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

// ---------------------------------------------------------------------------
// 13. assignTradeClassification — late Strategy/Setup classification (Phase 14B)
// ---------------------------------------------------------------------------

export interface AssignTradeClassificationInput {
  /** Present exactly when assigning a first Strategy — omit to add a Setup under an already-pinned Strategy. */
  readonly strategyId?: string;
  /** Present alongside `strategyId` (assign Strategy+Setup together) or alone (add a Setup under an already-pinned Strategy). */
  readonly setupId?: string;
}

export type AssignTradeClassificationResult =
  | {
      readonly ok: true;
      readonly strategyId: string;
      readonly strategyVersionId: string;
      readonly setupId: string | null;
      readonly setupVersionId: string | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | WorkspaceAccessDenial
        | 'trade_not_found'
        | 'invalid_classification_request'
        | 'strategy_not_found'
        | 'strategy_archived'
        | 'strategy_current_version_missing'
        | 'setup_not_found'
        | 'setup_archived'
        | 'setup_snapshot_missing';
    };

/**
 * Late Strategy/Setup classification (Phase 14B) — the ONLY mutation that
 * writes `trades.strategy_id`/`strategy_version_id`/`setup_id`/
 * `setup_version_id`/`strategy_assigned_at`/`setup_assigned_at` after
 * `createTrade`'s own insert. Deliberately supports only the three
 * sanctioned progressive transitions (Phase 14B contract §3/§7/§12):
 *
 *   A. no framework -> Strategy only
 *   B. no framework -> Strategy + Setup
 *   C. Strategy only -> Strategy + Setup
 *
 * Arbitrary reclassification — changing an already-pinned Strategy, or
 * changing/clearing an already-pinned Setup — is deliberately UNSUPPORTED in
 * this phase and rejected with `invalid_classification_request` (Phase 14B
 * contract §7: "Do NOT expose unrestricted arbitrary reclassification yet").
 * A future phase may add a dedicated, narrower `reclassify` operation once
 * the product has decided how it should interact with existing immutable
 * Setup Condition/Rule snapshots.
 *
 * Never creates `trade_setup_condition_checks` or `trade_rule_checks` rows —
 * a late-assigned Setup/Strategy has, by definition, no Conditions/Rules
 * genuinely captured at entry, and fabricating a snapshot now would misreport
 * history (Phase 14B contract §8: "Absolutely DO NOT create retrospective
 * condition snapshots"). `getWorkspaceTradeDetail`'s existing three-state
 * Setup Condition disclosure already renders this truthfully — a Trade with
 * zero `trade_setup_condition_checks` rows against a Setup Version that DOES
 * have configured Conditions reads as `not_recorded`, never `0%`.
 *
 * Version pinning reuses exactly `createTrade`'s own lock order and helpers
 * (`lockStrategyRowForTrade` -> `lockCurrentVersionRowForTrade` ->
 * `lockStrategyVersionForReferenceInTx`) — a late-assigned Strategy pins
 * whatever its CURRENT Version is at the moment of assignment, never a
 * version contemporaneous with the Trade's original entry (there wasn't
 * one). A Setup assigned alongside or after Strategy must resolve to the
 * `strategy_setup_versions` snapshot belonging to that SAME pinned Strategy
 * Version — never a mismatched/newer one — identical to `createTrade` step
 * 10.
 */
export async function assignTradeClassification(
  workspaceId: string,
  userId: string,
  tradeId: string,
  input: AssignTradeClassificationInput,
  clock: Clock = systemClock,
): Promise<AssignTradeClassificationResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ctx = await acquireTradeWriteContext(tx, { workspaceId, userId, tradeId, clock });
    if (!ctx.ok) return ctx;
    const { trade } = ctx;

    const assigningStrategy = input.strategyId !== undefined;
    const assigningSetup = input.setupId !== undefined;

    if (!assigningStrategy && !assigningSetup) {
      return { ok: false, code: 'invalid_classification_request' };
    }
    // Cases A/B: assigning a first Strategy — only valid while unclassified.
    if (assigningStrategy && trade.strategyId !== null) {
      return { ok: false, code: 'invalid_classification_request' };
    }
    // A bare `setupId` while unclassified is a Setup-without-Strategy
    // request — rejected here exactly as `trades_setup_requires_strategy_check`
    // would reject it at the database layer.
    if (assigningSetup && !assigningStrategy && trade.strategyId === null) {
      return { ok: false, code: 'invalid_classification_request' };
    }
    // Case C: adding a Setup alone — only valid with no Setup yet.
    if (assigningSetup && trade.setupId !== null) {
      return { ok: false, code: 'invalid_classification_request' };
    }

    const assignedAt = clock.now();

    let resolvedStrategyId: string;
    let resolvedStrategyVersionId: string;
    let resolvedStrategyAssignedAt: Date;

    if (assigningStrategy) {
      const targetStrategyId = input.strategyId;
      if (targetStrategyId === undefined) {
        throw new Error(
          'assignTradeClassification: unreachable — strategyId narrowed to undefined',
        );
      }
      const strategyLock = await lockStrategyRowForTrade(tx, workspaceId, targetStrategyId);
      if (!strategyLock.ok) return strategyLock;
      if (strategyLock.strategy.isArchived) return { ok: false, code: 'strategy_archived' };

      const versionLock = await lockCurrentVersionRowForTrade(tx, strategyLock.strategy);
      if (!versionLock.ok) return versionLock;

      const lockResult = await lockStrategyVersionForReferenceInTx(
        tx,
        {
          workspaceId,
          strategyId: targetStrategyId,
          versionId: versionLock.version.id,
          actorUserId: userId,
        },
        clock,
      );
      if (!lockResult.ok) return lockResult;

      resolvedStrategyId = targetStrategyId;
      resolvedStrategyVersionId = versionLock.version.id;
      resolvedStrategyAssignedAt = assignedAt;
    } else {
      // Guarded above: reaching here with `assigningSetup` true means
      // `trade.strategyId` is already pinned (Case C).
      if (
        trade.strategyId === null ||
        trade.strategyVersionId === null ||
        trade.strategyAssignedAt === null
      ) {
        throw new Error('assignTradeClassification: unreachable — Strategy already pinned');
      }
      resolvedStrategyId = trade.strategyId;
      resolvedStrategyVersionId = trade.strategyVersionId;
      resolvedStrategyAssignedAt = trade.strategyAssignedAt;
    }

    let resolvedSetupId: string | null = trade.setupId;
    let resolvedSetupVersionId: string | null = trade.setupVersionId;
    let resolvedSetupAssignedAt: Date | null = trade.setupAssignedAt;

    if (assigningSetup) {
      const targetSetupId = input.setupId;
      if (targetSetupId === undefined) {
        throw new Error('assignTradeClassification: unreachable — setupId narrowed to undefined');
      }
      const setup = await tx.query.setups.findFirst({
        where: and(
          eq(setups.id, targetSetupId),
          eq(setups.workspaceId, workspaceId),
          eq(setups.strategyId, resolvedStrategyId),
        ),
      });
      if (setup === undefined) return { ok: false, code: 'setup_not_found' };
      if (setup.isArchived) return { ok: false, code: 'setup_archived' };

      const setupVersion = await tx.query.strategySetupVersions.findFirst({
        where: and(
          eq(strategySetupVersions.strategyVersionId, resolvedStrategyVersionId),
          eq(strategySetupVersions.setupId, setup.id),
        ),
      });
      if (setupVersion === undefined) return { ok: false, code: 'setup_snapshot_missing' };

      resolvedSetupId = setup.id;
      resolvedSetupVersionId = setupVersion.id;
      resolvedSetupAssignedAt = assignedAt;
    }

    await tx
      .update(trades)
      .set({
        strategyId: resolvedStrategyId,
        strategyVersionId: resolvedStrategyVersionId,
        strategyAssignedAt: resolvedStrategyAssignedAt,
        setupId: resolvedSetupId,
        setupVersionId: resolvedSetupVersionId,
        setupAssignedAt: resolvedSetupAssignedAt,
        // Assigning a framework answers the question: an explicit "No Strategy"
        // / "No Setup" is superseded, which is a revision of that answer, and a
        // first supply records when it happened (contract §7).
        noStrategy: false,
        noSetup: false,
        // Contract rows only: origin and revision describe contract-era capture,
        // and a legacy row must stay legacy (contract §28).
        ...(isContractRow(trade)
          ? {
              strategyOrigin:
                trade.strategyOrigin ??
                (assigningStrategy ? laterCaptureOrigin(trade.status) : null),
              setupOrigin:
                trade.setupOrigin ?? (assigningSetup ? laterCaptureOrigin(trade.status) : null),
              ...(trade.noStrategy || (assigningSetup && trade.noSetup)
                ? { classificationRevisedAt: assignedAt }
                : {}),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    // Never a symbol, note, or any other free-text field — identifiers only.
    await insertAuditLog(tx, {
      action: 'trade.classified',
      workspaceId,
      actorUserId: userId,
      entityType: 'trade',
      entityId: tradeId,
      metadata: {
        tradeId,
        strategyId: resolvedStrategyId,
        strategyVersionId: resolvedStrategyVersionId,
        // Omitted (never `null`) when Setup was not part of this
        // assignment — see the identical pattern/reasoning in `createTrade`.
        ...(resolvedSetupId !== null ? { setupId: resolvedSetupId } : {}),
        ...(resolvedSetupVersionId !== null ? { setupVersionId: resolvedSetupVersionId } : {}),
      },
    });

    return {
      ok: true,
      strategyId: resolvedStrategyId,
      strategyVersionId: resolvedStrategyVersionId,
      setupId: resolvedSetupId,
      setupVersionId: resolvedSetupVersionId,
    };
  });
}
