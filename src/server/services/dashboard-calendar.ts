import 'server-only';

import {
  composeCalendarGapMonth,
  composeCalendarPerformanceMonth,
  type CalendarMode,
  type CalendarMonthModel,
} from '@/lib/dashboard/calendar';
import { composeDayReview, type DayReviewData } from '@/lib/dashboard/day-review';
import { dashboardAnalyticsInput, type DashboardFilterState } from '@/lib/dashboard/filters';
import { dayRangeIn, monthRangeIn, type CalendarDate } from '@/lib/time';
import { getCurrentUserPreferences } from '@/server/auth/dal';
import {
  getCalendarMonthRecords,
  getDayReviewRecords,
  type AnalyticsFilterErrorCode,
  type AnalyticsReadOptions,
} from '@/server/dal/analytics';

export type DashboardCalendarResult =
  | { readonly ok: true; readonly data: CalendarMonthModel }
  | { readonly ok: false; readonly code: AnalyticsFilterErrorCode | 'invalid_month' };

export type DashboardDayReviewResult =
  | { readonly ok: true; readonly data: DayReviewData }
  | {
      readonly ok: false;
      readonly code: AnalyticsFilterErrorCode | 'invalid_day' | 'invalid_month';
    };

export interface DashboardCalendarRequest {
  readonly mode: CalendarMode;
  readonly year: number;
  readonly month: number;
}

/**
 * THE CALENDAR IS ITS OWN DATA BOUNDARY, NOT PART OF `DashboardPageData`.
 *
 * D2 deliberately made the Dashboard one narrow bundle of five reads, and
 * that number has survived D3, D4, D4.5 and D5 unchanged. Folding a Calendar
 * month into it would add a sixth read to EVERY Dashboard load — including
 * the loads where nobody scrolls to the Calendar, and including every filter
 * change, which re-runs the whole bundle. The month is also a dimension the
 * Dashboard bundle does not have: paging to July must refetch the Calendar
 * and nothing else, which a single fused payload cannot express.
 *
 * So the Calendar is a separate server-driven read, invoked from its own
 * route/segment boundary. It is still SERVER-driven: the widget performs no
 * client-side analytics fetching of its own, exactly as D2 requires — it
 * receives a composed model as props, like every other Dashboard widget.
 *
 * The cost of that choice is one extra round trip when the Calendar is
 * actually shown; the cost of the alternative is a permanently wider critical
 * path for a surface that is navigational rather than headline.
 */
export async function getDashboardCalendarMonth(
  filters: DashboardFilterState,
  request: DashboardCalendarRequest,
  options: AnalyticsReadOptions = {},
): Promise<DashboardCalendarResult> {
  if (
    !Number.isInteger(request.year) ||
    !Number.isInteger(request.month) ||
    request.month < 1 ||
    request.month > 12
  ) {
    return { ok: false, code: 'invalid_month' };
  }

  // The month boundary must be computed in the USER's zone, so the zone has
  // to be known before the window exists. It is read from the same persisted
  // preference `resolveAnalyticsQueryContext` resolves internally — one
  // source, so a Calendar month can never be cut on a different boundary from
  // the analytics it sits beside.
  const { timezone } = await getCurrentUserPreferences();
  return getDashboardCalendarMonthInZone(filters, request, timezone, options);
}

/**
 * Composes the month once the analytics timezone is known.
 *
 * Split out so a caller that has ALREADY resolved the workspace timezone (a
 * route segment that also renders the Dashboard, say) can pass it in and skip
 * the probe entirely — one read instead of two.
 */
export async function getDashboardCalendarMonthInZone(
  filters: DashboardFilterState,
  request: DashboardCalendarRequest,
  timezone: string,
  options: AnalyticsReadOptions = {},
): Promise<DashboardCalendarResult> {
  const monthRange = monthRangeIn(request.year, request.month, timezone);
  if (!monthRange.ok) return { ok: false, code: 'invalid_month' };

  const records = await getCalendarMonthRecords(
    dashboardAnalyticsInput(filters),
    { mode: request.mode, monthRange: monthRange.value },
    options,
  );
  if (!records.ok) return records;

  const base = { year: request.year, month: request.month, timezone } as const;
  const data =
    request.mode === 'gap'
      ? composeCalendarGapMonth({ ...base, mode: 'gap' }, records.data.paired)
      : composeCalendarPerformanceMonth(
          { ...base, mode: request.mode },
          request.mode === 'actual' ? records.data.actual : records.data.system,
        );
  return { ok: true, data };
}

export interface DashboardDayReviewRequest {
  readonly mode: CalendarMode;
  readonly date: CalendarDate;
}

/**
 * One selected day, in the mode the Calendar was showing.
 *
 * The day's headline comes from re-composing that day out of the SAME month
 * projection the Calendar used, rather than from summing the rows: the panel
 * and the square the reader clicked must agree by construction, not by two
 * aggregations happening to match. That costs one extra bounded read of the
 * month, which is the honest price of the guarantee.
 */
export async function getDashboardDayReview(
  filters: DashboardFilterState,
  request: DashboardDayReviewRequest,
  timezone: string,
  options: AnalyticsReadOptions = {},
): Promise<DashboardDayReviewResult> {
  const monthResult = await getDashboardCalendarMonthInZone(
    filters,
    {
      mode: request.mode,
      year: Number(request.date.slice(0, 4)),
      month: Number(request.date.slice(5, 7)),
    },
    timezone,
    options,
  );
  if (!monthResult.ok) return monthResult;

  return getDashboardDayReviewInMonth(filters, request, timezone, monthResult.data, options);
}

/**
 * The same Day Review, for a caller that ALREADY HOLDS the month.
 *
 * D6A's Day Review costs two reads — the day's rows, plus the month
 * projection its headline comes from — so that the panel and the square the
 * reader clicked agree by construction rather than by two aggregations
 * happening to match. On the Dashboard route the Calendar grid has already
 * fetched exactly that month projection, and re-issuing it would run the
 * identical bounded query twice inside one render.
 *
 * Passing it in costs one read instead of two and makes the guarantee
 * STRONGER, not weaker: the headline stops being an equal aggregation over
 * the same rows and becomes literally the same `CalendarDay` object the cell
 * rendered. D6A's actual prohibition — never re-sum the rows in the
 * presentation layer to save the read — is untouched: nothing here sums
 * anything, and `getDashboardDayReview` above still owns the standalone
 * two-read path for any caller with no month in hand.
 */
export async function getDashboardDayReviewInMonth(
  filters: DashboardFilterState,
  request: DashboardDayReviewRequest,
  timezone: string,
  month: CalendarMonthModel,
  options: AnalyticsReadOptions = {},
): Promise<DashboardDayReviewResult> {
  const dayRange = dayRangeIn(request.date, timezone);
  if (!dayRange.ok) return { ok: false, code: 'invalid_day' };

  // The month in hand must be the month CONTAINING the requested day, in the
  // requested mode. Anything else would render one month's headline above
  // another day's rows — the exact silent substitution the headline
  // pass-through exists to prevent.
  if (
    month.mode !== request.mode ||
    month.year !== Number(request.date.slice(0, 4)) ||
    month.month !== Number(request.date.slice(5, 7))
  ) {
    return { ok: false, code: 'invalid_month' };
  }

  // A month that failed integrity cannot produce a trustworthy day headline.
  if (month.status === 'error') {
    return {
      ok: true,
      data: {
        status: 'error',
        reason: 'data_integrity_error',
        mode: request.mode,
        date: request.date,
        timezone,
      },
    };
  }

  const rows = await getDayReviewRecords(
    dashboardAnalyticsInput(filters),
    { mode: request.mode, dayRange: dayRange.value },
    options,
  );
  if (!rows.ok) return rows;

  const day =
    month.status === 'available'
      ? (month.days.find((candidate) => candidate.date === request.date) ?? null)
      : null;

  return {
    ok: true,
    data: composeDayReview({ mode: request.mode, date: request.date, timezone }, day, rows.data),
  };
}
