'use client';

import { useTranslations } from 'next-intl';

import { CALENDAR_WEEKDAY_KEYS } from '@/lib/dashboard/calendar-grid';
import type { DateRangeCellState, DateRangePickerMonth } from '@/lib/dashboard/date-range-calendar';
import { formatCalendarDateLabel } from '@/lib/dashboard/date-range-presentation';
import { cn } from '@/lib/utils';

/**
 * The band under the range, and the circles at its ends.
 *
 * `in-range` is a RESTRAINED surface step, not a saturated accent wash: on a
 * 90-day custom range the accent would otherwise become the single largest
 * coloured area on the Dashboard, and the two dates a reader is actually
 * adjusting would be lost inside it. The accent is spent on the two endpoints
 * alone.
 *
 * THE TOKEN IS `secondary`, NOT `surface-raised`. Both resolve to #262626 in
 * dark — the frozen foundation's raised/selected value — but `surface-raised`
 * is #ffffff in light, and this band is painted INSIDE a white popover. It
 * would have been invisible in light mode. `secondary` is #262626 dark /
 * #e9edf7 light, so the band reads as a band on both planes.
 *
 * The band is painted on the CELL and the endpoint circle on the BUTTON
 * inside it, which is what lets a continuous run of days read as one bar while
 * each day stays its own 44px target. The band is squared off where it
 * continues and rounded where the selection ends.
 */
const BAND_CLASS: Record<Exclude<DateRangeCellState, null>, string> = {
  start: 'bg-secondary rounded-l-md',
  end: 'bg-secondary rounded-r-md',
  'in-range': 'bg-secondary',
  single: '',
};

const ENDPOINT_STATES: readonly DateRangeCellState[] = ['start', 'end', 'single'];

export function DateRangeMonthGrid({
  month,
  monthLabel,
  onSelect,
  dateLocale,
  className,
}: {
  month: DateRangePickerMonth;
  monthLabel: string;
  onSelect: (date: string) => void;
  dateLocale: string;
  className?: string;
}) {
  const t = useTranslations('dashboard.toolbar.dateRange');
  const tWeekday = useTranslations('dashboard.calendar.weekday');

  return (
    <div
      className={cn('min-w-0', className)}
      data-range-month={`${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`}
    >
      <div className="text-foreground mb-2 text-center text-sm font-semibold">{monthLabel}</div>
      <div aria-hidden="true" className="mb-1 grid grid-cols-7">
        {CALENDAR_WEEKDAY_KEYS.map((key) => (
          <div key={key} className="text-subtle-foreground text-center text-[11px] font-medium">
            {tWeekday(key)}
          </div>
        ))}
      </div>
      {/*
        A grid of buttons rather than a `<table>`: this is a control, not a
        data table, and every square is either an action or empty. The month
        name above is the group's accessible name, and each button carries the
        full, locale-formatted date plus its selection state, so nothing here
        is conveyed by colour alone.
      */}
      <div role="group" aria-label={monthLabel} className="grid grid-cols-7 gap-y-0.5">
        {month.cells.map((cell, index) => {
          if (cell === null) return <div key={`blank-${index}`} aria-hidden="true" />;

          const isEndpoint = ENDPOINT_STATES.includes(cell.state);
          const dateLabel = formatCalendarDateLabel(cell.date, dateLocale) ?? cell.date;
          const stateLabel =
            cell.state === 'start'
              ? t('cellState.start')
              : cell.state === 'end'
                ? t('cellState.end')
                : cell.state === 'single'
                  ? t('cellState.selected')
                  : cell.state === 'in-range'
                    ? t('cellState.inRange')
                    : null;

          return (
            <div
              key={cell.date}
              className={cn('min-w-0', cell.state === null ? '' : BAND_CLASS[cell.state])}
            >
              <button
                type="button"
                data-range-date={cell.date}
                data-range-state={cell.state ?? 'none'}
                disabled={cell.isDisabled}
                aria-pressed={isEndpoint}
                aria-label={[
                  dateLabel,
                  cell.isToday ? t('cellState.today') : null,
                  stateLabel,
                  cell.isDisabled ? t('cellState.unavailable') : null,
                ]
                  .filter((part) => part !== null)
                  .join(', ')}
                onClick={() => onSelect(cell.date)}
                className={cn(
                  'relative flex aspect-square w-full min-w-0 items-center justify-center rounded-md text-sm',
                  // No ring offset: an offset ring on a 40px square inside a
                  // seven-column grid is clipped by its neighbours. `z-10`
                  // lifts the focused cell over the band instead.
                  'focus-visible:ring-ring outline-none focus-visible:z-10 focus-visible:ring-2',
                  'disabled:pointer-events-none disabled:opacity-40',
                  isEndpoint
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : cell.state === 'in-range'
                      ? 'text-foreground'
                      : 'text-secondary-foreground hover:bg-accent',
                )}
              >
                <span className="numeric leading-none">{cell.dayOfMonth}</span>
                {/*
                  TODAY IS A MARK, NOT A COLOUR. A dot under the numeral stays
                  legible on the accent circle, on the range band and on the
                  bare surface alike, so "today" never has to compete with the
                  selection for the same visual channel.
                */}
                {cell.isToday ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute bottom-1 size-1 rounded-full',
                      isEndpoint ? 'bg-primary-foreground' : 'bg-primary',
                    )}
                  />
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
