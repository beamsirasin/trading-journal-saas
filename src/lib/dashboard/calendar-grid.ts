import { daysInMonth, formatCalendarParts, type CalendarDate } from '@/lib/time';

import type { CalendarDay } from './calendar';
import type { CalendarNavigationState } from './calendar-navigation';

/**
 * THE MONTH GRID IS PRESENTATION, NOT DATA.
 *
 * D6A composes SPARSE days on purpose: a date only appears when it carries an
 * eligible Trade, because "no eligible Trades" and "an eligible day that
 * totalled 0R" are different facts and manufacturing a zero row for every
 * blank square would assert the wrong one ~300 times a year. The seven-column
 * grid a reader actually sees still needs every date of the month plus the
 * leading blanks, so it is built HERE, from the calendar month alone, and the
 * sparse days are matched onto it.
 *
 * The distinction survives into the cell: `day === null` is "nothing eligible
 * on this date", and it is a different cell from one whose `day.totalR` is
 * `'0.0000'`.
 */
export interface CalendarGridCell {
  readonly date: CalendarDate;
  readonly dayOfMonth: number;
  /** `null` means NO ELIGIBLE TRADES — never a 0R performance day. */
  readonly day: CalendarDay | null;
  readonly isToday: boolean;
  readonly isSelected: boolean;
}

export interface CalendarGrid {
  readonly year: number;
  readonly month: number;
  /**
   * Leading `null`s pad the first week, then one cell per date of the month.
   * Trailing padding is deliberately absent: an incomplete final row costs
   * nothing visually and inventing cells past the month's end would put dates
   * on screen that belong to a month the reader did not ask for.
   */
  readonly cells: readonly (CalendarGridCell | null)[];
}

/** `YYYY-MM` for a month param, zero-padded. */
export function calendarMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Moves one month, carrying the year correctly across December/January. */
export function shiftCalendarMonth(
  year: number,
  month: number,
  delta: number,
): { readonly year: number; readonly month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

/**
 * Which month the Calendar should show.
 *
 * Precedence is explicit rather than incidental:
 *
 *   1. an explicit `month` in the URL
 *   2. otherwise the month CONTAINING the selected day
 *   3. otherwise the month containing today, in the workspace's own timezone
 *
 * Step 2 matters more than it looks. `parseCalendarNavigation` only rejects a
 * `day` outside an explicitly requested `month`; a deep link carrying `day`
 * alone is legitimate. Resolving to today's month there would render a grid
 * that does not contain the very day whose review is open — and would make
 * the Day Review's headline unfindable in the month projection behind it.
 *
 * `todayDate` is always a date the SERVER resolved in the workspace timezone.
 * Nothing here calls `new Date()`: a browser-local "today" would highlight the
 * wrong square for a trader whose configured zone is not their device's.
 */
export function resolveCalendarMonth(
  navigation: Pick<CalendarNavigationState, 'month' | 'selectedDate'>,
  todayDate: string,
): { readonly year: number; readonly month: number } {
  if (navigation.month !== null) return navigation.month;
  const anchor = navigation.selectedDate ?? todayDate;
  return { year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)) };
}

/**
 * Builds the seven-column grid for one month and matches the sparse days onto
 * it.
 *
 * The grid is Sunday-first and is derived from UTC arithmetic on the calendar
 * date itself, exactly as the Journal calendar does (Phase 14D): a date's
 * weekday is a property of the date, not of an instant, so no timezone is
 * involved in placing `2026-03-05` in a column. Only the BUCKETING of Trades
 * onto dates is timezone-sensitive, and D6A already did that server-side.
 */
export function buildCalendarGrid(input: {
  readonly year: number;
  readonly month: number;
  readonly days: readonly CalendarDay[];
  readonly todayDate: string | null;
  readonly selectedDate: string | null;
}): CalendarGrid {
  const byDate = new Map(input.days.map((day) => [day.date, day]));
  const total = daysInMonth(input.year, input.month);
  const leadingBlanks = new Date(Date.UTC(input.year, input.month - 1, 1)).getUTCDay();

  const cells: (CalendarGridCell | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth += 1) {
    const date = formatCalendarParts(input.year, input.month, dayOfMonth);
    cells.push({
      date,
      dayOfMonth,
      day: byDate.get(date) ?? null,
      isToday: date === input.todayDate,
      isSelected: date === input.selectedDate,
    });
  }

  return { year: input.year, month: input.month, cells };
}

/** Sunday-first weekday keys, matching the grid's own column order. */
export const CALENDAR_WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type CalendarWeekdayKey = (typeof CALENDAR_WEEKDAY_KEYS)[number];
