import type { TradeStatus } from '@/lib/trades/constants';

/**
 * Pure decision helpers for the Trade lifecycle — no database, no
 * `Date.now()`, no import from `@/lib/calc/` (that engine owns the actual R
 * formulas; this module only decides WHETHER a caller must invoke one, never
 * HOW). Kept separate from `trade-management.ts` so the "does this edit
 * require a recompute" and "is this status transition legal" logic is
 * testable without a real Postgres connection, the same reason
 * `src/lib/calc/` itself is pure — these decisions are exactly the kind of
 * branch that is easy to get subtly wrong (an off-by-one in "which fields
 * trigger a System recompute") and expensive to catch only via an
 * integration test.
 */

// ---------------------------------------------------------------------------
// Trade-execution-status transitions
// ---------------------------------------------------------------------------

/** `planned -> open` is the only legal entry into `open` (CLAUDE.md's locked Phase 08 transition table). */
export function canOpenFromStatus(status: TradeStatus): boolean {
  return status === 'planned';
}

/** `open -> closed` is the only legal entry into `closed`; `closed` is terminal. */
export function canCloseFromStatus(status: TradeStatus): boolean {
  return status === 'open';
}

/** `planned -> canceled` only — once an actual entry exists (`open`/`closed`), the Trade can never be hidden from Trader performance by canceling it. */
export function canCancelFromStatus(status: TradeStatus): boolean {
  return status === 'planned';
}

/** Corrections to the actual-execution fields require an actual entry to exist at all. */
export function hasActualExecution(status: TradeStatus): boolean {
  return status === 'open' || status === 'closed';
}

// ---------------------------------------------------------------------------
// Plan-field patch resolution
// ---------------------------------------------------------------------------

export interface PlanFieldsCurrent {
  readonly plannedEntry: string | null;
  readonly plannedStop: string | null;
  readonly plannedTarget: string | null;
  readonly plannedRiskMinor: bigint | null;
  readonly plannedRewardMinor: bigint | null;
}

/**
 * Every Plan field below distinguishes three states via PRESENCE, not
 * value: the key absent = "leave this field unchanged"; present with
 * `null` = "clear this field"; present with a value = "set this field."
 * TypeScript cannot express "optional but distinguish absent from explicit
 * undefined" for a plain object literal, so callers use
 * `Object.hasOwn(patch, '<field>')` (this module's convention, not
 * `!== undefined`) to tell the three apart — see
 * {@link resolvePlanFieldsPatch}. Migration 0010 (Founder-UAT Trade Plan UX
 * correction slice) extended this tri-state convention from `plannedTarget`
 * alone to `plannedEntry`/`plannedStop` too (a Trade may now clear its
 * entire Price plan down to a Money-only plan) and added the two Money
 * fields under the identical convention.
 */
export interface PlanFieldsPatch {
  readonly plannedEntry?: string | null;
  readonly plannedStop?: string | null;
  readonly plannedTarget?: string | null;
  readonly plannedRiskMinor?: bigint | null;
  readonly plannedRewardMinor?: bigint | null;
}

export interface ResolvedPlanFields {
  readonly plannedEntry: string | null;
  readonly plannedStop: string | null;
  /** `null` when the effective Target is absent — Target is optional (locked Phase 08 decision), and a Trade may have no Target. */
  readonly plannedTarget: string | null;
  readonly plannedRiskMinor: bigint | null;
  readonly plannedRewardMinor: bigint | null;
  /** True when any Plan field (Price or Money) participates in this edit — the trigger for recomputing `planned_r` at all. */
  readonly planFieldsTouched: boolean;
  /** True only when entry or stop actually change value — the trigger for recomputing `system_r`/`system_outcome` when System is resolved (Target and every Money field never affect the System formula, which is always Price-based). */
  readonly entryOrStopChanged: boolean;
}

/**
 * Resolves a partial Plan-field patch against the Trade's current stored
 * values into the effective new values, plus which recomputations the patch
 * requires. Pure: does not call `composePlannedR`/`composeSystemResolve`
 * itself — `trade-management.ts` does that, using the effective values this
 * function returns.
 */
export function resolvePlanFieldsPatch(
  current: PlanFieldsCurrent,
  patch: PlanFieldsPatch,
): ResolvedPlanFields {
  const entryProvided = Object.hasOwn(patch, 'plannedEntry');
  const stopProvided = Object.hasOwn(patch, 'plannedStop');
  const targetProvided = Object.hasOwn(patch, 'plannedTarget');
  const riskProvided = Object.hasOwn(patch, 'plannedRiskMinor');
  const rewardProvided = Object.hasOwn(patch, 'plannedRewardMinor');

  const plannedEntry = entryProvided ? (patch.plannedEntry ?? null) : current.plannedEntry;
  const plannedStop = stopProvided ? (patch.plannedStop ?? null) : current.plannedStop;
  const plannedTarget = targetProvided ? (patch.plannedTarget ?? null) : current.plannedTarget;
  const plannedRiskMinor = riskProvided
    ? (patch.plannedRiskMinor ?? null)
    : current.plannedRiskMinor;
  const plannedRewardMinor = rewardProvided
    ? (patch.plannedRewardMinor ?? null)
    : current.plannedRewardMinor;

  const entryOrStopChanged =
    (entryProvided && plannedEntry !== current.plannedEntry) ||
    (stopProvided && plannedStop !== current.plannedStop);
  const planFieldsTouched =
    entryProvided || stopProvided || targetProvided || riskProvided || rewardProvided;

  return {
    plannedEntry,
    plannedStop,
    plannedTarget,
    plannedRiskMinor,
    plannedRewardMinor,
    planFieldsTouched,
    entryOrStopChanged,
  };
}

// ---------------------------------------------------------------------------
// Idempotent-retry comparison
// ---------------------------------------------------------------------------

export interface CloseRetryFields {
  readonly actualExit: string;
  readonly netPnlMinor: bigint;
  readonly exitedAt: Date;
}

/**
 * True when a `closeTrade` retry supplies EXACTLY the already-persisted
 * terminal values — the "exact same terminal-state retry" the locked Phase
 * 08B decisions require to succeed as a no-op rather than being rejected.
 * Any other difference (including a materially different but "close" value)
 * must go through the explicit correction path instead.
 */
export function matchesCloseRetry(current: CloseRetryFields, requested: CloseRetryFields): boolean {
  return (
    current.actualExit === requested.actualExit &&
    current.netPnlMinor === requested.netPnlMinor &&
    current.exitedAt.getTime() === requested.exitedAt.getTime()
  );
}

export interface SystemResolveRetryFields {
  readonly systemExitPrice: string;
  readonly systemExitedAt: Date;
  readonly systemExitReason: string;
  readonly systemCostR: string;
}

/** The System-axis equivalent of {@link matchesCloseRetry}, for `resolveSystemTrade`. */
export function matchesSystemResolveRetry(
  current: SystemResolveRetryFields,
  requested: SystemResolveRetryFields,
): boolean {
  return (
    current.systemExitPrice === requested.systemExitPrice &&
    current.systemExitedAt.getTime() === requested.systemExitedAt.getTime() &&
    current.systemExitReason === requested.systemExitReason &&
    current.systemCostR === requested.systemCostR
  );
}
