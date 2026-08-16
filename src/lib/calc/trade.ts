import {
  BREAK_EVEN_TOLERANCE_R,
  CALC_VERSION,
  PLANNED_R_AGREEMENT_TOLERANCE_R,
} from '@/config/trade-calc';
import { type OutcomeValue } from '@/lib/trades/constants';

import {
  bigintToCalcDecimal,
  CalcDecimal,
  parseCalcDecimal,
  toCanonicalR,
  type CalcDecimalValue,
} from './decimal';
import { resolvePlannedRiskContext } from './risk';
import { calcErr, calcOk, type CalcResult } from './types';

/**
 * No function in this module (or anywhere in `src/lib/calc/`) computes
 * currency P&L from `price difference × quantity × contract multiplier`.
 * That formula is not universally valid across Forex, gold, crypto and
 * indices — contract semantics vary by instrument and broker, and account
 * currency may differ from quote currency, which would additionally require
 * a currency conversion this engine does not perform. The authoritative
 * monetary source of truth remains `trades.actual_initial_risk_minor`/
 * `net_pnl_minor` (locked product decision, Phase 07B) — see `actualR`
 * below, and `docs/calculation-spec.md`'s "Actual R" section.
 */

// ---------------------------------------------------------------------------
// Planned R
// ---------------------------------------------------------------------------

/**
 * `plannedR` (CLAUDE.md §6):
 *   long:  (plannedTarget − plannedEntry) / (plannedEntry − plannedStop)
 *   short: (plannedEntry − plannedTarget) / (plannedStop − plannedEntry)
 *
 * The Target must be strictly on the profitable side of Entry — direction-
 * aware comparison, never an absolute-value shortcut (an absolute value
 * would turn a Target on the WRONG side of Entry into a misleadingly
 * positive R instead of rejecting it, exactly the bug this must not have).
 * Rounded once, at this function's own return, to the canonical
 * `NUMERIC(12,4)` snapshot form.
 */
export function plannedR(
  direction: string | null | undefined,
  entry: string | null | undefined,
  stop: string | null | undefined,
  target: string | null | undefined,
): CalcResult<string> {
  const contextResult = resolvePlannedRiskContext(direction, entry, stop);
  if (!contextResult.ok) return contextResult;
  const { direction: dir, entry: entryDecimal, riskPerUnit } = contextResult.value;

  if (target === null || target === undefined) return calcErr('missing_input');
  const targetDecimal = parseCalcDecimal(target);
  if (targetDecimal === null) return calcErr('invalid_decimal');

  const isLong = dir === 'long';
  const targetOnProfitableSide = isLong
    ? targetDecimal.greaterThan(entryDecimal)
    : targetDecimal.lessThan(entryDecimal);
  if (!targetOnProfitableSide) return calcErr('invalid_target_direction');

  const reward = isLong ? targetDecimal.minus(entryDecimal) : entryDecimal.minus(targetDecimal);
  return calcOk(toCanonicalR(reward.dividedBy(riskPerUnit)));
}

// ---------------------------------------------------------------------------
// Planned R — Money mode (Founder-UAT Trade Plan UX slice, migration 0010)
// ---------------------------------------------------------------------------

/**
 * `moneyPlannedR = plannedRewardMinor / plannedRiskMinor` — the Money-mode
 * equivalent of {@link plannedR}, for a trader who journals planned
 * risk/reward directly in account-currency minor units instead of prices.
 * Deliberately the SAME shape as {@link actualR}: two authoritative `bigint`
 * inputs converted to `Decimal` through exact string conversion, never a JS
 * `number` division. `plannedRiskMinor` must be strictly positive (mirrors
 * `actualInitialRiskMinor`'s own guard); `plannedRewardMinor` may be zero
 * (a break-even-or-better plan is meaningful) but never negative. Absent
 * Reward is `missing_input` — the Money-mode analogue of an absent Target —
 * callers treat that as "no Money R to compute," never a hard failure, the
 * same convention `composePlannedR` and `createTrade`/`updateTradePlan`
 * already apply to a Target-less Price plan.
 */
export function moneyPlannedR(
  plannedRiskMinor: bigint | null | undefined,
  plannedRewardMinor: bigint | null | undefined,
): CalcResult<string> {
  if (plannedRiskMinor === null || plannedRiskMinor === undefined) return calcErr('missing_input');
  if (plannedRiskMinor <= 0n) return calcErr('invalid_planned_risk');
  if (plannedRewardMinor === null || plannedRewardMinor === undefined) {
    return calcErr('missing_input');
  }
  if (plannedRewardMinor < 0n) return calcErr('invalid_planned_reward');

  const risk = bigintToCalcDecimal(plannedRiskMinor);
  const reward = bigintToCalcDecimal(plannedRewardMinor);
  return calcOk(toCanonicalR(reward.dividedBy(risk)));
}

// ---------------------------------------------------------------------------
// Actual R
// ---------------------------------------------------------------------------

/**
 * `actualR = netPnlMinor / actualInitialRiskMinor` — both authoritative
 * `bigint` account-currency minor units (`trades.net_pnl_minor`,
 * `trades.actual_initial_risk_minor`; Phase 07B locked decision). Never
 * derived from prices, and commission/fees/swap are never re-applied here:
 * `net_pnl_minor` is already the authoritative net figure with all costs
 * already subtracted (`docs/calculation-spec.md`'s "Net result").
 *
 * `actualInitialRiskMinor` must be strictly positive; `netPnlMinor` may be
 * positive, zero, or negative. Both bigints convert to `Decimal` through
 * exact string conversion — never through a JS `number` division, which
 * would defeat the entire purpose of storing them as `bigint`.
 */
export function actualR(
  netPnlMinor: bigint | null | undefined,
  actualInitialRiskMinor: bigint | null | undefined,
): CalcResult<string> {
  if (
    netPnlMinor === null ||
    netPnlMinor === undefined ||
    actualInitialRiskMinor === null ||
    actualInitialRiskMinor === undefined
  ) {
    return calcErr('missing_input');
  }
  if (actualInitialRiskMinor <= 0n) return calcErr('invalid_initial_risk');

  const net = bigintToCalcDecimal(netPnlMinor);
  const risk = bigintToCalcDecimal(actualInitialRiskMinor);
  return calcOk(toCanonicalR(net.dividedBy(risk)));
}

export interface ActualExitLegInput {
  readonly closedBps: number;
  readonly exitPrice?: string | null;
  readonly realizedPnlMinor?: bigint | null;
}

export interface RealizedActualSnapshot {
  readonly closedBps: number;
  readonly realizedR: string;
  readonly realizedPnlMinor: bigint | null;
}

/** Derives partial or final Actual execution from authoritative Exit legs. */
export function composeRealizedActual(params: {
  readonly actualResultMode: string | null | undefined;
  readonly direction: string | null | undefined;
  readonly actualEntry?: string | null;
  readonly actualInitialStop?: string | null;
  readonly actualInitialRiskMinor?: bigint | null;
  readonly exits: readonly ActualExitLegInput[];
}): CalcResult<RealizedActualSnapshot> {
  if (params.actualResultMode !== 'price' && params.actualResultMode !== 'money') {
    return calcErr('invalid_actual_mode');
  }

  let closedBps = 0;
  for (const exit of params.exits) {
    if (!Number.isSafeInteger(exit.closedBps) || exit.closedBps <= 0 || exit.closedBps > 10_000) {
      return calcErr('invalid_closed_bps');
    }
    closedBps += exit.closedBps;
    if (closedBps > 10_000) return calcErr('invalid_closed_bps');
  }

  if (params.actualResultMode === 'money') {
    if (
      params.actualInitialRiskMinor === null ||
      params.actualInitialRiskMinor === undefined ||
      params.actualInitialRiskMinor <= 0n
    ) {
      return calcErr('invalid_initial_risk');
    }
    let realizedPnlMinor = 0n;
    for (const exit of params.exits) {
      if (exit.realizedPnlMinor === null || exit.realizedPnlMinor === undefined) {
        return calcErr('invalid_exit_shape');
      }
      realizedPnlMinor += exit.realizedPnlMinor;
    }
    const r = actualR(realizedPnlMinor, params.actualInitialRiskMinor);
    if (!r.ok) return r;
    return calcOk({ closedBps, realizedR: r.value, realizedPnlMinor });
  }

  const context = resolvePlannedRiskContext(
    params.direction,
    params.actualEntry,
    params.actualInitialStop,
  );
  if (!context.ok) return context;
  const { direction, entry, riskPerUnit } = context.value;
  let weighted = new CalcDecimal(0);
  for (const exit of params.exits) {
    if (
      exit.exitPrice === null ||
      exit.exitPrice === undefined ||
      (exit.realizedPnlMinor !== null && exit.realizedPnlMinor !== undefined)
    ) {
      return calcErr('invalid_exit_shape');
    }
    const exitPrice = parseCalcDecimal(exit.exitPrice);
    if (exitPrice === null) return calcErr('invalid_decimal');
    const legR =
      direction === 'long'
        ? exitPrice.minus(entry).dividedBy(riskPerUnit)
        : entry.minus(exitPrice).dividedBy(riskPerUnit);
    weighted = weighted.plus(legR.times(new CalcDecimal(exit.closedBps).dividedBy(10_000)));
  }
  return calcOk({ closedBps, realizedR: toCanonicalR(weighted), realizedPnlMinor: null });
}

/** Finalizes only an exactly 100%-closed Exit set. */
export function composeTraderCloseV2(
  params: Parameters<typeof composeRealizedActual>[0],
): CalcResult<TraderCloseSnapshot> {
  const realized = composeRealizedActual(params);
  if (!realized.ok) return realized;
  if (realized.value.closedBps !== 10_000) return calcErr('invalid_closed_bps');
  const outcome = classifyOutcome(realized.value.realizedR);
  if (!outcome.ok) return outcome;
  return calcOk({
    actualR: realized.value.realizedR,
    traderOutcome: outcome.value,
    calcVersion: CALC_VERSION,
  });
}

// ---------------------------------------------------------------------------
// System gross R / System R
// ---------------------------------------------------------------------------

/**
 * The raw, UNROUNDED System gross R — shared internally by both the public
 * {@link systemGrossR} (which rounds it for inspection/testing) and
 * {@link systemR} (which subtracts `systemCostR` from this SAME unrounded
 * value before its own single final rounding, never from an already-rounded
 * intermediate — see `toCanonicalR`'s own doc comment for why that
 * distinction matters).
 *
 * Uses the same planned entry/stop denominator as `plannedR`, but the
 * numerator comes from the resolved System exit price, not the plan's
 * Target. Unlike Planned Target, a System exit may legitimately be
 * profitable, exactly break-even, or losing — so, deliberately unlike
 * `plannedR`, this never requires the exit price to be on the profitable
 * side of Entry.
 */
function systemGrossRDecimal(
  direction: string | null | undefined,
  entry: string | null | undefined,
  stop: string | null | undefined,
  systemExitPrice: string | null | undefined,
): CalcResult<CalcDecimalValue> {
  const contextResult = resolvePlannedRiskContext(direction, entry, stop);
  if (!contextResult.ok) return contextResult;
  const { direction: dir, entry: entryDecimal, riskPerUnit } = contextResult.value;

  if (systemExitPrice === null || systemExitPrice === undefined) return calcErr('missing_input');
  const exitDecimal = parseCalcDecimal(systemExitPrice);
  if (exitDecimal === null) return calcErr('invalid_decimal');

  const isLong = dir === 'long';
  const reward = isLong ? exitDecimal.minus(entryDecimal) : entryDecimal.minus(exitDecimal);
  return calcOk(reward.dividedBy(riskPerUnit));
}

/** Public, canonical-string System gross R — see {@link systemGrossRDecimal}. */
export function systemGrossR(
  direction: string | null | undefined,
  entry: string | null | undefined,
  stop: string | null | undefined,
  systemExitPrice: string | null | undefined,
): CalcResult<string> {
  const result = systemGrossRDecimal(direction, entry, stop, systemExitPrice);
  if (!result.ok) return result;
  return calcOk(toCanonicalR(result.value));
}

/**
 * `systemR = systemGrossR − systemCostR` (locked formula, Phase 07B
 * correction). `systemCostR` is a user-supplied estimate of costs
 * attributable to the counterfactual System execution, expressed directly
 * in R — never Actual `commission_minor`/`fees_minor`/`swap_minor`, never
 * inferred from an account setting. Must be non-negative; negative values
 * are rejected (`invalid_system_cost`), never silently negated or clamped.
 * Losses are never clamped either — a larger `systemCostR` against a
 * negative gross R makes the loss deeper, and that is correct, not a bug.
 */
export function systemR(
  direction: string | null | undefined,
  entry: string | null | undefined,
  stop: string | null | undefined,
  systemExitPrice: string | null | undefined,
  systemCostR: string | null | undefined,
): CalcResult<string> {
  const grossResult = systemGrossRDecimal(direction, entry, stop, systemExitPrice);
  if (!grossResult.ok) return grossResult;

  if (systemCostR === null || systemCostR === undefined) return calcErr('missing_input');
  const costDecimal = parseCalcDecimal(systemCostR);
  if (costDecimal === null) return calcErr('invalid_decimal');
  if (costDecimal.isNegative()) return calcErr('invalid_system_cost');

  return calcOk(toCanonicalR(grossResult.value.minus(costDecimal)));
}

// ---------------------------------------------------------------------------
// System status wrapper
// ---------------------------------------------------------------------------

/**
 * Respects `trades.system_status`'s three-state lifecycle (Phase 07B):
 * `pending` has no calculable System R yet (`unresolved_system_outcome`,
 * never a silent `0R`); `no_trade` has no System R by definition — the
 * approved Strategy/Setup would not have permitted the Trade at all
 * (`system_no_trade`, never a silent `0R`); `resolved` calculates from the
 * resolved inputs via {@link systemR}. Any other value is treated as
 * unusable input (`missing_input`) — this function does not itself decide
 * what a valid `system_status` is; `src/lib/trades/constants.ts`'s
 * `isSystemStatus` does.
 */
export function resolveSystemR(params: {
  readonly systemStatus: string | null | undefined;
  readonly direction: string | null | undefined;
  readonly plannedEntry: string | null | undefined;
  readonly plannedStop: string | null | undefined;
  readonly systemExitPrice?: string | null;
  readonly systemCostR?: string | null;
}): CalcResult<string> {
  const { systemStatus } = params;
  if (systemStatus === 'pending') return calcErr('unresolved_system_outcome');
  if (systemStatus === 'no_trade') return calcErr('system_no_trade');
  if (systemStatus !== 'resolved') return calcErr('missing_input');

  return systemR(
    params.direction,
    params.plannedEntry,
    params.plannedStop,
    params.systemExitPrice,
    params.systemCostR,
  );
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

/**
 * Shared by both Trader and System R (CLAUDE.md §1's outcome matrix requires
 * both axes to use the same classification, computed independently).
 * `|R| <= BREAK_EVEN_TOLERANCE_R` (`'0.0500'`, inclusive both sides) is
 * `break_even`; strictly above is `win`; strictly below `-tolerance` is
 * `loss`. Never compares to zero with `==` (CLAUDE.md §6). Never trusts a
 * client-provided outcome — this is the one function that ever produces
 * `trader_outcome`/`system_outcome`.
 */
export function classifyOutcome(r: string | null | undefined): CalcResult<OutcomeValue> {
  if (r === null || r === undefined) return calcErr('missing_input');
  const decimal = parseCalcDecimal(r);
  if (decimal === null) return calcErr('invalid_decimal');

  const tolerance = parseCalcDecimal(BREAK_EVEN_TOLERANCE_R);
  /* istanbul ignore next -- BREAK_EVEN_TOLERANCE_R is a compile-time constant; unreachable unless the constant itself is corrupted. */
  if (tolerance === null) {
    throw new Error(
      `BREAK_EVEN_TOLERANCE_R ("${BREAK_EVEN_TOLERANCE_R}") is not a valid decimal — this is a configuration bug, not a runtime input error.`,
    );
  }

  if (decimal.absoluteValue().lessThanOrEqualTo(tolerance)) return calcOk('break_even');
  return decimal.isPositive() ? calcOk('win') : calcOk('loss');
}

// ---------------------------------------------------------------------------
// Per-Trade snapshot composition
// ---------------------------------------------------------------------------

/**
 * Composition helpers exist so a future Phase 08 caller never has to
 * manually combine `actualR`/`systemR`/`classifyOutcome`/`CALC_VERSION`
 * itself — doing so by hand, at each call site, is exactly how a snapshot
 * could end up internally inconsistent (e.g. an R value computed under one
 * `calc_version` paired with an outcome classified against a different
 * tolerance). Each composer is a single atomic unit of "calculate this R,
 * classify it, stamp the engine version" — never partial.
 *
 * Trader close and System resolution are deliberately SEPARATE composers,
 * not one combined "close a trade" function: `trades.status` can be
 * `closed` while `trades.system_status` is still `pending` (Phase 07B's
 * independent-lifecycle decision), so closing the Trader side must never
 * require System data to be present.
 */

export interface TraderCloseSnapshot {
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
  readonly calcVersion: number;
}

/** The complete, atomic Trader-close snapshot — never requires System data. */
export function composeTraderClose(
  netPnlMinor: bigint | null | undefined,
  actualInitialRiskMinor: bigint | null | undefined,
): CalcResult<TraderCloseSnapshot> {
  const rResult = actualR(netPnlMinor, actualInitialRiskMinor);
  if (!rResult.ok) return rResult;
  const outcomeResult = classifyOutcome(rResult.value);
  if (!outcomeResult.ok) return outcomeResult;
  return calcOk({
    actualR: rResult.value,
    traderOutcome: outcomeResult.value,
    calcVersion: CALC_VERSION,
  });
}

export interface SystemResolveSnapshot {
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
  readonly calcVersion: number;
}

/** The complete, atomic System-resolve snapshot — only valid once `system_status` is genuinely `resolved` (see {@link resolveSystemR}). */
export function composeSystemResolve(
  direction: string | null | undefined,
  plannedEntry: string | null | undefined,
  plannedStop: string | null | undefined,
  systemExitPrice: string | null | undefined,
  systemCostR: string | null | undefined,
): CalcResult<SystemResolveSnapshot> {
  const rResult = systemR(direction, plannedEntry, plannedStop, systemExitPrice, systemCostR);
  if (!rResult.ok) return rResult;
  const outcomeResult = classifyOutcome(rResult.value);
  if (!outcomeResult.ok) return outcomeResult;
  return calcOk({
    systemR: rResult.value,
    systemOutcome: outcomeResult.value,
    calcVersion: CALC_VERSION,
  });
}

export interface PlannedSnapshot {
  readonly plannedR: string;
}

/** The Plan-step snapshot — a Trade always has a plan, even in `status = 'planned'`. */
export function composePlanned(
  direction: string | null | undefined,
  plannedEntry: string | null | undefined,
  plannedStop: string | null | undefined,
  plannedTarget: string | null | undefined,
): CalcResult<PlannedSnapshot> {
  const rResult = plannedR(direction, plannedEntry, plannedStop, plannedTarget);
  if (!rResult.ok) return rResult;
  return calcOk({ plannedR: rResult.value });
}

// ---------------------------------------------------------------------------
// Planned R — combined Price + Money composition (Founder-UAT Trade Plan UX
// slice, migration 0010)
// ---------------------------------------------------------------------------

export type PlannedRSource = 'price' | 'money' | 'both' | 'none';

export interface PlannedRSnapshot {
  /** Price-mode R, or `null` when no complete Price plan (Entry+Stop) is present, or present without a Target. */
  readonly priceR: string | null;
  /** Money-mode R, or `null` when no Risk is present, or present without a Reward. */
  readonly moneyR: string | null;
  /** The single value `trades.planned_r` persists — see this function's own doc comment for precedence. */
  readonly plannedR: string | null;
  /** Which representation(s) actually produced an R value. */
  readonly source: PlannedRSource;
  /**
   * True only when BOTH `priceR` and `moneyR` are present and disagree by
   * more than `PLANNED_R_AGREEMENT_TOLERANCE_R`. The service layer
   * (`trade-management.ts`) treats this as a hard rejection — it never
   * persists a mismatched snapshot — so `plannedR` here still carries the
   * Price-precedence value only so a caller that forgets to check `mismatch`
   * fails toward the pre-0010 formula, never toward a silent `null`.
   */
  readonly mismatch: boolean;
}

/**
 * The one function that composes `trades.planned_r` from whichever Plan
 * representation(s) are present on a Trade. Neither Price nor Money is
 * required BY THIS FUNCTION — the Founder-UAT slice's "at least one
 * representation" floor is a separate, service-layer rule, because a
 * correction that touches only Money fields on a Trade that already has a
 * valid Price plan must remain valid here even though that one call's Money
 * inputs alone would not satisfy the floor.
 *
 * Fails (a genuine `CalcResult` error) only when a representation that IS at
 * least partially present is invalid or incomplete — a Price pair present
 * but risk-direction-invalid, an Entry/Stop/Target fragment missing its
 * partner, a Money Risk present but non-positive, or a Reward present
 * without a Risk. A representation that is entirely ABSENT never fails; its
 * R is simply `null` — the same convention an absent Target on an
 * otherwise-valid Price plan already used before this slice.
 *
 * Precedence when both are present and AGREE (within tolerance): Price is
 * the persisted canonical `plannedR` — an arbitrary but deterministic and
 * documented choice, chosen specifically because it means this migration
 * changes zero existing all-Price Trades' stored value. When both are
 * present and DISAGREE beyond tolerance, `mismatch: true` is returned
 * instead — see {@link PlannedRSnapshot.mismatch}.
 */
export function composePlannedR(input: {
  readonly direction: string | null | undefined;
  readonly plannedEntry: string | null | undefined;
  readonly plannedStop: string | null | undefined;
  readonly plannedTarget: string | null | undefined;
  readonly plannedRiskMinor: bigint | null | undefined;
  readonly plannedRewardMinor: bigint | null | undefined;
}): CalcResult<PlannedRSnapshot> {
  const entryProvided = input.plannedEntry !== null && input.plannedEntry !== undefined;
  const stopProvided = input.plannedStop !== null && input.plannedStop !== undefined;
  const targetProvided = input.plannedTarget !== null && input.plannedTarget !== undefined;

  let priceR: string | null = null;
  if (entryProvided && stopProvided) {
    const riskContext = resolvePlannedRiskContext(
      input.direction,
      input.plannedEntry,
      input.plannedStop,
    );
    if (!riskContext.ok) return riskContext;
    if (targetProvided) {
      const priceResult = plannedR(
        input.direction,
        input.plannedEntry,
        input.plannedStop,
        input.plannedTarget,
      );
      if (!priceResult.ok) return priceResult;
      priceR = priceResult.value;
    }
  } else if (entryProvided || stopProvided || targetProvided) {
    // Entry alone, Stop alone, or a Target with neither — an incomplete
    // fragment, never silently ignored.
    return calcErr('missing_input');
  }

  const riskProvided = input.plannedRiskMinor !== null && input.plannedRiskMinor !== undefined;
  const rewardProvided =
    input.plannedRewardMinor !== null && input.plannedRewardMinor !== undefined;

  let moneyR: string | null = null;
  if (riskProvided) {
    if ((input.plannedRiskMinor as bigint) <= 0n) return calcErr('invalid_planned_risk');
    if (rewardProvided) {
      const moneyResult = moneyPlannedR(input.plannedRiskMinor, input.plannedRewardMinor);
      if (!moneyResult.ok) return moneyResult;
      moneyR = moneyResult.value;
    }
  } else if (rewardProvided) {
    // A Reward without a Risk cannot be normalized into an R at all.
    return calcErr('missing_input');
  }

  let mismatch = false;
  if (priceR !== null && moneyR !== null) {
    const priceDecimal = parseCalcDecimal(priceR);
    const moneyDecimal = parseCalcDecimal(moneyR);
    const tolerance = parseCalcDecimal(PLANNED_R_AGREEMENT_TOLERANCE_R);
    /* istanbul ignore next -- priceR/moneyR are this module's own toCanonicalR output and PLANNED_R_AGREEMENT_TOLERANCE_R is a compile-time constant; unreachable unless one of those is corrupted. */
    if (priceDecimal === null || moneyDecimal === null || tolerance === null) {
      throw new Error(
        'composePlannedR: a canonical R value or the agreement-tolerance constant failed to parse — this is an engine bug, not a routine input error.',
      );
    }
    mismatch = priceDecimal.minus(moneyDecimal).absoluteValue().greaterThan(tolerance);
  }

  const source: PlannedRSource =
    priceR !== null && moneyR !== null
      ? 'both'
      : priceR !== null
        ? 'price'
        : moneyR !== null
          ? 'money'
          : 'none';

  return calcOk({ priceR, moneyR, plannedR: priceR ?? moneyR, source, mismatch });
}
