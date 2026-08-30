import {
  composeComparisonAnalytics,
  toAnalyticsMetric,
  type AnalyticsMetric,
  type ComparisonAnalyticsModel,
  type ComparisonMetricRecord,
} from '@/lib/analytics/metrics';
import { isComparisonEligible, selectComparisonEligible } from '@/lib/calc/attribution';
import {
  CalcDecimal,
  parseCalcDecimal,
  toCanonicalR,
  type CalcDecimalValue,
} from '@/lib/calc/decimal';
import { calcErr, calcOk } from '@/lib/calc/types';
import { calendarDateIn, type CalendarDate } from '@/lib/time';

/**
 * ONE PAIRED TRADE, AT TRADE LEVEL.
 *
 * `exitedAt` is the Actual exit — the D1 Population C comparison axis, and
 * the only field that decides range inclusion or ordering.
 * `systemExitedAt` rides along as metadata because it is genuinely useful
 * context for a reader ("the System would have been out 40 minutes
 * earlier"), and for no other reason: it is never a second date gate, never
 * a sort key, and never a bucket key. Introducing a second comparison date
 * contract is exactly what D5 must not do.
 *
 * Cumulative fields are the running totals INCLUDING this Trade, in the
 * canonical order. They live here rather than in a component because a React
 * render is not a place to accumulate financial series: two components would
 * accumulate twice, and a memo boundary would accumulate a different subset.
 */
export interface ExecutionComparisonTradePoint {
  readonly tradeId: string;
  /** Actual `exited_at`, ISO-8601 UTC. The comparison timestamp. */
  readonly exitedAt: string;
  /** System `system_exited_at`, ISO-8601 UTC. Metadata only — never a range gate. */
  readonly systemExitedAt: string;
  readonly systemR: string;
  readonly actualR: string;
  /** Canonical `actualR - systemR` for this Trade. */
  readonly executionGapR: string;
  readonly cumulativeSystemR: string;
  readonly cumulativeActualR: string;
  readonly cumulativeExecutionGapR: string;
}

/**
 * One local calendar day's paired rollup.
 *
 * `date` is resolved in the workspace's configured analytics IANA timezone
 * (CLAUDE.md §7) — never the server's zone, never the browser's, and never a
 * UTC calendar boundary unless UTC is what the user configured. A Trade
 * closed 23:30 in Bangkok belongs to that Bangkok day.
 *
 * DAYS WITH NO PAIRED TRADES ARE ABSENT, not zero-filled. A zero row would
 * assert "on this day the Trader matched the System exactly", which is a
 * different and false claim from "nothing paired closed that day". D5B can
 * densify for a continuous x-axis if a chart needs it — that is a
 * presentation decision, and it needs the truthful sparse series to make it.
 */
export interface ExecutionComparisonDailyPoint {
  readonly date: CalendarDate;
  readonly pairedTradeCount: number;
  readonly systemR: string;
  readonly actualR: string;
  readonly executionGapR: string;
  readonly cumulativeSystemR: string;
  readonly cumulativeActualR: string;
  readonly cumulativeExecutionGapR: string;
}

/**
 * How the paired Gap distributes by sign. Three counts and two extremes —
 * facts, not a verdict.
 *
 * Deliberately NOT a leakage score, a trader grade, or a threshold band.
 * CLAUDE.md's standing refusal to invent a Discipline Score applies with
 * exactly the same force here: counting how many Trades fell on each side of
 * zero is arithmetic, and weighting them into a single number would be an
 * unapproved judgement.
 *
 * `matched` is an EXACT zero gap, not a tolerance band.
 * `BREAK_EVEN_TOLERANCE_R` classifies a Trade's own OUTCOME; borrowing it
 * here would silently reclassify a real -0.04R execution difference as
 * "matched the System", which is a different claim about a different
 * quantity. Persisted R is `NUMERIC(12,4)`, so an exact zero difference is
 * well defined and cheap to test for.
 */
export interface ExecutionComparisonDistribution {
  /** Gap < 0 — the Trader captured less R than the System on that Trade. */
  readonly underperformedCount: number;
  /** Gap exactly 0. */
  readonly matchedCount: number;
  /** Gap > 0 — the Trader captured more R than the System's counterfactual. */
  readonly outperformedCount: number;
  /** The minimum paired Gap: the largest negative gap when any pair is negative. */
  readonly minimumExecutionGapR: AnalyticsMetric;
  /** The maximum paired Gap: the largest positive gap when any pair is positive. */
  readonly maximumExecutionGapR: AnalyticsMetric;
}

/**
 * WHY a Trade that reached this composer is not in the paired population.
 *
 * A count on its own cannot carry this. The paired System total is 35.80R
 * against the System card's 36.25R on the reference fixture, and "excluding
 * 6 Trades" does not explain a number moving in a direction the reader did
 * not ask for — "2 awaiting a System result, 2 still open, 2 not entered"
 * does. Each reason names a state the reader can act on, and each maps to a
 * lifecycle field rather than to an inference.
 *
 * The order is the order they are reported in.
 */
export const COMPARISON_EXCLUSION_REASONS = [
  /** Actual side complete; the System verdict has not been recorded yet. */
  'awaiting_system_result',
  /** System side complete; the Trade is entered but not yet closed. */
  'trade_open',
  /** System side complete; the Trade was planned and never entered. */
  'trade_planned',
  /** System side complete; the Trade was abandoned before entry. */
  'trade_canceled',
  /**
   * Neither of the above fits — a closed Trade missing its own Actual R, or
   * any other partial record. Deliberately last and deliberately vague: it
   * is a data gap, not a lifecycle state, and naming it as one would be a
   * reassurance the record does not support.
   */
  'incomplete_record',
] as const;

export type ComparisonExclusionReason = (typeof COMPARISON_EXCLUSION_REASONS)[number];

export interface ComparisonExclusions {
  readonly total: number;
  readonly byReason: Readonly<Record<ComparisonExclusionReason, number>>;
}

/**
 * The D5A comparison contract.
 *
 * Availability is a discriminated status rather than an empty array, because
 * "no Trade has both sides complete yet" and "a stored R failed to parse" are
 * different facts that deserve different words on screen. `summary` is
 * present in EVERY state — including `empty` and `error` — so a caller can
 * always render the truthful D2 summary (which carries its own per-metric
 * unavailable reasons) without first proving the series exists.
 *
 * A paired population whose System total is zero or negative stays
 * `available`: the series, the Gap and the distribution are all still real
 * and still meaningful. Only `summary.systemEdgeCaptured` goes unavailable
 * with `system_has_no_edge`. Hiding the whole comparison because one ratio is
 * undefined would throw away the answer to the question D5 exists to ask.
 */
export type DashboardExecutionComparison =
  | {
      readonly status: 'available';
      readonly summary: ComparisonAnalyticsModel;
      readonly exclusions: ComparisonExclusions;
      readonly tradeSeries: readonly ExecutionComparisonTradePoint[];
      readonly dailySeries: readonly ExecutionComparisonDailyPoint[];
      readonly distribution: ExecutionComparisonDistribution;
    }
  | {
      readonly status: 'empty';
      readonly reason: 'no_comparable_trades';
      readonly summary: ComparisonAnalyticsModel;
      readonly exclusions: ComparisonExclusions;
    }
  | {
      readonly status: 'error';
      readonly reason: 'data_integrity_error';
      readonly summary: ComparisonAnalyticsModel;
      readonly exclusions: ComparisonExclusions;
    };

/**
 * Classifies the candidates this composer was handed but could not pair.
 *
 * It counts what it was GIVEN, which is why it belongs here rather than on
 * the shared `ComparisonAnalyticsModel`: the Dashboard hands over Population
 * A ∪ B and gets a truthful answer, while callers that synthesise their own
 * already-filtered records (the insight pillars, for one) would get a
 * meaningless zero from the same code and are not offered it.
 */
export function composeComparisonExclusions(
  records: readonly ComparisonMetricRecord[],
): ComparisonExclusions {
  const byReason: Record<ComparisonExclusionReason, number> = {
    awaiting_system_result: 0,
    trade_open: 0,
    trade_planned: 0,
    trade_canceled: 0,
    incomplete_record: 0,
  };

  let total = 0;
  for (const record of records) {
    if (isComparisonEligible(record)) continue;
    total += 1;

    const actualComplete =
      record.status === 'closed' &&
      record.actualR !== null &&
      record.traderOutcome !== null &&
      record.actualExitedAt !== null;

    if (actualComplete) {
      byReason.awaiting_system_result += 1;
      continue;
    }
    if (record.status === 'open') byReason.trade_open += 1;
    else if (record.status === 'planned') byReason.trade_planned += 1;
    else if (record.status === 'canceled') byReason.trade_canceled += 1;
    else byReason.incomplete_record += 1;
  }

  return { total, byReason };
}

interface PreparedPair {
  readonly tradeId: string;
  readonly exitedAt: string;
  readonly exitedAtInstant: Date;
  readonly systemExitedAt: string;
  readonly systemR: string;
  readonly actualR: string;
}

function integrity(
  summary: ComparisonAnalyticsModel,
  exclusions: ComparisonExclusions,
): DashboardExecutionComparison {
  return { status: 'error', reason: 'data_integrity_error', summary, exclusions };
}

/**
 * Composes the paired trade series, its daily rollup, and the Gap
 * distribution from the SAME Population C records D2 already fetched for the
 * comparison summary. No second query, no second date contract, no second
 * gap formula.
 *
 * PRECISION. Every running total is accumulated as a full-precision
 * `CalcDecimal` and rounded exactly once, at the moment each point is
 * emitted — never by summing already-rounded per-point strings, which is how
 * a "deterministic" cumulative line quietly drifts from its own summary
 * total. `Number` never touches an R value on this path, so no series point
 * can be `NaN` or `Infinity`.
 *
 * The identity `cumulativeGap = cumulativeActual - cumulativeSystem` holds
 * exactly, at every point, because the gap accumulator is the difference of
 * the same two accumulators rather than an independent sum. Persisted R is
 * `NUMERIC(12,4)`, so the one rounding step is exact and the identity
 * survives into the emitted strings.
 */
export function composeExecutionComparison(
  records: readonly ComparisonMetricRecord[],
  timeZone: string,
): DashboardExecutionComparison {
  // The D2 summary is composed from the FULL record set, exactly as before —
  // `composeComparisonAnalytics` applies the same eligibility filter itself,
  // so summary and series can never disagree about who is paired.
  const summary = composeComparisonAnalytics(records);
  const exclusions = composeComparisonExclusions(records);
  const eligible = selectComparisonEligible(records);

  if (eligible.length === 0) {
    return { status: 'empty', reason: 'no_comparable_trades', summary, exclusions };
  }

  const prepared: PreparedPair[] = [];
  for (const record of eligible) {
    // Eligibility already proved these non-null; the checks keep that fact
    // local rather than asserting it with a cast.
    const { actualExitedAt, systemExitedAt, actualR, systemR } = record;
    if (actualExitedAt === null || systemExitedAt === null) return integrity(summary, exclusions);
    if (actualR === null || systemR === null) return integrity(summary, exclusions);
    const instant = new Date(actualExitedAt);
    if (Number.isNaN(instant.getTime())) return integrity(summary, exclusions);
    if (parseCalcDecimal(actualR) === null || parseCalcDecimal(systemR) === null) {
      return integrity(summary, exclusions);
    }
    prepared.push({
      tradeId: record.tradeId,
      exitedAt: actualExitedAt,
      exitedAtInstant: instant,
      systemExitedAt,
      systemR,
      actualR,
    });
  }

  // ORDERING IS OWNED HERE, not inherited from the caller. The D2 read
  // already returns this order, but a composer whose cumulative path depends
  // on an upstream ORDER BY is one refactor away from a silently different
  // chart. Trade ID breaks timestamp ties, so identical exit instants can
  // never produce two different cumulative paths for the same data.
  const ordered = [...prepared].sort((left, right) => {
    const byInstant = left.exitedAtInstant.getTime() - right.exitedAtInstant.getTime();
    if (byInstant !== 0) return byInstant;
    return left.tradeId < right.tradeId ? -1 : left.tradeId > right.tradeId ? 1 : 0;
  });

  let cumulativeSystem = new CalcDecimal(0);
  let cumulativeActual = new CalcDecimal(0);
  let underperformedCount = 0;
  let matchedCount = 0;
  let outperformedCount = 0;
  let minimumGap: CalcDecimalValue | null = null;
  let maximumGap: CalcDecimalValue | null = null;

  const tradeSeries: ExecutionComparisonTradePoint[] = [];
  const dailyTotals = new Map<
    CalendarDate,
    {
      count: number;
      system: CalcDecimalValue;
      actual: CalcDecimalValue;
    }
  >();

  for (const pair of ordered) {
    const systemDecimal = parseCalcDecimal(pair.systemR);
    const actualDecimal = parseCalcDecimal(pair.actualR);
    if (systemDecimal === null || actualDecimal === null) return integrity(summary, exclusions);
    const gap = actualDecimal.minus(systemDecimal);

    if (gap.lessThan(0)) underperformedCount += 1;
    else if (gap.greaterThan(0)) outperformedCount += 1;
    else matchedCount += 1;
    if (minimumGap === null || gap.lessThan(minimumGap)) minimumGap = gap;
    if (maximumGap === null || gap.greaterThan(maximumGap)) maximumGap = gap;

    cumulativeSystem = cumulativeSystem.plus(systemDecimal);
    cumulativeActual = cumulativeActual.plus(actualDecimal);

    tradeSeries.push({
      tradeId: pair.tradeId,
      exitedAt: pair.exitedAt,
      systemExitedAt: pair.systemExitedAt,
      systemR: toCanonicalR(systemDecimal),
      actualR: toCanonicalR(actualDecimal),
      executionGapR: toCanonicalR(gap),
      cumulativeSystemR: toCanonicalR(cumulativeSystem),
      cumulativeActualR: toCanonicalR(cumulativeActual),
      cumulativeExecutionGapR: toCanonicalR(cumulativeActual.minus(cumulativeSystem)),
    });

    const date = calendarDateIn(pair.exitedAtInstant, timeZone);
    if (!date.ok) return integrity(summary, exclusions);
    const bucket = dailyTotals.get(date.value);
    if (bucket === undefined) {
      dailyTotals.set(date.value, { count: 1, system: systemDecimal, actual: actualDecimal });
    } else {
      bucket.count += 1;
      bucket.system = bucket.system.plus(systemDecimal);
      bucket.actual = bucket.actual.plus(actualDecimal);
    }
  }

  // `CalendarDate` is `YYYY-MM-DD`, so lexicographic order IS chronological
  // order. Sorting rather than trusting insertion order keeps the daily
  // series correct even if a caller ever hands this composer an unordered
  // population — the same reason the trade series sorts for itself above.
  const dailyDates = [...dailyTotals.keys()].sort();
  let dailyCumulativeSystem = new CalcDecimal(0);
  let dailyCumulativeActual = new CalcDecimal(0);
  const dailySeries: ExecutionComparisonDailyPoint[] = [];
  for (const date of dailyDates) {
    const bucket = dailyTotals.get(date);
    if (bucket === undefined) return integrity(summary, exclusions);
    dailyCumulativeSystem = dailyCumulativeSystem.plus(bucket.system);
    dailyCumulativeActual = dailyCumulativeActual.plus(bucket.actual);
    dailySeries.push({
      date,
      pairedTradeCount: bucket.count,
      systemR: toCanonicalR(bucket.system),
      actualR: toCanonicalR(bucket.actual),
      executionGapR: toCanonicalR(bucket.actual.minus(bucket.system)),
      cumulativeSystemR: toCanonicalR(dailyCumulativeSystem),
      cumulativeActualR: toCanonicalR(dailyCumulativeActual),
      cumulativeExecutionGapR: toCanonicalR(dailyCumulativeActual.minus(dailyCumulativeSystem)),
    });
  }

  return {
    status: 'available',
    summary,
    exclusions,
    tradeSeries,
    dailySeries,
    distribution: {
      underperformedCount,
      matchedCount,
      outperformedCount,
      // Unreachable while `eligible.length > 0`, but expressed as a real
      // result rather than a cast: an extreme over an empty population has
      // no value, and saying so costs nothing.
      minimumExecutionGapR: toAnalyticsMetric(
        minimumGap === null ? calcErr('no_comparable_trades') : calcOk(toCanonicalR(minimumGap)),
      ),
      maximumExecutionGapR: toAnalyticsMetric(
        maximumGap === null ? calcErr('no_comparable_trades') : calcOk(toCanonicalR(maximumGap)),
      ),
    },
  };
}
