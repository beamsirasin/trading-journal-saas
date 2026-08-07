import { isTradeDirection, type TradeDirection } from '@/lib/trades/constants';

import { parseCalcDecimal, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

/**
 * The direction-validated, parsed inputs and resulting risk-per-unit for one
 * planned entry/stop pair — the one shared context `plannedR`, `systemGrossR`
 * and `systemR` in `trade.ts` all build on, so entry/stop are parsed and
 * risk-direction-validated exactly once per calculation, never redundantly
 * re-parsed by each caller.
 */
export interface PlannedRiskContext {
  readonly direction: TradeDirection;
  readonly entry: CalcDecimalValue;
  readonly stop: CalcDecimalValue;
  /** Raw, UNROUNDED — an intermediate price-space quantity, never itself a persisted R value. */
  readonly riskPerUnit: CalcDecimalValue;
}

/**
 * Direction-aware planned risk per unit (CLAUDE.md §6):
 *   long:  entry - stop
 *   short: stop - entry
 *
 * Must be strictly positive — a non-positive value means the stop is on the
 * wrong side of entry (or exactly on it), and CLAUDE.md §6 requires
 * rejecting that at validation, never proceeding with a non-positive
 * denominator. `zero_risk` (entry equals stop) and `invalid_risk_direction`
 * (stop on the wrong side) are reported as distinct reasons, matching the
 * two distinct scenarios the Phase 07C brief itemizes separately.
 *
 * The database already enforces this shape
 * (`trades_planned_price_direction_check` in
 * `drizzle/0008_trade_domain_and_discipline.sql`), but this function must
 * remain safe when called with unsaved, not-yet-validated input — that
 * safety is the entire reason a pure engine exists separately from the
 * schema's own constraints.
 */
export function resolvePlannedRiskContext(
  direction: string | null | undefined,
  entry: string | null | undefined,
  stop: string | null | undefined,
): CalcResult<PlannedRiskContext> {
  if (
    direction === null ||
    direction === undefined ||
    entry === null ||
    entry === undefined ||
    stop === null ||
    stop === undefined
  ) {
    return calcErr('missing_input');
  }
  if (!isTradeDirection(direction)) {
    return calcErr('invalid_direction');
  }

  const entryDecimal = parseCalcDecimal(entry);
  const stopDecimal = parseCalcDecimal(stop);
  if (entryDecimal === null || stopDecimal === null) {
    return calcErr('invalid_decimal');
  }

  const riskPerUnit =
    direction === 'long' ? entryDecimal.minus(stopDecimal) : stopDecimal.minus(entryDecimal);

  if (riskPerUnit.isZero()) return calcErr('zero_risk');
  if (riskPerUnit.isNegative()) return calcErr('invalid_risk_direction');

  return calcOk({ direction, entry: entryDecimal, stop: stopDecimal, riskPerUnit });
}

/**
 * The public, standalone planned-risk-per-unit calculation — a thin
 * extraction over {@link resolvePlannedRiskContext} for callers that only
 * need the risk value itself, not the parsed entry/stop it was derived from.
 */
export function plannedRiskPerUnit(
  direction: string | null | undefined,
  entry: string | null | undefined,
  stop: string | null | undefined,
): CalcResult<CalcDecimalValue> {
  const context = resolvePlannedRiskContext(direction, entry, stop);
  if (!context.ok) return context;
  return calcOk(context.value.riskPerUnit);
}
