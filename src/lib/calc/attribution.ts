import type {
  OutcomeValue,
  RuleCheckStatus,
  SystemStatus,
  TradeStatus,
} from '@/lib/trades/constants';

import { CalcDecimal, parseCalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

// ---------------------------------------------------------------------------
// Comparison-eligible population
// ---------------------------------------------------------------------------

/**
 * A Trade contributes to System-versus-Trader comparison only when BOTH
 * axes are independently complete for that same Trade. This is deliberately
 * the intersection of the Population A and Population B contracts: a
 * closed Trader Trade with a still-`pending` System side is fully eligible
 * for Trader metrics but NOT for comparison.
 */
export interface ComparisonEligibleTradeInput {
  readonly status: TradeStatus | string;
  readonly deletedAt: Date | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly actualExitedAt: Date | string | null;
  readonly systemStatus: SystemStatus | string;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemExitedAt: Date | string | null;
}

export function isComparisonEligible(trade: ComparisonEligibleTradeInput): boolean {
  return (
    trade.deletedAt === null &&
    trade.status === 'closed' &&
    trade.actualR !== null &&
    trade.traderOutcome !== null &&
    trade.actualExitedAt !== null &&
    trade.systemStatus === 'resolved' &&
    trade.systemR !== null &&
    trade.systemOutcome !== null &&
    trade.systemExitedAt !== null
  );
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
// System-vs-Trader Execution Gap
// ---------------------------------------------------------------------------

/**
 * `executionGapR = actualR - systemR` for one comparable Trade (Phase 13H,
 * the frozen customer contract — CLAUDE.md §6, `docs/phases/PHASE-13-journal-v2.md`
 * §1). NEGATIVE means the Trader captured LESS R than the System; zero means
 * they matched; POSITIVE means the Trader captured MORE R than the
 * counterfactual System — never described as an error, never clamped.
 *
 * This is the sign-corrected, renamed successor to the pre-13H
 * `edgeLeakageR = systemR - actualR` (opposite sign, "positive means less
 * captured"). The rename is deliberate, not cosmetic: keeping the old name
 * with an inverted meaning would let a stale caller compile and silently
 * produce inverted numbers.
 */
export function executionGapR(
  actualR: string | null | undefined,
  systemR: string | null | undefined,
): CalcResult<string> {
  if (systemR === null || systemR === undefined || actualR === null || actualR === undefined) {
    return calcErr('missing_input');
  }
  const systemDecimal = parseCalcDecimal(systemR);
  const actualDecimal = parseCalcDecimal(actualR);
  if (systemDecimal === null || actualDecimal === null) return calcErr('invalid_decimal');
  return calcOk(toCanonicalR(actualDecimal.minus(systemDecimal)));
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
 * Aggregate paired Execution Gap over the SAME comparable-Trade population —
 * summed from each pair's raw, unrounded `(actualR - systemR)` difference
 * and rounded exactly once at the end (never by summing already-rounded
 * per-Trade {@link executionGapR} outputs, which would round twice). Equal,
 * at full precision, to the sum of every pair's individual gap. Empty
 * input -> `no_comparable_trades`.
 */
export function pairedExecutionGapR(pairs: readonly PairedRTrade[]): CalcResult<string> {
  if (pairs.length === 0) return calcErr('no_comparable_trades');
  const parsedResult = parsePairedDecimals(pairs);
  if (!parsedResult.ok) return parsedResult;

  let sum = new CalcDecimal(0);
  for (const { system, actual } of parsedResult.value) {
    sum = sum.plus(actual.minus(system));
  }
  return calcOk(toCanonicalR(sum));
}

/**
 * `Average Execution Gap = AVG(actualR - systemR)` over the paired
 * population — Phase 13H's PRIMARY Execution Gap aggregate (§6), each
 * comparable Trade weighted equally. Computed from the same raw,
 * unrounded per-pair differences {@link pairedExecutionGapR} sums (summed
 * once, divided by count, rounded exactly once at the end) — never derived
 * by subtracting two already-rounded axis averages, which would silently
 * change the population weighting when the Trader- and System-eligible
 * populations differ in size.
 */
export function averageExecutionGapR(pairs: readonly PairedRTrade[]): CalcResult<string> {
  if (pairs.length === 0) return calcErr('no_comparable_trades');
  const parsedResult = parsePairedDecimals(pairs);
  if (!parsedResult.ok) return parsedResult;

  let sum = new CalcDecimal(0);
  for (const { system, actual } of parsedResult.value) {
    sum = sum.plus(actual.minus(system));
  }
  return calcOk(toCanonicalR(sum.dividedBy(pairs.length)));
}

// ---------------------------------------------------------------------------
// System Edge Captured
// ---------------------------------------------------------------------------

/**
 * `systemEdgeCaptured = pairedActualTotalR / pairedSystemTotalR`, over
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
export function systemEdgeCaptured(pairs: readonly PairedRTrade[]): CalcResult<string> {
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

export interface TradeRuleCheckRecord extends RuleCheckRecord {
  readonly tradeId: string;
  readonly isRequired: boolean;
}

export interface TradeRuleAdherenceSummary {
  readonly evaluatedTradeCount: number;
  readonly compliantTradeCount: number;
  readonly nonCompliantTradeCount: number;
  readonly incompleteTradeCount: number;
  readonly notApplicableTradeCount: number;
  readonly rate: CalcResult<string>;
}

/**
 * Trade-level Rule Adherence is deliberately distinct from check-level
 * {@link ruleAdherenceRate}. Only snapshotted required execution Rules govern
 * whether a Trade is evaluated: optional checks are informational. A required
 * `not_checked` (or unknown future status) leaves the Trade incomplete;
 * `not_applicable` is resolved but does not create an applicable check. An
 * evaluated Trade has at least one applicable required check and no unresolved
 * required checks. It is compliant only when none of those checks is violated.
 */
export function tradeRuleAdherence(
  checks: readonly TradeRuleCheckRecord[],
): TradeRuleAdherenceSummary {
  const byTrade = new Map<string, RuleCheckRecord[]>();
  for (const check of checks) {
    if (!check.isRequired) continue;
    const existing = byTrade.get(check.tradeId);
    if (existing === undefined) byTrade.set(check.tradeId, [check]);
    else existing.push(check);
  }

  let evaluatedTradeCount = 0;
  let compliantTradeCount = 0;
  let nonCompliantTradeCount = 0;
  let incompleteTradeCount = 0;
  let notApplicableTradeCount = 0;
  for (const tradeChecks of byTrade.values()) {
    const unresolved = tradeChecks.some(
      (check) => !['followed', 'violated', 'not_applicable'].includes(check.status),
    );
    if (unresolved) {
      incompleteTradeCount += 1;
      continue;
    }
    const applicable = tradeChecks.filter(
      (check) => check.status === 'followed' || check.status === 'violated',
    );
    if (applicable.length === 0) {
      notApplicableTradeCount += 1;
      continue;
    }
    evaluatedTradeCount += 1;
    if (applicable.some((check) => check.status === 'violated')) nonCompliantTradeCount += 1;
    else compliantTradeCount += 1;
  }

  return {
    evaluatedTradeCount,
    compliantTradeCount,
    nonCompliantTradeCount,
    incompleteTradeCount,
    notApplicableTradeCount,
    rate:
      evaluatedTradeCount === 0
        ? calcErr('no_evaluated_trades')
        : calcOk(toCanonicalR(new CalcDecimal(compliantTradeCount).dividedBy(evaluatedTradeCount))),
  };
}
