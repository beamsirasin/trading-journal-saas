import type { CalendarMode, CalendarMonthModel } from '@/lib/dashboard/calendar';
import {
  calendarMonthKey,
  resolveCalendarMonth,
  shiftCalendarMonth,
} from '@/lib/dashboard/calendar-grid';
import {
  buildCalendarHref,
  clearDayNavigation,
  selectDayNavigation,
  selectModeNavigation,
  type CalendarNavigationState,
} from '@/lib/dashboard/calendar-navigation';
import { CALENDAR_MODE_ORDER, calendarMonthDays } from '@/lib/dashboard/calendar-presentation';
import type { DashboardFilterState } from '@/lib/dashboard/filters';
import { composeTradeQuickPreview } from '@/lib/dashboard/trade-preview';
import { getWorkspaceTradeDetail } from '@/server/dal/trades';
import {
  getDashboardCalendarMonthInZone,
  getDashboardDayReviewInMonth,
} from '@/server/services/dashboard-calendar';
import { DayReviewDialog } from '@/components/dashboard/day-review/day-review-dialog';
import { TradeQuickPreviewSheet } from '@/components/dashboard/trade-preview/trade-quick-preview-sheet';

import { DashboardCalendarCard, type DashboardCalendarHrefs } from './dashboard-calendar-card';

const DASHBOARD_PATH = '/app';

export interface DashboardCalendarSectionProps {
  readonly filters: DashboardFilterState;
  readonly navigation: CalendarNavigationState;
  readonly timezone: string;
  /** Today's date in the WORKSPACE's timezone, resolved by the route. */
  readonly todayDate: string;
  readonly dateLocale: string;
}

/**
 * D6B — the Calendar's own server boundary.
 *
 * D6A deliberately kept the Calendar OUT of `DashboardPageData`: folding a
 * month into that bundle would add a read to every Dashboard load, including
 * every filter change, for a surface that is navigational rather than
 * headline — and the month is a dimension the bundle cannot express, since
 * paging to July must refetch the Calendar and nothing else. This component
 * is that separate boundary. It is still server-driven: nothing below it
 * fetches anything, and every widget receives a composed model as props.
 *
 * Reads, in the worst case a reader can reach:
 *
 *   1 — the month, always
 *   1 — the selected day's rows, only when a day is open
 *   1 — the canonical Trade detail, only when a Trade is open
 *
 * The Day Review's headline reuses the month ALREADY IN HAND rather than
 * re-issuing the identical bounded query, so the panel and the square the
 * reader clicked are literally the same `CalendarDay` object rather than two
 * aggregations that happen to agree. Nothing here sums a row.
 */
export async function DashboardCalendarSection({
  filters,
  navigation,
  timezone,
  todayDate,
  dateLocale,
}: DashboardCalendarSectionProps) {
  const { year, month } = resolveCalendarMonth(navigation, todayDate);
  const resolved: CalendarNavigationState = { ...navigation, month: { year, month } };

  const monthResult = await getDashboardCalendarMonthInZone(
    filters,
    { mode: navigation.mode, year, month },
    timezone,
  );

  /*
    A failed month renders the Calendar's own integrity state, not a blank
    space and not a page-level error: the KPI band, the two baselines and the
    Execution Gap section above come from a different read and are still true.
    `error` is deliberately not `empty` — a reader must never be told "no
    Trades this month" when the truth is that something failed.
  */
  const monthModel: CalendarMonthModel = monthResult.ok
    ? monthResult.data
    : {
        status: 'error',
        reason: 'data_integrity_error',
        mode: navigation.mode,
        year,
        month,
        timezone,
      };

  // A selected day carrying nothing in this month's projection is not an
  // error — it is a stale deep link, and the Calendar simply renders without
  // a Day Review rather than asserting a day that does not exist.
  const populatedDates = calendarMonthDays(monthModel).map((day) => day.date);
  const selectedDate =
    resolved.selectedDate !== null && populatedDates.includes(resolved.selectedDate)
      ? resolved.selectedDate
      : null;

  const [dayReview, tradeDetail] = await Promise.all([
    selectedDate === null
      ? Promise.resolve(null)
      : getDashboardDayReviewInMonth(
          filters,
          { mode: navigation.mode, date: selectedDate },
          timezone,
          monthModel,
        ),
    selectedDate === null || resolved.selectedTradeId === null
      ? Promise.resolve(null)
      : getWorkspaceTradeDetail(resolved.selectedTradeId),
  ]);

  const dayState: CalendarNavigationState = { ...resolved, selectedDate, selectedTradeId: null };
  const href = (state: CalendarNavigationState) =>
    buildCalendarHref(DASHBOARD_PATH, filters, state);

  const hrefs: DashboardCalendarHrefs = {
    modes: Object.fromEntries(
      CALENDAR_MODE_ORDER.map((candidate) => [
        candidate,
        href(selectModeNavigation(resolved, candidate)),
      ]),
    ) as Record<CalendarMode, string>,
    previousMonth: href({
      ...clearDayNavigation(resolved),
      month: shiftCalendarMonth(year, month, -1),
    }),
    nextMonth: href({
      ...clearDayNavigation(resolved),
      month: shiftCalendarMonth(year, month, 1),
    }),
    // Omitted entirely when the grid already shows today's month: a "this
    // month" link that goes where the reader already is, is noise.
    currentMonth:
      calendarMonthKey(year, month) === todayDate.slice(0, 7)
        ? null
        : href({ ...clearDayNavigation(resolved), month: null }),
    days: Object.fromEntries(
      populatedDates.map((date) => [date, href(selectDayNavigation(resolved, date))]),
    ),
  };

  const review = dayReview !== null && dayReview.ok ? dayReview.data : null;
  const tradeHrefs =
    review === null || review.status !== 'available'
      ? {}
      : Object.fromEntries(
          review.trades.map((row) => [
            row.tradeId,
            href({ ...dayState, selectedTradeId: row.tradeId }),
          ]),
        );

  return (
    <>
      <DashboardCalendarCard
        month={monthModel}
        mode={navigation.mode}
        year={year}
        monthNumber={month}
        todayDate={todayDate}
        selectedDate={selectedDate}
        dateLocale={dateLocale}
        hrefs={hrefs}
      />
      {review === null ? null : (
        <DayReviewDialog
          review={review}
          dateLabel={formatDayLabel(review.date, dateLocale)}
          closeHref={href(clearDayNavigation(resolved))}
          tradeHrefs={tradeHrefs}
          timezone={timezone}
          dateLocale={dateLocale}
        />
      )}
      {tradeDetail !== null && tradeDetail.ok ? (
        <TradeQuickPreviewSheet
          trade={composeTradeQuickPreview(tradeDetail.trade)}
          closeHref={href(dayState)}
          timezone={timezone}
          dateLocale={dateLocale}
        />
      ) : null}
    </>
  );
}

/** `timeZone: 'UTC'` on a date-only value — see the card's own note. */
function formatDayLabel(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    calendar: 'gregory',
  });
}
