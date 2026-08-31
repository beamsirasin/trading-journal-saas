import { CalcDecimal, parseCalcDecimal, toCanonicalR } from '@/lib/calc/decimal';
import { classifyDayTotalR } from '@/lib/calc/trading-day';
import { calendarDateIn, type CalendarDate } from '@/lib/time';
import type { OutcomeValue } from '@/lib/trades/constants';

/**
 * WHICH QUESTION THE CALENDAR IS ANSWERING.
 *
 * Not a display toggle over one dataset — three genuinely different
 * populations on three different date axes, exactly as D1 froze them:
 *
 *   `actual`  Population A, bucketed by Actual `exited_at`
 *   `system`  Population B, bucketed by `system_exited_at`
 *   `gap`     Population C, bucketed by Actual `exited_at` only
 *
 * The same Trade can legitimately land on a DIFFERENT local day in `actual`
 * than in `system` — it exited on Monday evening and the System's own exit
 * resolved on Tuesday morning. That is information, not drift, and nothing
 * here forces the two axes into alignment.
 */
export const CALENDAR_MODES = ['actual', 'system', 'gap'] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export function isCalendarMode(value: unknown): value is CalendarMode {
  return typeof value === 'string' && (CALENDAR_MODES as readonly string[]).includes(value);
}

/**
 * A day's verdict in R modes, from the day's TOTAL R — never from which
 * outcome won a majority of the Trades. Three losses and one large win is a
 * winning day; the total is what the account actually did.
 *
 * The verdict comes from `classifyDayTotalR` (`src/lib/calc/trading-day.ts`),
 * which `dayWinRate` also calls, so the Calendar and the Day Win % KPI cannot
 * disagree about what kind of day a day was. That used to be a claim this
 * comment made about two separate copies of a sign test; it is now enforced
 * by there being one function.
 *
 * The rule is the break-even BAND, not a comparison to zero — the same
 * `BREAK_EVEN_TOLERANCE_R` a Trade's own R is judged by, because a day total
 * is a sum of those same R values.
 */
export type CalendarDayClassification = 'winning' | 'break_even' | 'losing';

/**
 * Gap days are NEVER "winning" or "losing".
 *
 * A positive Gap means the Trader captured more R than the System's own
 * counterfactual on that day's paired Trades — which can happen on a day the
 * account lost money. Calling it a "winning day" would assert something the
 * number does not say. The vocabulary is relative and comparative, matching
 * D5's distribution wording exactly.
 */
export type CalendarGapClassification = 'outperformed' | 'matched' | 'underperformed';

interface CalendarDayBase {
  readonly date: CalendarDate;
}

export interface CalendarPerformanceDay extends CalendarDayBase {
  readonly mode: 'actual' | 'system';
  readonly eligibleTradeCount: number;
  readonly totalR: string;
  readonly wins: number;
  readonly breakEvens: number;
  readonly losses: number;
  readonly classification: CalendarDayClassification;
}

export interface CalendarGapDay extends CalendarDayBase {
  readonly mode: 'gap';
  readonly pairedTradeCount: number;
  readonly systemR: string;
  readonly actualR: string;
  readonly gapR: string;
  readonly classification: CalendarGapClassification;
  readonly underperformedCount: number;
  readonly matchedCount: number;
  readonly outperformedCount: number;
}

/**
 * A discriminated union rather than one wide row with half its fields null.
 * A `gap` day has no meaningful `wins`, and an `actual` day has no
 * `pairedTradeCount`; carrying both shapes on one record would invite a cell
 * to read a field its own mode never populates.
 */
export type CalendarDay = CalendarPerformanceDay | CalendarGapDay;

export interface CalendarMonthTotals {
  /** Distinct local dates that actually carry eligible activity. */
  readonly populatedDayCount: number;
  /** Population count for the whole month in this mode (paired count in `gap`). */
  readonly eligibleTradeCount: number;
  /** Mode's headline month total: Actual R, System R, or Gap R. */
  readonly totalR: string;
  /**
   * Days grouped by the SIGN of their own classification, deliberately named
   * for the sign rather than for a verdict. In `actual`/`system` the words
   * are winning/break-even/losing; in `gap` they are
   * outperformed/matched/underperformed. A field called `winningDays` would
   * be a false claim in Gap mode, so each day carries its own
   * `classification` and this only counts them.
   */
  readonly classifiedDayCounts: {
    readonly positive: number;
    readonly neutral: number;
    readonly negative: number;
  };
}

/**
 * Availability is explicit, and `empty` is not `error`.
 *
 * A month with nothing eligible in it is an ordinary, truthful answer; a
 * stored R that will not parse is a defect the reader must not be told is
 * "no Trades yet". A service failure must never arrive here as an empty
 * Calendar.
 */
export type CalendarMonthModel =
  | {
      readonly status: 'available';
      readonly mode: CalendarMode;
      readonly year: number;
      readonly month: number;
      readonly timezone: string;
      readonly days: readonly CalendarDay[];
      readonly totals: CalendarMonthTotals;
    }
  | {
      readonly status: 'empty';
      readonly reason: 'no_eligible_trades';
      readonly mode: CalendarMode;
      readonly year: number;
      readonly month: number;
      readonly timezone: string;
    }
  | {
      readonly status: 'error';
      readonly reason: 'data_integrity_error';
      readonly mode: CalendarMode;
      readonly year: number;
      readonly month: number;
      readonly timezone: string;
    };

/** Population A row, already bounded and scoped by the DAL. */
export interface CalendarActualRecord {
  readonly tradeId: string;
  /** Actual `exited_at`, ISO-8601 UTC — this mode's only date axis. */
  readonly exitedAt: string;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
}

/** Population B row. */
export interface CalendarSystemRecord {
  readonly tradeId: string;
  /** `system_exited_at`, ISO-8601 UTC — this mode's only date axis. */
  readonly systemExitedAt: string;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
}

/** Population C row: both sides complete on the SAME Trade. */
export interface CalendarPairedRecord {
  readonly tradeId: string;
  /** Actual `exited_at` — the paired anchor. */
  readonly exitedAt: string;
  /** Metadata only; never a bucket key and never a second range gate. */
  readonly systemExitedAt: string;
  readonly actualR: string;
  readonly systemR: string;
}

export interface CalendarMonthRequest {
  readonly mode: CalendarMode;
  readonly year: number;
  readonly month: number;
  readonly timezone: string;
}

interface OutcomeTally {
  wins: number;
  breakEvens: number;
  losses: number;
}

function tally(): OutcomeTally {
  return { wins: 0, breakEvens: 0, losses: 0 };
}

function countOutcome(into: OutcomeTally, outcome: OutcomeValue): void {
  if (outcome === 'win') into.wins += 1;
  else if (outcome === 'loss') into.losses += 1;
  else into.breakEvens += 1;
}

/**
 * The day's verdict, from `lib/calc`'s one classifier.
 *
 * This was a local `greaterThan(0)` / `lessThan(0)` pair — the same rule
 * `dayWinRate` had its own copy of, and neither copy used the break-even
 * band a Trade's own R is judged by. A cell holding one +0.0300R Trade was
 * tinted as a winning day while the Trade inside it was a break-even Trade.
 * `classifyDayTotalR` is now the only thing that decides, so the Calendar
 * cell and the Day Win % KPI cannot drift apart again.
 */
function classifyTotal(total: InstanceType<typeof CalcDecimal>): CalendarDayClassification {
  return classifyDayTotalR(total);
}

function classifyGap(total: InstanceType<typeof CalcDecimal>): CalendarGapClassification {
  if (total.greaterThan(0)) return 'outperformed';
  if (total.lessThan(0)) return 'underperformed';
  return 'matched';
}

function integrity(request: CalendarMonthRequest): CalendarMonthModel {
  return {
    status: 'error',
    reason: 'data_integrity_error',
    mode: request.mode,
    year: request.year,
    month: request.month,
    timezone: request.timezone,
  };
}

function empty(request: CalendarMonthRequest): CalendarMonthModel {
  return {
    status: 'empty',
    reason: 'no_eligible_trades',
    mode: request.mode,
    year: request.year,
    month: request.month,
    timezone: request.timezone,
  };
}

/**
 * Composes one month of Actual or System performance days.
 *
 * SPARSE BY CONSTRUCTION. Only dates that carry an eligible Trade appear. A
 * day with nothing eligible is NOT a `0.0000R` day — a flat day and a day
 * with no finalized result are different facts, and manufacturing a zero row
 * for every empty square would make the Calendar assert the wrong one 300
 * times a year. Presentation builds the blank cells from the month grid.
 *
 * Open and planned Trades never reach this composer: the DAL's population
 * filter already excludes them, which is what stops an unresolved outcome
 * being silently counted as a flat day.
 */
export function composeCalendarPerformanceMonth(
  request: CalendarMonthRequest & { readonly mode: 'actual' | 'system' },
  records: readonly (CalendarActualRecord | CalendarSystemRecord)[],
): CalendarMonthModel {
  if (records.length === 0) return empty(request);

  const byDate = new Map<CalendarDate, { values: string[]; outcomes: OutcomeTally }>();
  for (const record of records) {
    const instantSource =
      'exitedAt' in record ? record.exitedAt : (record as CalendarSystemRecord).systemExitedAt;
    const value = 'actualR' in record ? record.actualR : (record as CalendarSystemRecord).systemR;
    const outcome =
      'traderOutcome' in record
        ? record.traderOutcome
        : (record as CalendarSystemRecord).systemOutcome;

    const instant = new Date(instantSource);
    if (Number.isNaN(instant.getTime())) return integrity(request);
    if (parseCalcDecimal(value) === null) return integrity(request);
    const date = calendarDateIn(instant, request.timezone);
    if (!date.ok) return integrity(request);

    const bucket = byDate.get(date.value);
    if (bucket === undefined) {
      const outcomes = tally();
      countOutcome(outcomes, outcome);
      byDate.set(date.value, { values: [value], outcomes });
    } else {
      bucket.values.push(value);
      countOutcome(bucket.outcomes, outcome);
    }
  }

  // `CalendarDate` is `YYYY-MM-DD`, so lexicographic order is chronological.
  const dates = [...byDate.keys()].sort();
  const days: CalendarPerformanceDay[] = [];
  let monthTotal = new CalcDecimal(0);
  let winningDays = 0;
  let breakEvenDays = 0;
  let losingDays = 0;

  for (const date of dates) {
    const bucket = byDate.get(date);
    if (bucket === undefined) return integrity(request);
    let dayTotal = new CalcDecimal(0);
    for (const value of bucket.values) {
      const decimal = parseCalcDecimal(value);
      if (decimal === null) return integrity(request);
      dayTotal = dayTotal.plus(decimal);
    }
    monthTotal = monthTotal.plus(dayTotal);
    const classification = classifyTotal(dayTotal);
    if (classification === 'winning') winningDays += 1;
    else if (classification === 'losing') losingDays += 1;
    else breakEvenDays += 1;

    days.push({
      mode: request.mode,
      date,
      eligibleTradeCount: bucket.values.length,
      totalR: toCanonicalR(dayTotal),
      wins: bucket.outcomes.wins,
      breakEvens: bucket.outcomes.breakEvens,
      losses: bucket.outcomes.losses,
      classification,
    });
  }

  return {
    status: 'available',
    mode: request.mode,
    year: request.year,
    month: request.month,
    timezone: request.timezone,
    days,
    totals: {
      populatedDayCount: days.length,
      eligibleTradeCount: records.length,
      totalR: toCanonicalR(monthTotal),
      classifiedDayCounts: {
        positive: winningDays,
        neutral: breakEvenDays,
        negative: losingDays,
      },
    },
  };
}

/**
 * Composes one month of paired Gap days from Population C.
 *
 * The Gap is D5's frozen `actualR - systemR`, summed per local day from the
 * raw unrounded difference and rounded exactly once — never re-derived by
 * subtracting two already-rounded day totals, and never a second formula.
 * Bucketing is anchored to Actual `exited_at` alone; `systemExitedAt` rides
 * along on the record as context and never chooses a day.
 */
export function composeCalendarGapMonth(
  request: CalendarMonthRequest & { readonly mode: 'gap' },
  records: readonly CalendarPairedRecord[],
): CalendarMonthModel {
  if (records.length === 0) return empty(request);

  const byDate = new Map<
    CalendarDate,
    {
      count: number;
      system: string[];
      actual: string[];
      under: number;
      match: number;
      over: number;
    }
  >();

  for (const record of records) {
    const instant = new Date(record.exitedAt);
    if (Number.isNaN(instant.getTime())) return integrity(request);
    const systemDecimal = parseCalcDecimal(record.systemR);
    const actualDecimal = parseCalcDecimal(record.actualR);
    if (systemDecimal === null || actualDecimal === null) return integrity(request);
    const date = calendarDateIn(instant, request.timezone);
    if (!date.ok) return integrity(request);

    const gap = actualDecimal.minus(systemDecimal);
    const bucket = byDate.get(date.value) ?? {
      count: 0,
      system: [],
      actual: [],
      under: 0,
      match: 0,
      over: 0,
    };
    bucket.count += 1;
    bucket.system.push(record.systemR);
    bucket.actual.push(record.actualR);
    if (gap.lessThan(0)) bucket.under += 1;
    else if (gap.greaterThan(0)) bucket.over += 1;
    else bucket.match += 1;
    byDate.set(date.value, bucket);
  }

  const dates = [...byDate.keys()].sort();
  const days: CalendarGapDay[] = [];
  let monthSystem = new CalcDecimal(0);
  let monthActual = new CalcDecimal(0);
  let outperformedDays = 0;
  let matchedDays = 0;
  let underperformedDays = 0;

  for (const date of dates) {
    const bucket = byDate.get(date);
    if (bucket === undefined) return integrity(request);
    let daySystem = new CalcDecimal(0);
    let dayActual = new CalcDecimal(0);
    for (const value of bucket.system) {
      const decimal = parseCalcDecimal(value);
      if (decimal === null) return integrity(request);
      daySystem = daySystem.plus(decimal);
    }
    for (const value of bucket.actual) {
      const decimal = parseCalcDecimal(value);
      if (decimal === null) return integrity(request);
      dayActual = dayActual.plus(decimal);
    }
    monthSystem = monthSystem.plus(daySystem);
    monthActual = monthActual.plus(dayActual);

    const dayGap = dayActual.minus(daySystem);
    const classification = classifyGap(dayGap);
    if (classification === 'outperformed') outperformedDays += 1;
    else if (classification === 'underperformed') underperformedDays += 1;
    else matchedDays += 1;

    days.push({
      mode: 'gap',
      date,
      pairedTradeCount: bucket.count,
      systemR: toCanonicalR(daySystem),
      actualR: toCanonicalR(dayActual),
      gapR: toCanonicalR(dayGap),
      classification,
      underperformedCount: bucket.under,
      matchedCount: bucket.match,
      outperformedCount: bucket.over,
    });
  }

  return {
    status: 'available',
    mode: 'gap',
    year: request.year,
    month: request.month,
    timezone: request.timezone,
    days,
    totals: {
      populatedDayCount: days.length,
      eligibleTradeCount: records.length,
      totalR: toCanonicalR(monthActual.minus(monthSystem)),
      classifiedDayCounts: {
        positive: outperformedDays,
        neutral: matchedDays,
        negative: underperformedDays,
      },
    },
  };
}
