import { describe, expect, it } from 'vitest';

import type { CalendarDay } from './calendar';
import {
  buildCalendarGrid,
  calendarMonthKey,
  resolveCalendarMonth,
  shiftCalendarMonth,
} from './calendar-grid';

const day = (date: string, totalR: string): CalendarDay => ({
  mode: 'actual',
  date,
  eligibleTradeCount: 1,
  totalR,
  wins: totalR.startsWith('-') ? 0 : 1,
  breakEvens: 0,
  losses: totalR.startsWith('-') ? 1 : 0,
  classification: totalR.startsWith('-') ? 'losing' : 'winning',
});

describe('calendar month grid', () => {
  it('pads both ends to whole weeks and emits one cell per date of the month', () => {
    // 1 March 2026 is a Sunday, so there are no leading blanks. 31 dates then
    // run four cells into a fifth week, which four trailing blanks complete.
    const march = buildCalendarGrid({
      year: 2026,
      month: 3,
      days: [],
      todayDate: null,
      selectedDate: null,
    });
    expect(march.cells).toHaveLength(35);
    expect(march.cells[0]).toMatchObject({ date: '2026-03-01', dayOfMonth: 1 });
    expect(march.cells.slice(31)).toEqual([null, null, null, null]);

    // 1 April 2026 is a Wednesday: three leading blanks in a Sunday-first grid.
    const april = buildCalendarGrid({
      year: 2026,
      month: 4,
      days: [],
      todayDate: null,
      selectedDate: null,
    });
    expect(april.cells.slice(0, 3)).toEqual([null, null, null]);
    expect(april.cells[3]).toMatchObject({ date: '2026-04-01' });
    expect(april.cells).toHaveLength(35);
    expect(april.cells.slice(33)).toEqual([null, null]);
  });

  it('adds no trailing pad to a month that already ends on a Saturday', () => {
    // 1 February 2026 is a Sunday and February 2026 has 28 days: exactly four
    // whole weeks, so neither end needs padding.
    const february = buildCalendarGrid({
      year: 2026,
      month: 2,
      days: [],
      todayDate: null,
      selectedDate: null,
    });
    expect(february.cells).toHaveLength(28);
    expect(february.cells.every((cell) => cell !== null)).toBe(true);
  });

  it('emits only whole weeks', () => {
    for (let month = 1; month <= 12; month += 1) {
      const grid = buildCalendarGrid({
        year: 2026,
        month,
        days: [],
        todayDate: null,
        selectedDate: null,
      });
      expect(grid.cells.length % 7).toBe(0);
    }
  });

  it('handles a leap February without inventing a 30th', () => {
    const grid = buildCalendarGrid({
      year: 2028,
      month: 2,
      days: [],
      todayDate: null,
      selectedDate: null,
    });
    const dates = grid.cells.filter((cell) => cell !== null).map((cell) => cell.date);
    expect(dates).toHaveLength(29);
    expect(dates.at(-1)).toBe('2028-02-29');
  });

  /**
   * §9 — the distinction D6A's sparse days exist to preserve. A date with
   * nothing eligible must not arrive at the cell as a 0R performance day.
   */
  it('leaves a date with no eligible Trades as null, not as a zero day', () => {
    const grid = buildCalendarGrid({
      year: 2026,
      month: 3,
      days: [day('2026-03-05', '0.0000')],
      todayDate: null,
      selectedDate: null,
    });
    const fifth = grid.cells.find((cell) => cell?.date === '2026-03-05');
    const sixth = grid.cells.find((cell) => cell?.date === '2026-03-06');
    expect(fifth?.day).toMatchObject({ totalR: '0.0000' });
    expect(sixth?.day).toBeNull();
  });

  it('marks today and the selected day independently', () => {
    const grid = buildCalendarGrid({
      year: 2026,
      month: 3,
      days: [day('2026-03-05', '1.0000')],
      todayDate: '2026-03-11',
      selectedDate: '2026-03-05',
    });
    expect(grid.cells.find((cell) => cell?.date === '2026-03-05')).toMatchObject({
      isSelected: true,
      isToday: false,
    });
    expect(grid.cells.find((cell) => cell?.date === '2026-03-11')).toMatchObject({
      isSelected: false,
      isToday: true,
    });
  });
});

describe('month resolution', () => {
  it('prefers an explicit month in the URL', () => {
    expect(
      resolveCalendarMonth({ month: { year: 2025, month: 11 }, selectedDate: null }, '2026-03-11'),
    ).toEqual({ year: 2025, month: 11 });
  });

  /**
   * A deep link may legitimately carry `day` with no `month`. Falling back to
   * today's month there would render a grid that does not contain the very
   * day whose review is open — and would leave the Day Review's headline
   * unfindable in the month projection behind it.
   */
  it('falls back to the month containing the selected day, not to today', () => {
    expect(resolveCalendarMonth({ month: null, selectedDate: '2025-11-04' }, '2026-03-11')).toEqual(
      {
        year: 2025,
        month: 11,
      },
    );
  });

  it('falls back to the workspace-local today when nothing is requested', () => {
    expect(resolveCalendarMonth({ month: null, selectedDate: null }, '2026-03-11')).toEqual({
      year: 2026,
      month: 3,
    });
  });
});

describe('month arithmetic', () => {
  it('carries the year across December and January', () => {
    expect(shiftCalendarMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftCalendarMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('zero-pads the month key', () => {
    expect(calendarMonthKey(2026, 3)).toBe('2026-03');
    expect(calendarMonthKey(2026, 12)).toBe('2026-12');
  });
});
