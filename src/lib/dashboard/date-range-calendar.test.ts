import { describe, expect, it } from 'vitest';

import { buildDateRangePickerMonth, resolveDateRangePickerMonths } from './date-range-calendar';
import type { DashboardDateRangeDraft } from './date-range-draft';

const custom = (from: string | null, to: string | null): DashboardDateRangeDraft => ({
  datePreset: 'custom',
  from,
  to,
});

function stateOf(month: ReturnType<typeof buildDateRangePickerMonth>, date: string) {
  const cell = month.cells.find((candidate) => candidate?.date === date);
  if (cell === undefined || cell === null) throw new Error(`no cell for ${date}`);
  return cell.state;
}

describe('buildDateRangePickerMonth', () => {
  it('pads the first week and stops at the last real date of the month', () => {
    // 2026-02-01 is a Sunday, so there are no leading blanks and February has
    // 28 days in 2026 — a month whose grid ends exactly on a week boundary.
    const february = buildDateRangePickerMonth({
      year: 2026,
      month: 2,
      draft: custom(null, null),
      todayDate: null,
      maxDate: null,
    });
    expect(february.cells).toHaveLength(28);
    expect(february.cells[0]).toMatchObject({ date: '2026-02-01', dayOfMonth: 1 });

    // 2026-07-01 is a Wednesday: three leading blanks, then 31 dates.
    const july = buildDateRangePickerMonth({
      year: 2026,
      month: 7,
      draft: custom(null, null),
      todayDate: null,
      maxDate: null,
    });
    expect(july.cells.slice(0, 3)).toEqual([null, null, null]);
    expect(july.cells).toHaveLength(34);
    expect(july.cells.at(-1)).toMatchObject({ date: '2026-07-31' });
  });

  it('marks start, in-range and end across a complete custom range', () => {
    const month = buildDateRangePickerMonth({
      year: 2026,
      month: 7,
      draft: custom('2026-07-10', '2026-07-13'),
      todayDate: null,
      maxDate: null,
    });
    expect(stateOf(month, '2026-07-09')).toBeNull();
    expect(stateOf(month, '2026-07-10')).toBe('start');
    expect(stateOf(month, '2026-07-11')).toBe('in-range');
    expect(stateOf(month, '2026-07-12')).toBe('in-range');
    expect(stateOf(month, '2026-07-13')).toBe('end');
    expect(stateOf(month, '2026-07-14')).toBeNull();
  });

  it('paints the in-between days of a range that crosses a month boundary', () => {
    const august = buildDateRangePickerMonth({
      year: 2026,
      month: 8,
      draft: custom('2026-07-28', '2026-09-02'),
      todayDate: null,
      maxDate: null,
    });
    // Neither endpoint is in August, but every August date is inside the range.
    expect(stateOf(august, '2026-08-01')).toBe('in-range');
    expect(stateOf(august, '2026-08-31')).toBe('in-range');
    expect(august.cells.filter((cell) => cell?.state === 'start')).toHaveLength(0);
    expect(august.cells.filter((cell) => cell?.state === 'end')).toHaveLength(0);
  });

  it('renders a half-finished selection and a one-day range as the same single endpoint', () => {
    const pending = buildDateRangePickerMonth({
      year: 2026,
      month: 7,
      draft: custom('2026-07-10', null),
      todayDate: null,
      maxDate: null,
    });
    expect(stateOf(pending, '2026-07-10')).toBe('single');
    expect(pending.cells.filter((cell) => cell?.state === 'in-range')).toHaveLength(0);

    const oneDay = buildDateRangePickerMonth({
      year: 2026,
      month: 7,
      draft: custom('2026-07-10', '2026-07-10'),
      todayDate: null,
      maxDate: null,
    });
    expect(stateOf(oneDay, '2026-07-10')).toBe('single');
  });

  it('paints nothing for a preset draft, even when stale custom bounds linger', () => {
    const month = buildDateRangePickerMonth({
      year: 2026,
      month: 7,
      // `selectDashboardDatePreset` clears the bounds, so this shape cannot be
      // produced by the reducers — the grid still refuses to assert a
      // selection the preset has replaced.
      draft: { datePreset: '30d', from: '2026-07-10', to: '2026-07-13' },
      todayDate: null,
      maxDate: null,
    });
    expect(month.cells.every((cell) => cell === null || cell.state === null)).toBe(true);
  });

  it('marks today and disables only dates after the ceiling', () => {
    const month = buildDateRangePickerMonth({
      year: 2026,
      month: 8,
      draft: custom(null, null),
      todayDate: '2026-08-29',
      maxDate: '2026-08-29',
    });
    const cells = month.cells.filter((cell) => cell !== null);
    expect(cells.filter((cell) => cell.isToday).map((cell) => cell.date)).toEqual(['2026-08-29']);
    expect(cells.find((cell) => cell.date === '2026-08-29')?.isDisabled).toBe(false);
    expect(cells.find((cell) => cell.date === '2026-08-30')?.isDisabled).toBe(true);
    expect(cells.find((cell) => cell.date === '2026-08-28')?.isDisabled).toBe(false);
  });

  it('disables nothing when there is no ceiling', () => {
    const month = buildDateRangePickerMonth({
      year: 2026,
      month: 8,
      draft: custom(null, null),
      todayDate: null,
      maxDate: null,
    });
    expect(month.cells.some((cell) => cell?.isDisabled === true)).toBe(false);
  });
});

describe('resolveDateRangePickerMonths', () => {
  it('opens on the month containing today and the month before it for a preset', () => {
    expect(
      resolveDateRangePickerMonths({ datePreset: '90d', from: null, to: null }, '2026-08-29'),
    ).toEqual({ left: { year: 2026, month: 7 }, right: { year: 2026, month: 8 } });
  });

  it('anchors on the END of a custom range, since that is the edge people move', () => {
    expect(resolveDateRangePickerMonths(custom('2026-02-10', '2026-07-13'), '2026-08-29')).toEqual({
      left: { year: 2026, month: 6 },
      right: { year: 2026, month: 7 },
    });
  });

  it('anchors on the start while a custom selection is still half-finished', () => {
    expect(resolveDateRangePickerMonths(custom('2026-03-04', null), '2026-08-29')).toEqual({
      left: { year: 2026, month: 2 },
      right: { year: 2026, month: 3 },
    });
  });

  it('carries the year backwards across January', () => {
    expect(resolveDateRangePickerMonths(custom('2026-01-02', '2026-01-20'), '2026-08-29')).toEqual({
      left: { year: 2025, month: 12 },
      right: { year: 2026, month: 1 },
    });
  });

  it('falls back to today when a draft carries an unparseable date', () => {
    expect(resolveDateRangePickerMonths(custom('not-a-date', null), '2026-08-29')).toEqual({
      left: { year: 2026, month: 7 },
      right: { year: 2026, month: 8 },
    });
  });
});
