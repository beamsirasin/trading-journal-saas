'use client';

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
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

import { useKeyboardObscuringViewport } from './form-primitives';
import {
  formatWheelTime,
  parseTypedTime,
  parseWheelTime,
  TimeWheels,
  type TimeWheelValue,
} from './time-wheel';

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
  /*
    THE TIME DRAFT IS TWO INTEGERS, AND THE WHEEL IS A PICTURE OF THEM.

    It used to be two strings held exactly as typed, because the number fields
    fought the reader otherwise — clearing one to retype snapped it to "00",
    and a lone "1" became "01" before the "4" arrived. The wheel has no such
    problem: it cannot express a half-finished value, so the draft can be the
    valid integers themselves and `Apply` needs no normalisation pass to guess
    what the reader meant.

    Typing still needs somewhere to hold `25:70` without it becoming a real
    time, and that is `typedTime` below — a buffer that exists only while the
    typed fallback is open.
  */
  const [time, setTime] = useState<TimeWheelValue>(() => parseWheelTime(value?.time));
  const [month, setMonth] = useState(() => monthOf(value?.date ?? PROTOTYPE_TODAY));
  const [pickingPeriod, setPickingPeriod] = useState(false);
  /*
    THE TYPED FALLBACK, AND WHY IT IS A MODE RATHER THAN A HIDDEN GESTURE.

    `null` is the wheel; a string is the typed field, holding exactly what was
    entered. Making the wheel's centre number secretly editable would summon a
    phone keyboard on a control whose entire purpose is not needing one, so the
    reader asks for typing explicitly and returns explicitly.
  */
  const [typedTime, setTypedTime] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const typedId = useId();
  const typedErrorId = useId();

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const seed = value?.date ?? PROTOTYPE_TODAY;
      setDraftDate(seed);
      setTime(parseWheelTime(value?.time));
      setMonth(monthOf(seed));
      setPickingPeriod(false);
      setTypedTime(null);
    }
  }

  /*
    AN INVALID TIME CAN ONLY EXIST WHILE THE TYPED FIELD IS OPEN, and while it
    does, nothing may be committed. The wheel cannot produce one.
  */
  const typedParsed = typedTime === null ? null : parseTypedTime(typedTime);
  const timeInvalid = typedTime !== null && typedParsed === null;

  /*
    APPLY IS NEVER BELOW THE KEYBOARD.

    `ToolbarDisclosure` pins its footer to the bottom of a 92dvh sheet, and dvh
    is a property of the LAYOUT viewport, which a soft keyboard does not shrink.
    So while the hour and minute fields are being edited — the one moment this
    panel exists for — the pinned Apply sits underneath the keyboard.

    When the visual viewport reports that something is covering the page, the
    commit row leaves the pinned footer and joins the scrolling body instead, so
    it can be scrolled to within the region that is actually visible. Apply is
    never hidden and never has to be guessed at; on a desktop, and on a phone
    with no keyboard up, the footer stays pinned exactly as before.
  */
  const keyboardOpen = useKeyboardObscuringViewport();

  const commitRow = (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        className="min-h-11"
        /*
          Blocked, not clamped. While the typed field holds something that is
          not a time there is nothing to commit, and inventing one is how a
          trade acquires a timestamp nobody chose.
        */
        disabled={timeInvalid}
        onClick={() => onApply({ date: draftDate, time: formatWheelTime(time) })}
      >
        Apply
      </Button>
    </div>
  );

  /*
    THE TIME FIELDS AND THE COMMIT ROW, AS ONE BLOCK THAT CAN MOVE.

    Their position depends on whether a keyboard is covering the page, so they
    are declared once and placed twice rather than duplicated across two
    branches — two copies of a control holding one piece of state is how the
    two copies end up disagreeing.
  */
  const timeBlock = (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        {/*
          THE HEADER ROW CARRIES THE ONE ESCAPE HATCH. `Type time` is quiet on
          purpose: it is for the trade being written up weeks later where a
          distant exact minute is faster typed than travelled to, not the
          ordinary path.
        */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-medium">Time</span>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 text-xs"
            onClick={() =>
              setTypedTime((current) => (current === null ? formatWheelTime(time) : null))
            }
          >
            {typedTime === null ? 'Type time' : 'Use wheel'}
          </Button>
        </div>

        {typedTime === null ? (
          <TimeWheels value={time} onChange={setTime} />
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={typedId} className="sr-only">
              Time, 24-hour, as HH:MM
            </label>
            <input
              id={typedId}
              inputMode="numeric"
              autoComplete="off"
              placeholder="HH:MM"
              value={typedTime}
              aria-invalid={timeInvalid}
              aria-describedby={timeInvalid ? typedErrorId : undefined}
              onChange={(event) => {
                const next = event.target.value;
                setTypedTime(next);
                /*
                  A valid entry updates the shared draft as it is typed, so
                  `Use wheel` returns to the time the reader just entered
                  rather than to the one they were replacing. An invalid one
                  changes nothing — it stays on screen and blocks Apply.
                */
                const parsed = parseTypedTime(next);
                if (parsed !== null) setTime(parsed);
              }}
              className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 numeric aria-[invalid=true]:border-negative h-11 w-28 rounded-md border px-3 text-center text-base outline-none focus-visible:ring-[3px]"
            />
            {/* Said, not silently corrected. 25:70 is the reader's to fix. */}
            {timeInvalid ? (
              <p id={typedErrorId} className="text-negative text-xs">
                Enter a 24-hour time as HH:MM, between 00:00 and 23:59.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* TWO ACTIONS, TWO MEANINGS. Today moves the DATE and leaves a carefully
          chosen time alone; Now moves both. Collapsing them is how an exit time
          gets silently overwritten. */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
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
            setTime(parseWheelTime(PROTOTYPE_NOW_TIME));
            setMonth(monthOf(PROTOTYPE_TODAY));
            /*
              Now is a complete answer, so it also leaves the typed field: an
              entry that was mid-correction has just been superseded, and
              leaving `25:7` on screen next to a draft of 14:32 would state two
              different times at once.
            */
            setTypedTime((current) => (current === null ? null : PROTOTYPE_NOW_TIME));
          }}
        >
          Now
        </Button>
      </div>
      {/* While a keyboard is up the commit row rides the scrolling body, so it
          can be reached inside the visible viewport rather than sitting under a
          footer pinned to the layout viewport, which a keyboard does not shrink. */}
      {keyboardOpen ? <div className="border-border border-t pt-3">{commitRow}</div> : null}
    </>
  );

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
      {...(keyboardOpen ? {} : { footer: commitRow })}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/* The draft, stated in words, so Apply is never a guess about what the
            grid and the two number fields currently add up to. */}
        <p className="text-foreground numeric text-sm font-medium">
          {formatCalendarDateLabel(draftDate, LOCALE) ?? draftDate} · {formatWheelTime(time)}
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
            className="text-foreground hover:bg-accent focus-visible:ring-ring flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-md text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {formatCalendarMonthLabel(month.year, month.month, LOCALE)}
            {/*
              THE AFFORDANCE, because the escape from sequential paging was
              invisible. A month name between two chevrons reads as a caption,
              not a control — so the one route to a trade from two years ago
              looked like a label and went unused.
            */}
            <ChevronDown
              className={cn(
                'text-subtle-foreground size-3.5 shrink-0 transition-transform duration-150',
                pickingPeriod && 'rotate-180',
                'motion-reduce:transition-none',
              )}
              aria-hidden="true"
            />
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

        {/*
          WHILE A KEYBOARD IS UP, THE TIME COMES FIRST.

          A measured 390x844 phone with a 320px keyboard leaves 524px of visible
          page. With the calendar above them, the hour field landed at 548px and
          Apply at 617px — both below the fold, both reachable only by scrolling
          past a month grid the reader is not currently using. Moving the time
          fields and the commit row above the calendar puts the two things being
          used at the top of the scroll region. The calendar is still there,
          still complete, just no longer between the reader and their own edit.
        */}
        {keyboardOpen ? timeBlock : null}

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

        {keyboardOpen ? null : timeBlock}
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
