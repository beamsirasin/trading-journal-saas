import { CalcDecimal, parseCalcDecimal, toCanonicalR } from '@/lib/calc/decimal';
import type { CalendarDate } from '@/lib/time';

import type { CalendarDay, CalendarGapDay, CalendarMode, CalendarPerformanceDay } from './calendar';
import {
  composeRecentTrade,
  type DashboardRecentTrade,
  type DashboardRecentTradeRecord,
} from './page-data';

/**
 * ONE DAY, IN THE MODE THE READER WAS LOOKING AT.
 *
 * The mode is carried explicitly rather than inferred, because the selected
 * day means a different thing in each: in `actual` it is the day the Trader's
 * execution finished, in `system` the day the System's own exit resolved, and
 * in `gap` the Actual-anchored day of the paired population. Substituting one
 * axis for another would answer a question the reader did not ask, so the
 * axis travels with the request and is stated back in the response.
 */
export interface DayReviewTradeRow extends DashboardRecentTrade {
  /**
   * The timestamp on THIS mode's own axis — Actual `exited_at` for `actual`
   * and `gap`, `system_exited_at` for `system`. Named for its job rather
   * than for a column so a row can never be sorted by the wrong one.
   */
  readonly axisAt: string;
}

/** The mode-specific headline above the rows. */
export type DayReviewHeadline =
  | {
      readonly mode: 'actual' | 'system';
      readonly totalR: string;
      readonly eligibleTradeCount: number;
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
      readonly classification: CalendarPerformanceDay['classification'];
    }
  | {
      readonly mode: 'gap';
      readonly pairedTradeCount: number;
      readonly systemR: string;
      readonly actualR: string;
      readonly gapR: string;
      readonly classification: CalendarGapDay['classification'];
      readonly underperformedCount: number;
      readonly matchedCount: number;
      readonly outperformedCount: number;
    };

export type DayReviewData =
  | {
      readonly status: 'available';
      readonly mode: CalendarMode;
      readonly date: CalendarDate;
      readonly timezone: string;
      readonly headline: DayReviewHeadline;
      readonly trades: readonly DayReviewTradeRow[];
    }
  | {
      readonly status: 'empty';
      readonly reason: 'no_eligible_trades';
      readonly mode: CalendarMode;
      readonly date: CalendarDate;
      readonly timezone: string;
    }
  | {
      readonly status: 'error';
      readonly reason: 'data_integrity_error';
      readonly mode: CalendarMode;
      readonly date: CalendarDate;
      readonly timezone: string;
    };

/** One Day Review row's source, already scoped and day-bounded by the DAL. */
export interface DayReviewRecord extends DashboardRecentTradeRecord {
  /** This mode's axis instant for the row — never re-derived here. */
  readonly axisAt: string;
}

export interface DayReviewRequest {
  readonly mode: CalendarMode;
  readonly date: CalendarDate;
  readonly timezone: string;
}

/**
 * Composes the Day Review from the day's own records and the Calendar day
 * that was clicked.
 *
 * THE HEADLINE IS THE CALENDAR CELL'S OWN NUMBERS, not a re-summation of the
 * rows. Passing the already-composed `CalendarDay` through is what guarantees
 * the panel cannot disagree with the square the reader clicked — the failure
 * mode where a cell says `+2.40R` and the day it opens says `+2.4000R` from a
 * second, subtly different aggregation.
 *
 * Row-level values are the canonical per-Trade figures, and the Execution Gap
 * state on each row is produced by the SAME `composeRecentTrade` the Dashboard
 * already uses — not a second gap path. One position is one row: the composer
 * receives Trade-level records and never sees an exit leg, so a partially
 * closed position contributes exactly one row however many times it was
 * scaled out of.
 */
export function composeDayReview(
  request: DayReviewRequest,
  day: CalendarDay | null,
  records: readonly DayReviewRecord[],
): DayReviewData {
  if (day === null || records.length === 0) {
    return {
      status: 'empty',
      reason: 'no_eligible_trades',
      mode: request.mode,
      date: request.date,
      timezone: request.timezone,
    };
  }
  if (day.date !== request.date || day.mode !== request.mode) {
    // The Calendar day and the requested day must be the same day in the same
    // mode. Anything else is a caller bug that would render one day's totals
    // above another day's rows.
    return {
      status: 'error',
      reason: 'data_integrity_error',
      mode: request.mode,
      date: request.date,
      timezone: request.timezone,
    };
  }

  const trades: DayReviewTradeRow[] = [];
  for (const record of records) {
    if (Number.isNaN(new Date(record.axisAt).getTime())) {
      return {
        status: 'error',
        reason: 'data_integrity_error',
        mode: request.mode,
        date: request.date,
        timezone: request.timezone,
      };
    }
    trades.push({ ...composeRecentTrade(record), axisAt: record.axisAt });
  }

  // Ascending on THIS mode's axis, then Trade ID — the same deterministic
  // ordering rule D5A froze for the paired series, so two Trades that closed
  // on the same instant never swap places between renders.
  trades.sort((left, right) => {
    const byInstant = new Date(left.axisAt).getTime() - new Date(right.axisAt).getTime();
    if (byInstant !== 0) return byInstant;
    return left.tradeId < right.tradeId ? -1 : left.tradeId > right.tradeId ? 1 : 0;
  });

  const headline: DayReviewHeadline =
    day.mode === 'gap'
      ? {
          mode: 'gap',
          pairedTradeCount: day.pairedTradeCount,
          systemR: day.systemR,
          actualR: day.actualR,
          gapR: day.gapR,
          classification: day.classification,
          underperformedCount: day.underperformedCount,
          matchedCount: day.matchedCount,
          outperformedCount: day.outperformedCount,
        }
      : {
          mode: day.mode,
          totalR: day.totalR,
          eligibleTradeCount: day.eligibleTradeCount,
          wins: day.wins,
          breakEvens: day.breakEvens,
          losses: day.losses,
          classification: day.classification,
        };

  return {
    status: 'available',
    mode: request.mode,
    date: request.date,
    timezone: request.timezone,
    headline,
    trades,
  };
}

/**
 * Whether the rows a Day Review returned actually add up to the headline it
 * shows.
 *
 * Exported for tests rather than run in production: the two come from one
 * bounded read of one population, so a mismatch is a defect to catch in CI,
 * not a condition to branch on at render time. `null` when the rows cannot
 * be summed at all.
 */
export function reconcileDayReview(review: DayReviewData): boolean | null {
  if (review.status !== 'available') return null;
  const { headline, trades } = review;

  if (headline.mode === 'gap') {
    if (trades.length !== headline.pairedTradeCount) return false;
    let system = new CalcDecimal(0);
    let actual = new CalcDecimal(0);
    for (const row of trades) {
      const systemDecimal = parseCalcDecimal(row.systemR ?? '');
      const actualDecimal = parseCalcDecimal(row.actualR ?? '');
      if (systemDecimal === null || actualDecimal === null) return null;
      system = system.plus(systemDecimal);
      actual = actual.plus(actualDecimal);
    }
    return (
      toCanonicalR(system) === headline.systemR &&
      toCanonicalR(actual) === headline.actualR &&
      toCanonicalR(actual.minus(system)) === headline.gapR
    );
  }

  if (trades.length !== headline.eligibleTradeCount) return false;
  let total = new CalcDecimal(0);
  for (const row of trades) {
    const value = headline.mode === 'actual' ? row.actualR : row.systemR;
    const decimal = parseCalcDecimal(value ?? '');
    if (decimal === null) return null;
    total = total.plus(decimal);
  }
  return toCanonicalR(total) === headline.totalR;
}
