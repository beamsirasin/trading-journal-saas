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
  readonly plannedEntry: string;
  readonly plannedStop: string;
  readonly plannedTarget: string | null;
}

/**
 * A patch's `plannedTarget` distinguishes three states via presence, not
 * value: the key absent = "leave Target unchanged"; present with `null` =
 * "clear the Target"; present with a string = "set the Target." TypeScript
 * cannot express "optional but distinguish absent from explicit undefined"
 * for a plain object literal, so callers use `'plannedTarget' in patch`
 * (this module's `hasOwnProperty`-based check, not `!== undefined`) to tell
 * the three apart — see {@link resolvePlanFieldsPatch}.
 */
export interface PlanFieldsPatch {
  readonly plannedEntry?: string;
  readonly plannedStop?: string;
  readonly plannedTarget?: string | null;
}

export interface ResolvedPlanFields {
  readonly plannedEntry: string;
  readonly plannedStop: string;
  /** `null` when the effective Target is absent — Target is optional (locked Phase 08 decision), and a Trade may have no Target. */
  readonly plannedTarget: string | null;
  /** True when any of entry/stop/target participate in this edit — the trigger for recomputing `planned_r` at all. */
  readonly planFieldsTouched: boolean;
  /** True only when entry or stop actually change value — the trigger for recomputing `system_r`/`system_outcome` when System is resolved (Target never affects the System formula). */
  readonly entryOrStopChanged: boolean;
}

/**
 * Resolves a partial Plan-field patch against the Trade's current stored
 * values into the effective new values, plus which recomputations the patch
 * requires. Pure: does not call `composePlanned`/`composeSystemResolve`
 * itself — `trade-management.ts` does that, using the effective values this
 * function returns.
 */
export function resolvePlanFieldsPatch(
  current: PlanFieldsCurrent,
  patch: PlanFieldsPatch,
): ResolvedPlanFields {
  const plannedEntry = patch.plannedEntry ?? current.plannedEntry;
  const plannedStop = patch.plannedStop ?? current.plannedStop;
  const targetProvided = Object.hasOwn(patch, 'plannedTarget');
  const plannedTarget = targetProvided ? (patch.plannedTarget ?? null) : current.plannedTarget;

  const entryOrStopChanged =
    (patch.plannedEntry !== undefined && patch.plannedEntry !== current.plannedEntry) ||
    (patch.plannedStop !== undefined && patch.plannedStop !== current.plannedStop);
  const planFieldsTouched =
    patch.plannedEntry !== undefined || patch.plannedStop !== undefined || targetProvided;

  return { plannedEntry, plannedStop, plannedTarget, planFieldsTouched, entryOrStopChanged };
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
