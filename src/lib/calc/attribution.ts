import type { RuleCheckStatus } from '@/lib/trades/constants';

import { CalcDecimal, parseCalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

// ---------------------------------------------------------------------------
// Comparison-eligible population
// ---------------------------------------------------------------------------

/**
 * A Trade contributes to System-versus-Trader comparison only when BOTH
 * axes are independently resolved for that same Trade — `actualR` exists
 * AND `systemR` exists. This is deliberately a third, distinct eligibility
 * rule from `isTraderEligible`/`isSystemEligible` in `aggregate.ts`: a
 * closed Trader Trade with a still-`pending` System side is fully eligible
 * for Trader metrics but NOT for comparison.
 */
export interface ComparisonEligibleTradeInput {
  readonly actualR: string | null;
  readonly systemR: string | null;
}

export function isComparisonEligible(trade: ComparisonEligibleTradeInput): boolean {
  return trade.actualR !== null && trade.systemR !== null;
}

/** Filters to the comparison-eligible subset, preserving each record's full original shape. */
export function selectComparisonEligible<T extends ComparisonEligibleTradeInput>(
  trades: readonly T[],
): readonly T[] {
  return trades.filter(isComparisonEligible);
}

/**
 * One Trade's paired System/Actual R, keyed by its own identity —
 * `tradeId` is carried specifically so a caller can never accidentally
 * assemble `systemR` from one Trade's row and `actualR` from a different
 * one: `systemTotal` over population A minus `actualTotal` over a
 * different population B is exactly the mistake pairing-by-construction
 * here exists to prevent. Paired comparison always requires the same Trade
 * IDs on both sides of every pair.
 */
export interface PairedRTrade {
  readonly tradeId: string;
  readonly systemR: string;
  readonly actualR: string;
}

// ---------------------------------------------------------------------------
// System-vs-Trader edge leakage
// ---------------------------------------------------------------------------

/**
 * `edgeLeakageR = systemR - actualR` for one comparable Trade. Positive
 * means the Trader captured less R than the System; zero means they
 * matched; NEGATIVE means the Trader captured MORE R than the counterfactual
 * System — never described as an error, never clamped to zero. Both are
 * real, meaningful findings (CLAUDE.md §6).
 */
export function edgeLeakageR(
  systemR: string | null | undefined,
  actualR: string | null | undefined,
): CalcResult<string> {
  if (systemR === null || systemR === undefined || actualR === null || actualR === undefined) {
    return calcErr('missing_input');
  }
  const systemDecimal = parseCalcDecimal(systemR);
  const actualDecimal = parseCalcDecimal(actualR);
  if (systemDecimal === null || actualDecimal === null) return calcErr('invalid_decimal');
  return calcOk(toCanonicalR(systemDecimal.minus(actualDecimal)));
}

function parsePairedDecimals(
  pairs: readonly PairedRTrade[],
): CalcResult<readonly { readonly system: CalcDecimalValue; readonly actual: CalcDecimalValue }[]> {
  const parsed: { readonly system: CalcDecimalValue; readonly actual: CalcDecimalValue }[] = [];
  for (const pair of pairs) {
    const systemDecimal = parseCalcDecimal(pair.systemR);
    const actualDecimal = parseCalcDecimal(pair.actualR);
    if (systemDecimal === null || actualDecimal === null) return calcErr('invalid_decimal');
    parsed.push({ system: systemDecimal, actual: actualDecimal });
  }
  return calcOk(parsed);
}

/**
 * Aggregate paired leakage over the SAME comparable-Trade population —
 * summed from each pair's raw, unrounded `(systemR - actualR)` difference
 * and rounded exactly once at the end (never by summing already-rounded
 * per-Trade {@link edgeLeakageR} outputs, which would round twice). Equal,
 * at full precision, to the sum of every pair's individual leakage. Empty
 * input -> `no_comparable_trades`.
 */
export function pairedEdgeLeakageR(pairs: readonly PairedRTrade[]): CalcResult<string> {
  if (pairs.length === 0) return calcErr('no_comparable_trades');
  const parsedResult = parsePairedDecimals(pairs);
  if (!parsedResult.ok) return parsedResult;

  let sum = new CalcDecimal(0);
  for (const { system, actual } of parsedResult.value) {
    sum = sum.plus(system.minus(actual));
  }
  return calcOk(toCanonicalR(sum));
}

// ---------------------------------------------------------------------------
// Execution efficiency
// ---------------------------------------------------------------------------

/**
 * `executionEfficiency = pairedActualTotalR / pairedSystemTotalR`, over
 * exactly the same paired-Trade population in both the numerator and the
 * denominator — never a Trader total from one population divided by a
 * System total from a different one. Defined only when
 * `pairedSystemTotalR > 0`; a zero or negative System edge makes the ratio
 * not merely undefined but actively misleading (capturing 50% of a losing
 * System is not a 50% score), so this returns `system_has_no_edge` rather
 * than a number. Never clamped below `0` or above `1` — `0.8000` (captured
 * 80%), `1.2000` (captured more than the System's own counterfactual), and
 * `-0.2000` (a net loss against a positive System edge) are all legitimate,
 * literal results. This metric describes execution against available
 * System edge; it is not an independent Strategy-quality metric.
 */
export function executionEfficiency(pairs: readonly PairedRTrade[]): CalcResult<string> {
  if (pairs.length === 0) return calcErr('no_comparable_trades');
  const parsedResult = parsePairedDecimals(pairs);
  if (!parsedResult.ok) return parsedResult;

  let systemSum = new CalcDecimal(0);
  let actualSum = new CalcDecimal(0);
  for (const { system, actual } of parsedResult.value) {
    systemSum = systemSum.plus(system);
    actualSum = actualSum.plus(actual);
  }

  // `.isPositive()` is sign-only in decimal.js and incorrectly treats exact
  // zero as positive; `.greaterThan(0)` is the magnitude-correct check
  // "System total is strictly greater than zero" actually requires.
  if (!systemSum.greaterThan(0)) return calcErr('system_has_no_edge');
  return calcOk(toCanonicalR(actualSum.dividedBy(systemSum)));
}

// ---------------------------------------------------------------------------
// Rule adherence
// ---------------------------------------------------------------------------

/** The one field `ruleAdherenceRate` reads — `trade_rule_checks.check_status`, never re-derived. */
export interface RuleCheckRecord {
  readonly status: RuleCheckStatus | string;
}

/**
 * The OBJECTIVE Rule-adherence primitive only —
 * `ruleAdherenceRate = followed / (followed + violated)`.
 * `not_applicable` (the Rule did not apply to this Trade) and `not_checked`
 * (its adherence state is unknown) are both EXCLUDED from the denominator:
 * the engine must never silently infer a violation from an unknown or
 * inapplicable state. No `followed`/`violated` checks at all ->
 * `no_rule_checks`.
 *
 * Deliberately does NOT implement a weighted discipline score — there is no
 * approved 0–100 formula (CLAUDE.md/Phase 07D brief; kept explicitly
 * deferred). A caller may filter by required/optional, pre-trade, category,
 * or Setup scope BEFORE calling this function; none of those
 * presentation/filter dimensions are baked into the formula itself.
 */
export function ruleAdherenceRate(checks: readonly RuleCheckRecord[]): CalcResult<string> {
  let followed = 0;
  let violated = 0;
  for (const check of checks) {
    if (check.status === 'followed') followed += 1;
    else if (check.status === 'violated') violated += 1;
  }
  const denominator = followed + violated;
  if (denominator === 0) return calcErr('no_rule_checks');
  return calcOk(toCanonicalR(new CalcDecimal(followed).dividedBy(denominator)));
}
