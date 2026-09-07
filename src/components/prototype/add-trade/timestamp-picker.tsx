'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import {
  buildCalendarGrid,
  CALENDAR_WEEKDAY_KEYS,
  shiftCalendarMonth,
} from '@/lib/dashboard/calendar-grid';
import {
  formatCalendarDateLabel,
  formatCalendarMonthLabel,
} from '@/lib/dashboard/date-range-presentation';
import { cn } from '@/lib/utils';
import { ToolbarDisclosure } from '@/components/dashboard/toolbar/toolbar-disclosure';
import { Button } from '@/components/ui/button';

/**
 * THE TRADE TIMESTAMP CONTROL.
 *
 * WHAT IT REPLACES. `<input type="datetime-local">`. It was the honest quick
 * choice while the composition was being settled and it is the wrong control
 * for this product: it renders as a different widget in every browser, none of
 * them matching anything else in TradeChemist; its calendar is the platform's,
 * not this one's; and on the case that matters most here — a trade being written
 * up weeks later — the reader is handed a segmented numeric field and left to
 * work out the order of the segments.
 *
 * WHAT IT REUSES, AND WHAT IT DELIBERATELY DOES NOT. The surface is
 * `ToolbarDisclosure`, so this picker is an anchored popover on a desktop and a
 * near-full-height sheet on a phone, with the product's own dismissal, focus
 * trapping and focus restoration — the same two surfaces the Dashboard's date
 * range already opens into. The month geometry is `buildCalendarGrid`, the
 * product's own, so the squares, the leading and trailing pads and the weekday
 * order are literally the same code the Dashboard calendar runs.
 *
 * It does NOT reuse `DateRangeMonthGrid`. That grid's whole substance is range
 * state — start, end, in-range banding, two linked months — and a single
 * timestamp has none of it. Copying it would have meant carrying a range model
 * that can only ever hold a degenerate range, and then suppressing most of its
 * visual language. One selected day, drawn the way that grid draws an endpoint.
 *
 * TODAY AND NOW ARE DIFFERENT ACTIONS AND SAY SO. `Today` moves the DATE and
 * leaves the time alone — the case where a trader knows the trade was today but
 * is still typing the minute it closed. `Now` sets BOTH. Collapsing them into
 * one button is how a carefully typed exit time gets silently overwritten.
 *
 * SELECTING A DAY DOES NOT COMMIT. The picker stays open so the time can be
 * adjusted against the date just chosen, and `Apply` commits the two together.
 * A day tap that closed the panel would force a second open for every timestamp
 * that is not exactly midnight.
 */

export interface Timestamp {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:MM`, 24-hour. */
  readonly time: string;
}

/** `7 Sep 2026 · 14:32` — the value as the trigger states it. */
export function formatTimestamp(value: Timestamp | null, locale = 'en-GB'): string | null {
  if (value === null) return null;
  const date = formatCalendarDateLabel(value.date, locale);
  return date === null ? null : `${date} · ${value.time}`;
}

export function TimestampField({
  label,
  title,
  value,
  onChange,
  placeholder = 'Select date and time',
  optional = false,
}: {
  label: string;
  /** The panel's own heading, e.g. "Entry date and time". */
  title: string;
  value: Timestamp | null;
  onChange: (value: Timestamp) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const summary = formatTimestamp(value);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span id={labelId} className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        {optional ? <span className="text-subtle-foreground text-xs">Optional</span> : null}
      </div>

      <TimestampDisclosure
        open={open}
        onOpenChange={setOpen}
        title={title}
        value={value}
        onApply={(next) => {
          onChange(next);
          setOpen(false);
        }}
        trigger={
          <button
            type="button"
            aria-labelledby={labelId}
            className={cn(
              'border-input bg-background text-foreground flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-base',
              'hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
              'data-[state=open]:border-ring transition-colors',
            )}
          >
            <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                summary === null ? 'text-subtle-foreground' : 'numeric',
              )}
            >
              {summary ?? placeholder}
            </span>
          </button>
        }
      />
    </div>
  );
}

const LOCALE = 'en-GB';

/** Today, in the prototype's fixed "now" so screenshots are reproducible. */
const PROTOTYPE_TODAY = '2026-09-07';

/** The prototype's fixed "now", so a captured timestamp is reproducible in a screenshot. */
const PROTOTYPE_NOW_TIME = '14:32';
/**
 * The panel: one draft, a scrolling body, and a PINNED commit row.
 *
 * WHY THE DRAFT LIVES HERE RATHER THAN IN THE BODY. `Cancel` has to be able to
 * throw the draft away, and `Apply` has to be able to commit it — so both need
 * to see it, and both live in the disclosure's pinned footer. Keeping the state
 * one level up is what lets the footer be pinned at all.
 *
 * WHY THE COMMIT ROW IS PINNED. It was written into the scrolling body, on the
 * reasoning that a phone keyboard opening over the hour and minute fields would
 * also cover a footer pinned to the bottom of a sheet. A desktop screenshot
 * showed what that reasoning cost: at a 1000px viewport the popover's scroll
 * region ended just after Today/Now, so the one control that commits the date
 * sat below the fold of a panel nobody would think to scroll. An action a reader
 * cannot see is a worse failure than one a keyboard may overlap — and this is
 * the surface `ToolbarDisclosure` pins for exactly this purpose, the same way
 * the Dashboard's own date range commits.
 *
 * THE DRAFT IS RE-SEEDED ON OPEN DURING RENDER, not in an effect. Comparing the
 * current `open` against the previous render's is React's documented way to
 * adjust state when a prop changes; the effect version re-seeded three pieces of
 * state after painting, which is the cascading render the lint rule rejects and
 * a race a screenshot can lose.
 */
function TimestampDisclosure({
  open,
  onOpenChange,
  title,
  value,
  onApply,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: Timestamp | null;
  onApply: (value: Timestamp) => void;
  trigger: ReactNode;
}) {
  const [draftDate, setDraftDate] = useState(value?.date ?? PROTOTYPE_TODAY);
  const [draftTime, setDraftTime] = useState(value?.time ?? '09:00');
  const [month, setMonth] = useState(() => monthOf(value?.date ?? PROTOTYPE_TODAY));
  const [pickingPeriod, setPickingPeriod] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const seed = value?.date ?? PROTOTYPE_TODAY;
      setDraftDate(seed);
      setDraftTime(value?.time ?? '09:00');
      setMonth(monthOf(seed));
      setPickingPeriod(false);
    }
  }

  const grid = buildCalendarGrid({
    year: month.year,
    month: month.month,
    days: [],
    todayDate: PROTOTYPE_TODAY,
    selectedDate: draftDate,
  });

  return (
    <ToolbarDisclosure
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      trigger={trigger}
      align="start"
      popoverClassName="w-[20.5rem]"
      footer={
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            onClick={() => onApply({ date: draftDate, time: draftTime })}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/* The draft, stated in words, so Apply is never a guess about what the
            grid and the two number fields currently add up to. */}
        <p className="text-foreground numeric text-sm font-medium">
          {formatCalendarDateLabel(draftDate, LOCALE) ?? draftDate} · {draftTime}
        </p>

        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            className="size-9 shrink-0"
            onClick={() =>
              setMonth((current) => shiftCalendarMonth(current.year, current.month, -1))
            }
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          {/*
            THE HEADING IS THE WAY OUT OF SEQUENTIAL PAGING. A trade from March
            two years ago is thirty taps of the chevron, or two taps of this.
          */}
          <button
            type="button"
            aria-expanded={pickingPeriod}
            onClick={() => setPickingPeriod((current) => !current)}
            className="text-foreground hover:bg-accent focus-visible:ring-ring min-h-9 min-w-0 flex-1 rounded-md text-center text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {formatCalendarMonthLabel(month.year, month.month, LOCALE)}
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            className="size-9 shrink-0"
            onClick={() =>
              setMonth((current) => shiftCalendarMonth(current.year, current.month, 1))
            }
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {pickingPeriod ? (
          <PeriodPicker
            year={month.year}
            month={month.month}
            onPick={(year, monthNumber) => {
              setMonth({ year, month: monthNumber });
              setPickingPeriod(false);
            }}
          />
        ) : (
          <MonthGrid
            cells={grid.cells}
            monthLabel={formatCalendarMonthLabel(month.year, month.month, LOCALE)}
            onSelect={setDraftDate}
          />
        )}

        {/* Hour and minute sit LAST in the body, directly above the pinned
            commit row, so a phone keyboard opening over them covers the calendar
            rather than the fields being edited. */}
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <TimeFields value={draftTime} onChange={setDraftTime} />

          <div className="flex min-w-0 shrink-0 gap-2">
            {/* TWO ACTIONS, TWO MEANINGS. Today moves the DATE and leaves a
                carefully typed time alone; Now moves both. Collapsing them is how
                an exit time gets silently overwritten. */}
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => {
                setDraftDate(PROTOTYPE_TODAY);
                setMonth(monthOf(PROTOTYPE_TODAY));
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => {
                setDraftDate(PROTOTYPE_TODAY);
                setDraftTime(PROTOTYPE_NOW_TIME);
                setMonth(monthOf(PROTOTYPE_TODAY));
              }}
            >
              Now
            </Button>
          </div>
        </div>
      </div>
    </ToolbarDisclosure>
  );
}
function monthOf(date: string): { year: number; month: number } {
  const [year, month] = date.split('-');
  return { year: Number(year), month: Number(month) };
}

const WEEKDAY_LABEL: Record<(typeof CALENDAR_WEEKDAY_KEYS)[number], string> = {
  sun: 'S',
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'T',
  fri: 'F',
  sat: 'S',
};

/**
 * One month of days.
 *
 * The cell treatment is the Dashboard grid's, minus the range band: an
 * `aspect-square` target, the accent circle for the selection, a dot for today
 * so "today" never competes with "selected" for the same channel, and a `z-10`
 * focus ring rather than an offset one, which a seven-column grid clips.
 */
function MonthGrid({
  cells,
  monthLabel,
  onSelect,
}: {
  cells: readonly ({
    date: string;
    dayOfMonth: number;
    isToday: boolean;
    isSelected: boolean;
  } | null)[];
  monthLabel: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div aria-hidden="true" className="mb-1 grid grid-cols-7">
        {CALENDAR_WEEKDAY_KEYS.map((key) => (
          <div key={key} className="text-subtle-foreground text-center text-[11px] font-medium">
            {WEEKDAY_LABEL[key]}
          </div>
        ))}
      </div>
      <div role="group" aria-label={monthLabel} className="grid grid-cols-7 gap-y-0.5">
        {cells.map((cell, index) => {
          if (cell === null) return <div key={`blank-${index}`} aria-hidden="true" />;
          const label = formatCalendarDateLabel(cell.date, LOCALE) ?? cell.date;
          return (
            <button
              key={cell.date}
              type="button"
              data-picker-date={cell.date}
              aria-pressed={cell.isSelected}
              aria-label={[
                label,
                cell.isToday ? 'today' : null,
                cell.isSelected ? 'selected' : null,
              ]
                .filter((part) => part !== null)
                .join(', ')}
              onClick={() => onSelect(cell.date)}
              className={cn(
                'relative flex aspect-square w-full min-w-0 items-center justify-center rounded-md text-sm',
                'focus-visible:ring-ring outline-none focus-visible:z-10 focus-visible:ring-2',
                cell.isSelected
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-secondary-foreground hover:bg-accent',
              )}
            >
              <span className="numeric leading-none">{cell.dayOfMonth}</span>
              {cell.isToday ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute bottom-1 size-1 rounded-full',
                    cell.isSelected ? 'bg-primary-foreground' : 'bg-primary',
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Direct month and year selection.
 *
 * A year `<select>` rather than a second stepper: stepping is exactly what this
 * panel exists to escape, and a native select gives the platform's own wheel on
 * a phone. Twelve month squares beside it means any month in the offered span
 * is two interactions away, which is the difference between recording a trade
 * from March two years ago and giving up on it.
 */
function PeriodPicker({
  year,
  month,
  onPick,
}: {
  year: number;
  month: number;
  onPick: (year: number, month: number) => void;
}) {
  const [draftYear, setDraftYear] = useState(year);
  const years = Array.from({ length: 16 }, (_, index) => 2027 - index);
  const yearId = useId();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={yearId} className="text-muted-foreground text-xs font-medium">
          Year
        </label>
        <select
          id={yearId}
          value={draftYear}
          onChange={(event) => setDraftYear(Number(event.target.value))}
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 numeric h-11 min-w-0 flex-1 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div role="group" aria-label="Month" className="grid grid-cols-3 gap-1.5">
        {MONTH_SHORT.map((name, index) => {
          const monthNumber = index + 1;
          const selected = draftYear === year && monthNumber === month;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(draftYear, monthNumber)}
              className={cn(
                'focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md text-sm outline-none focus-visible:ring-2',
                selected
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-secondary-foreground hover:bg-accent',
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hour and minute, as two numeric fields.
 *
 * NOT `<input type="time">`, for the same reason the trigger is not
 * `datetime-local`: it is a different widget in every browser and none of them
 * is this product's. Two two-digit fields give a numeric keypad on a phone, take
 * the product's own input styling, and are unambiguous about which half is being
 * edited — which a segmented native control is not.
 *
 * They are inside the panel, above the pinned footer, so a phone keyboard can
 * cover the calendar without ever covering Apply.
 */
function TimeFields({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [hour = '00', minute = '00'] = value.split(':');
  const hourId = useId();
  const minuteId = useId();

  function commit(nextHour: string, nextMinute: string) {
    onChange(`${clamp(nextHour, 23)}:${clamp(nextMinute, 59)}`);
  }

  return (
    <div className="flex min-w-0 items-end gap-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={hourId} className="text-muted-foreground text-xs font-medium">
          Hour
        </label>
        <input
          id={hourId}
          inputMode="numeric"
          value={hour}
          onChange={(event) => commit(event.target.value, minute)}
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 numeric h-11 w-16 rounded-md border px-3 text-center text-base outline-none focus-visible:ring-[3px]"
        />
      </div>
      <span className="text-muted-foreground pb-3 text-base" aria-hidden="true">
        :
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={minuteId} className="text-muted-foreground text-xs font-medium">
          Minute
        </label>
        <input
          id={minuteId}
          inputMode="numeric"
          value={minute}
          onChange={(event) => commit(hour, event.target.value)}
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 numeric h-11 w-16 rounded-md border px-3 text-center text-base outline-none focus-visible:ring-[3px]"
        />
      </div>
    </div>
  );
}

/** Keeps a typed hour or minute inside its real range without rejecting a partial entry. */
function clamp(raw: string, max: number): string {
  const digits = raw.replace(/\D/g, '').slice(0, 2);
  if (digits === '') return '00';
  return String(Math.min(Number(digits), max)).padStart(2, '0');
}
