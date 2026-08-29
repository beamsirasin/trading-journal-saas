import { daysInMonth, formatCalendarParts, parseCalendarParts } from '@/lib/time';

import { shiftCalendarMonth } from './calendar-grid';
import type { DashboardDateRangeDraft } from './date-range-draft';

/**
 * How one square relates to the DRAFT range.
 *
 * `single` is a genuine third state, not a rendering shortcut: it covers both
 * a one-day range and the half-finished selection that step 1 of the frozen
 * custom contract produces. Both are one circle with nothing attached to it,
 * and both must be distinguishable from a `start` that has an `end` to reach
 * towards — otherwise the reader cannot tell "I picked a day" from "I picked
 * a day and the picker lost the other end".
 */
export type DateRangeCellState = 'start' | 'end' | 'single' | 'in-range' | null;

export interface DateRangePickerCell {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly state: DateRangeCellState;
  readonly isToday: boolean;
  /**
   * Beyond `maxDate`. Every canonical preset is period-to-DATE and no Trade
   * can be recorded in the future, so a range whose end has not happened yet
   * is offered but never selectable — stated truthfully in the control rather
   * than accepted and then silently returning nothing.
   */
  readonly isDisabled: boolean;
}

export interface DateRangePickerMonth {
  readonly year: number;
  readonly month: number;
  /**
   * Leading `null`s pad the first week; trailing padding is deliberately
   * absent, exactly as `buildCalendarGrid` does it. Two grids side by side
   * that padded their tails would put a greyed-out duplicate of the right
   * month's first week under the left month.
   */
  readonly cells: readonly (DateRangePickerCell | null)[];
}

function cellState(date: string, from: string | null, to: string | null): DateRangeCellState {
  if (from === null) return null;
  if (to === null) return date === from ? 'single' : null;
  if (from === to) return date === from ? 'single' : null;
  if (date === from) return 'start';
  if (date === to) return 'end';
  return date > from && date < to ? 'in-range' : null;
}

/**
 * Builds one month of the range picker.
 *
 * Sunday-first, matching the Dashboard Calendar widget's own grid and reusing
 * its `CALENDAR_WEEKDAY_KEYS` labels — two seven-column grids on one page
 * that disagreed about which column is Sunday would be a defect, and the
 * widget's grid is frozen. This is unrelated to the `week` PRESET, which is
 * Monday-anchored by the date contract and is resolved server-side by
 * `resolveAnalyticsDateBounds`, never by this grid.
 *
 * The weekday is derived from the calendar date itself through UTC
 * arithmetic. No timezone participates: which column `2026-03-05` sits in is
 * a property of the date, not of an instant.
 */
export function buildDateRangePickerMonth(input: {
  readonly year: number;
  readonly month: number;
  readonly draft: Pick<DashboardDateRangeDraft, 'datePreset' | 'from' | 'to'>;
  /** The reader's local today, resolved server-side in the analytics timezone. */
  readonly todayDate: string | null;
  /** Inclusive last selectable date, or `null` for no ceiling. */
  readonly maxDate: string | null;
}): DateRangePickerMonth {
  // A preset draft paints nothing. The frozen contract says a preset REPLACES
  // the custom bounds, so showing yesterday's custom highlights under a
  // freshly picked "Last 30 days" would assert a selection that no longer
  // exists.
  const isCustom = input.draft.datePreset === 'custom';
  const from = isCustom ? input.draft.from : null;
  const to = isCustom ? input.draft.to : null;

  const total = daysInMonth(input.year, input.month);
  const leadingBlanks = new Date(Date.UTC(input.year, input.month - 1, 1)).getUTCDay();
  const cells: (DateRangePickerCell | null)[] = Array.from({ length: leadingBlanks }, () => null);

  for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth += 1) {
    const date = formatCalendarParts(input.year, input.month, dayOfMonth);
    cells.push({
      date,
      dayOfMonth,
      state: cellState(date, from, to),
      isToday: date === input.todayDate,
      isDisabled: input.maxDate !== null && date > input.maxDate,
    });
  }

  return { year: input.year, month: input.month, cells };
}

export interface DateRangePickerMonthPair {
  readonly left: { readonly year: number; readonly month: number };
  readonly right: { readonly year: number; readonly month: number };
}

/**
 * Which month pair the picker opens on.
 *
 * The RIGHT month is the one holding the end of whatever is currently
 * selected, and the left is the month before it. Every canonical preset ends
 * at the reader's local today, so this opens on "the recent past" for a
 * preset draft and on "the end of my range, in context" for a custom one —
 * in both cases the pair a reader most likely wants to adjust, reachable
 * without paging.
 *
 * A custom range spanning more than two months cannot be fully visible at
 * once; the reader pages to the start. Anchoring on the END rather than the
 * start is deliberate: the end is the edge people move.
 */
export function resolveDateRangePickerMonths(
  draft: Pick<DashboardDateRangeDraft, 'datePreset' | 'from' | 'to'>,
  todayDate: string,
): DateRangePickerMonthPair {
  const isCustom = draft.datePreset === 'custom';
  const anchor = (isCustom ? (draft.to ?? draft.from) : null) ?? todayDate;
  const parts = parseCalendarParts(anchor);
  const right = parts.ok
    ? { year: parts.value.year, month: parts.value.month }
    : monthOfOrEpoch(todayDate);
  return { left: shiftCalendarMonth(right.year, right.month, -1), right };
}

function monthOfOrEpoch(date: string): { readonly year: number; readonly month: number } {
  const parts = parseCalendarParts(date);
  return parts.ok ? { year: parts.value.year, month: parts.value.month } : { year: 1970, month: 1 };
}
