import type { OutcomeValue, SystemStatus, TradeStatus } from '@/lib/trades/constants';

import { CalcDecimal, parseCalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

/**
 * 07D consumes already-resolved Trade calculation snapshots — the R values
 * and outcome classifications Phase 07C's `trade.ts` produced and a future
 * Phase 08 persisted. Nothing in this file recalculates Actual R or System R
 * from prices; every function here takes an R string (or a snapshot record
 * carrying one) as trusted input.
 */

// ---------------------------------------------------------------------------
// Eligible populations
// ---------------------------------------------------------------------------

/**
 * The minimal shape `isTraderEligible` needs. Trader metrics are eligible
 * when: execution `status` is `closed`; not soft-deleted (`deletedAt`);
 * `actualR`, `traderOutcome`, and the Actual `exitedAt` exist. **System status does not
 * matter** — a closed Trader Trade with `system_status = 'pending'` is
 * still fully eligible for Trader metrics (Phase 07D's locked eligibility
 * rule; Trader close and System resolution are independent lifecycles,
 * Phase 07B/07C).
 */
export interface TraderEligibleTradeInput {
  readonly status: TradeStatus | string;
  readonly deletedAt: Date | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly exitedAt: Date | string | null;
}

export function isTraderEligible(trade: TraderEligibleTradeInput): boolean {
  return (
    trade.status === 'closed' &&
    trade.deletedAt === null &&
    trade.actualR !== null &&
    trade.traderOutcome !== null &&
    trade.exitedAt !== null
  );
}

/** Filters to the Trader-eligible subset, preserving each record's full original shape. */
export function selectTraderEligible<T extends TraderEligibleTradeInput>(
  trades: readonly T[],
): readonly T[] {
  return trades.filter(isTraderEligible);
}

/**
 * The minimal shape `isSystemEligible` needs. System metrics are eligible
 * only when `system_status = 'resolved'`, `systemR` exists, `systemOutcome`
 * exists, `systemExitedAt` exists, and the Trade is not soft-deleted. `pending` and `no_trade` are
 * both excluded — neither is ever treated as a `0R` sample.
 */
export interface SystemEligibleTradeInput {
  readonly systemStatus: SystemStatus | string;
  readonly deletedAt: Date | null;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemExitedAt: Date | string | null;
}

export function isSystemEligible(trade: SystemEligibleTradeInput): boolean {
  return (
    trade.systemStatus === 'resolved' &&
    trade.deletedAt === null &&
    trade.systemR !== null &&
    trade.systemOutcome !== null &&
    trade.systemExitedAt !== null
  );
}

/** Filters to the System-eligible subset, preserving each record's full original shape. */
export function selectSystemEligible<T extends SystemEligibleTradeInput>(
  trades: readonly T[],
): readonly T[] {
  return trades.filter(isSystemEligible);
}

// ---------------------------------------------------------------------------
// Total R / Average R / Expectancy
// ---------------------------------------------------------------------------

/** Sums raw, UNROUNDED — the one internal building block every R-list metric below shares, so a sum is never rounded until its own final return. */
function sumRawDecimals(values: readonly string[]): CalcResult<CalcDecimalValue> {
  let sum = new CalcDecimal(0);
  for (const value of values) {
    const parsed = parseCalcDecimal(value);
    if (parsed === null) return calcErr('invalid_decimal');
    sum = sum.plus(parsed);
  }
  return calcOk(sum);
}

/**
 * `totalR = sum(all eligible R values)`. An empty input is never a
 * legitimate `0R` sample — a real populated sample that happens to total
 * exactly zero (`[1R, -1R]`) must remain distinguishable from having no
 * data at all (`no_trades`).
 */
export function totalR(values: readonly string[]): CalcResult<string> {
  if (values.length === 0) return calcErr('no_trades');
  const sumResult = sumRawDecimals(values);
  if (!sumResult.ok) return sumResult;
  return calcOk(toCanonicalR(sumResult.value));
}

/**
 * `averageR = totalR / eligible Trade count`. Every eligible Trade remains
 * in the denominator, including break-even-classified ones — a `+0.0300R`
 * Trade is not discarded merely because `classifyOutcome` calls it
 * `break_even`.
 */
export function averageR(values: readonly string[]): CalcResult<string> {
  if (values.length === 0) return calcErr('no_trades');
  const sumResult = sumRawDecimals(values);
  if (!sumResult.ok) return sumResult;
  return calcOk(toCanonicalR(sumResult.value.dividedBy(values.length)));
}

/**
 * Expectancy in R is, for this engine, exactly the mean realized R per
 * eligible Trade — mathematically identical to {@link averageR}, not a
 * second, independently-maintained implementation that could silently
 * diverge from it. This function exists so a caller can name the concept it
 * means ("expectancy") without reaching into `averageR` and re-deriving the
 * relationship itself. No UI-facing verdict/interpretation is implemented
 * here — that is a later phase's job.
 */
export function expectancyR(values: readonly string[]): CalcResult<string> {
  return averageR(values);
}

// ---------------------------------------------------------------------------
// Win rate / average win / average loss / payoff ratio
// ---------------------------------------------------------------------------

/**
 * The trusted, already-classified snapshot a Trade carries —
 * `trader_outcome`/`system_outcome`, never recomputed here. Win-rate and
 * win/loss-average functions read `outcome` directly rather than
 * reclassifying `r` themselves, exactly as the Phase 07D brief requires.
 */
export interface OutcomeRecord {
  readonly r: string;
  readonly outcome: OutcomeValue;
}

export interface OutcomeCounts {
  readonly wins: number;
  readonly breakEvens: number;
  readonly losses: number;
}

/**
 * Canonical resolved-outcome counts. These use the persisted outcome snapshot,
 * exactly like {@link winRate}; they never reclassify a Trade from its R sign.
 */
export function outcomeCounts(records: readonly OutcomeRecord[]): OutcomeCounts {
  let wins = 0;
  let breakEvens = 0;
  let losses = 0;
  for (const record of records) {
    if (record.outcome === 'win') wins += 1;
    else if (record.outcome === 'break_even') breakEvens += 1;
    else if (record.outcome === 'loss') losses += 1;
  }
  return { wins, breakEvens, losses };
}

/**
 * `winRate = wins / eligible resolved Trade count`. The denominator
 * includes wins, losses, AND break-even Trades — break-even is never
 * removed from it. Returns a deterministic decimal ratio (`'0.6000'` for
 * 60%), never formatted UI text; presentation belongs to a later phase.
 */
export function winRate(records: readonly OutcomeRecord[]): CalcResult<string> {
  if (records.length === 0) return calcErr('no_trades');
  const wins = records.filter((record) => record.outcome === 'win').length;
  return calcOk(toCanonicalR(new CalcDecimal(wins).dividedBy(records.length)));
}

function parseOutcomeSubset(
  records: readonly OutcomeRecord[],
  outcome: OutcomeValue,
): CalcResult<readonly CalcDecimalValue[]> {
  const parsed: CalcDecimalValue[] = [];
  for (const record of records) {
    if (record.outcome !== outcome) continue;
    const decimal = parseCalcDecimal(record.r);
    if (decimal === null) return calcErr('invalid_decimal');
    parsed.push(decimal);
  }
  return calcOk(parsed);
}

function rawAverage(values: readonly CalcDecimalValue[]): CalcDecimalValue {
  let sum = new CalcDecimal(0);
  for (const value of values) sum = sum.plus(value);
  return sum.dividedBy(values.length);
}

/**
 * The average R of `outcome === 'win'` Trades only, preserving its
 * (positive) sign — never converted to a magnitude, since it already is
 * one. No wins in the input -> `no_wins`, never `0R` (a win rate of zero
 * wins is not the same claim as "the average win was worth nothing").
 * Break-even Trades never participate in this subset.
 */
export function averageWinR(records: readonly OutcomeRecord[]): CalcResult<string> {
  const winsResult = parseOutcomeSubset(records, 'win');
  if (!winsResult.ok) return winsResult;
  if (winsResult.value.length === 0) return calcErr('no_wins');
  return calcOk(toCanonicalR(rawAverage(winsResult.value)));
}

/**
 * The average R of `outcome === 'loss'` Trades only, returned as the actual
 * SIGNED NEGATIVE average — this function does not convert it to a positive
 * magnitude (that conversion, where needed, is {@link payoffRatio}'s own
 * job, not this function's). No losses in the input -> `no_losses`. Break-
 * even Trades never participate in this subset.
 */
export function averageLossR(records: readonly OutcomeRecord[]): CalcResult<string> {
  const lossesResult = parseOutcomeSubset(records, 'loss');
  if (!lossesResult.ok) return lossesResult;
  if (lossesResult.value.length === 0) return calcErr('no_losses');
  return calcOk(toCanonicalR(rawAverage(lossesResult.value)));
}

/**
 * `payoffRatio = averageWinR / abs(averageLossR)`. Computes its own raw win
 * and loss averages internally rather than re-parsing {@link averageWinR}/
 * {@link averageLossR}'s already-rounded string outputs — dividing two
 * independently-rounded 4dp values would round twice before this function's
 * own final rounding, which the "round only the final requested metric"
 * rule forbids. No wins -> `no_wins`; no losses -> `no_losses`; the result
 * is always a non-negative decimal ratio, never clamped, never `Infinity`.
 */
export function payoffRatio(records: readonly OutcomeRecord[]): CalcResult<string> {
  const winsResult = parseOutcomeSubset(records, 'win');
  if (!winsResult.ok) return winsResult;
  if (winsResult.value.length === 0) return calcErr('no_wins');

  const lossesResult = parseOutcomeSubset(records, 'loss');
  if (!lossesResult.ok) return lossesResult;
  if (lossesResult.value.length === 0) return calcErr('no_losses');

  const avgWin = rawAverage(winsResult.value);
  const avgLoss = rawAverage(lossesResult.value);
  return calcOk(toCanonicalR(avgWin.dividedBy(avgLoss.absoluteValue())));
}

// ---------------------------------------------------------------------------
// Profit factor
// ---------------------------------------------------------------------------

/**
 * `profitFactor = grossPositiveR / abs(grossNegativeR)`, where
 * `grossPositiveR = sum(R where R > 0)` and `grossNegativeR = sum(R where R
 * < 0)`. Uses R, not currency money, for Phase 07 metrics. Classification
 * never enters this calculation — a `+0.0300R` Trade the outcome snapshot
 * calls `break_even` still contributes its full `+0.0300R` to
 * `grossPositiveR`, and a `-0.0300R` break-even Trade still contributes to
 * `grossNegativeR`; this function only ever reads the sign of `R` itself,
 * never an `outcome` field (it does not even accept one).
 *
 * The same pure function serves both System Profit Factor and Trader Profit
 * Factor — callers pass their own independently-eligible R population; nothing
 * here is axis-specific.
 *
 * Rules, in order: empty population -> `no_trades`; positive R exists and no
 * negative R -> `no_losses`; negative R exists and no positive R -> a
 * successful `'0.0000'` (never a failure — a fully losing sample has a
 * well-defined profit factor of zero); every R exactly zero ->
 * `no_profit_or_loss`; never `Infinity`.
 */
export function profitFactor(values: readonly string[]): CalcResult<string> {
  if (values.length === 0) return calcErr('no_trades');

  let grossPositive = new CalcDecimal(0);
  let grossNegative = new CalcDecimal(0);
  for (const value of values) {
    const parsed = parseCalcDecimal(value);
    if (parsed === null) return calcErr('invalid_decimal');
    // `.isPositive()`/`.isNegative()` are sign-only in decimal.js — a plain
    // `Decimal(0)` carries a positive sign internally, so `.isPositive()`
    // incorrectly returns `true` for exact zero. `.greaterThan(0)`/
    // `.lessThan(0)` are the magnitude-correct checks this classification
    // actually needs.
    if (parsed.greaterThan(0)) {
      grossPositive = grossPositive.plus(parsed);
    } else if (parsed.lessThan(0)) {
      grossNegative = grossNegative.plus(parsed);
    }
  }

  const hasPositive = grossPositive.greaterThan(0);
  const hasNegative = grossNegative.lessThan(0);

  if (!hasPositive && !hasNegative) return calcErr('no_profit_or_loss');
  if (hasPositive && !hasNegative) return calcErr('no_losses');
  if (!hasPositive && hasNegative) return calcOk('0.0000');
  return calcOk(toCanonicalR(grossPositive.dividedBy(grossNegative.absoluteValue())));
}
