'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * THE SHARED TIME SELECTION FOR EVERY TRADE TIMESTAMP.
 *
 * WHAT IT REPLACES. Two two-digit number inputs labelled Hour and Minute. They
 * were correct and they were work: the picker offered a calendar you could
 * point at for the date, then changed its mind about the interaction and asked
 * you to type the time. Choosing 14:32 meant a keyboard on a phone, and on a
 * desktop it meant reading which of two identical boxes was the hour.
 *
 * WHAT IT IS. Two finite wheels, hour and minute, each presented as a single
 * accessible SPINBUTTON. Pointing works — a visible neighbour is clickable —
 * and so do dragging, the mouse wheel, and the arrow keys. Typing is still
 * available, but as a deliberate choice rather than the only route.
 *
 * IT IS NOT AN iOS WHEEL, AND THE DIFFERENCES ARE THE POINT. No cylinder, no
 * perspective, no momentum worth the name, no spin. This is a data-entry
 * control for a record that has to be exact: a trader who lands on 14:33 and
 * has to nudge back has been failed by the control, however pleasing the
 * deceleration was. Three rows, one band, and it settles where you left it.
 *
 * THE VALUE IS A NUMBER AND THE WHEEL IS A PICTURE OF IT. There is no separate
 * "wheel state" that a commit could read while it was still catching up. Every
 * interaction resolves to `onChange(nextInteger)` at the moment it happens, and
 * the only thing that ever animates is a transient pixel offset that is reset
 * to zero on release. So the centred value, the `aria-valuenow`, and whatever
 * `Apply` commits are the same number by construction rather than by timing —
 * which is the whole of the stale-value problem this pattern usually ships
 * with.
 *
 * FINITE, NOT CYCLIC. 23 has no next hour and 59 has no next minute; the wheel
 * draws the empty space rather than rolling over. A picker that turns 23:59
 * into 00:00 by one more notch of the same gesture has silently moved a trade
 * to the following day.
 */

/** `7` -> `07`. Every value the reader sees, and every value announced. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How far a wheel/trackpad gesture must travel to move one value.
 *
 * A mouse notch arrives as a single event of roughly 100px and moves exactly
 * one step; a trackpad arrives as a stream of small deltas and accumulates.
 * The accumulator is CLEARED rather than decremented when it fires, which caps
 * one event at one step — a flick cannot queue up twelve of them and spin the
 * column past where the reader was looking.
 */
const WHEEL_STEP_PX = 50;

/** A new gesture starts from zero rather than inheriting the last one's tail. */
const WHEEL_IDLE_MS = 250;

/** Past this, a pointer gesture is a drag and the release is not a click. */
const DRAG_SLOP_PX = 4;

export interface TimeWheelValue {
  readonly hour: number;
  readonly minute: number;
}

/**
 * One column: the accessible spinbutton, and the three rows that draw it.
 *
 * ROLE=SPINBUTTON, NOT SIXTY OPTIONS. A listbox of every minute is sixty stops
 * between a screen reader user and the next control, to say one number. The
 * spinbutton says the number, its range, and nothing else — and the rows are
 * `aria-hidden`, because they are the picture, not the control.
 */
function WheelColumn({
  label,
  value,
  min,
  max,
  onChange,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const labelId = useId();
  const columnRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState(0);

  const wheelAccum = useRef(0);
  const wheelAt = useRef(0);
  const dragStartY = useRef(0);
  const stepAnchorY = useRef(0);
  const movedRef = useRef(false);

  /** The measured height of one row, so zoom and text scaling are respected. */
  const rowHeight = useCallback(() => {
    const element = columnRef.current;
    if (element === null) return 40;
    const measured = element.getBoundingClientRect().height / 3;
    return measured > 0 ? measured : 40;
  }, []);

  const step = useCallback(
    (delta: number) => {
      const next = clamp(value + delta, min, max);
      if (next !== value) onChange(next);
      return next !== value;
    },
    [value, min, max, onChange],
  );

  /*
    THE WHEEL LISTENER EXISTS ONLY WHILE THE COLUMN IS FOCUSED.

    Hovering is not intent. A reader scrolling the page with the pointer
    happening to rest over the minute column must not discover later that the
    trade moved to 14:37 — so there is no wheel handler at all until the column
    has been clicked or tabbed into, and it is removed again on blur.

    It is a native listener rather than `onWheel` because it must call
    `preventDefault`, and React's synthetic wheel handler is attached passively
    at the root where that call does nothing.
  */
  useEffect(() => {
    const element = columnRef.current;
    if (element === null || !focused) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const now = event.timeStamp;
      if (now - wheelAt.current > WHEEL_IDLE_MS) wheelAccum.current = 0;
      wheelAt.current = now;

      // Lines and pages are normalised to pixels so a mouse and a trackpad are
      // measured on one scale rather than one of them being 16x the other.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rowHeight() * 3 : 1;
      wheelAccum.current += event.deltaY * unit;

      if (Math.abs(wheelAccum.current) >= WHEEL_STEP_PX) {
        step(Math.sign(wheelAccum.current));
        wheelAccum.current = 0;
      }
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [focused, step, rowHeight]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowUp: 1,
      ArrowDown: -1,
      PageUp: 5,
      PageDown: -5,
    };
    if (event.key in moves) {
      event.preventDefault();
      step(moves[event.key] ?? 0);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (value !== min) onChange(min);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (value !== max) onChange(max);
    }
  }

  /*
    A DRAG COMMITS AS IT GOES, AND THE OFFSET IS ONLY EVER A PICTURE.

    Each row-height of travel resolves to a value change immediately, so the
    number under the band is the committed number at every instant of the
    gesture. Releasing animates the leftover pixels back to zero; it does not
    decide anything. At an end of the range the column stops taking travel
    rather than rubber-banding away from a value it cannot reach.
  */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return;
    columnRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartY.current = event.clientY;
    stepAnchorY.current = event.clientY;
    movedRef.current = false;
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    if (Math.abs(event.clientY - dragStartY.current) > DRAG_SLOP_PX) movedRef.current = true;

    const row = rowHeight();
    let travel = event.clientY - stepAnchorY.current;

    /*
      The loop walks a LOCAL value rather than calling `step` per row. One move
      event can cross several rows at once, and `value` is the value from this
      render — so three calls to `step` would each compute their next value
      from the same stale number and land on the same one. A fast drag would
      have moved a single hour however far it travelled.
    */
    let working = value;
    while (Math.abs(travel) >= row) {
      const direction = Math.sign(travel);
      // Dragging DOWN brings earlier values into the band, so positive travel
      // decreases the value.
      const next = clamp(working - direction, min, max);
      if (next === working) break;
      working = next;
      stepAnchorY.current += direction * row;
      travel = event.clientY - stepAnchorY.current;
    }
    if (working !== value) onChange(working);
    setOffset(clamp(travel, -row, row));
  }

  /*
    A TAP ON A NEIGHBOUR IS RESOLVED HERE, NOT BY A CLICK HANDLER ON THE ROW.

    The column takes pointer capture for the duration of a drag, and capture
    redirects the eventual `click` to the capturing element — so per-row
    `onClick` handlers never fire at all once a gesture has begun. Reading which
    third of the column the pointer came up over works whether or not capture
    was taken, and keeps one code path for taps and drags.
  */
  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!movedRef.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const index = Math.floor((event.clientY - bounds.top) / (bounds.height / 3));
      const delta = clamp(index, 0, 2) - 1;
      if (delta !== 0) {
        const next = clamp(value + delta, min, max);
        if (next !== value) onChange(next);
      }
    }
    endDrag(event);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setOffset(0);
  }

  // Five rows drawn inside a three-row window: the two outside it are what a
  // drag reveals, so the movement has somewhere to come from.
  const rows = [-2, -1, 0, 1, 2].map((delta) => {
    const rowValue = value + delta;
    return {
      delta,
      value: rowValue >= min && rowValue <= max ? rowValue : null,
    };
  });

  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-1.5', className)}>
      <span id={labelId} className="text-muted-foreground text-xs font-medium">
        {label}
      </span>

      <div
        ref={columnRef}
        role="spinbutton"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={pad2(value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          wheelAccum.current = 0;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        /*
          `touch-none` is what keeps a wheel gesture from becoming a sheet
          scroll. A touch that starts here belongs to this column for its whole
          life, including after it reaches 00 or 23 — the failure this prevents
          is a drag that runs out of hours and hands itself to the surface
          underneath mid-gesture.
        */
        className={cn(
          'relative w-[3.25rem] touch-none overflow-hidden rounded-lg outline-none select-none',
          'h-[calc(var(--wheel-row)*3)]',
          'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0',
            dragging
              ? null
              : 'transition-transform duration-150 ease-out motion-reduce:transition-none',
          )}
          style={{ transform: `translateY(calc(-1 * var(--wheel-row) + ${offset}px))` }}
        >
          {rows.map(({ delta, value: rowValue }) => (
            <div
              key={delta}
              className={cn(
                'numeric flex h-[var(--wheel-row)] items-center justify-center text-base tabular-nums',
                rowValue === null
                  ? ''
                  : delta === 0
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {rowValue === null ? '' : pad2(rowValue)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The two wheels, the band that marks the selection, and the stationary colon.
 *
 * The band is drawn ONCE across both columns rather than per column, because
 * it is one selected time rather than two selected numbers, and two bands with
 * a gap between them read as two separate controls.
 */
export function TimeWheels({
  value,
  onChange,
}: {
  value: TimeWheelValue;
  onChange: (next: TimeWheelValue) => void;
}) {
  return (
    <div
      /*
        Rows are sized in rem, not pixels, so 200% text growth makes the wheel
        taller instead of clipping the numbers inside a fixed box. Touch gets
        the larger row; a pointer does not need it.
      */
      className="relative flex min-w-0 items-end justify-center gap-1 [--wheel-row:2.75rem] sm:[--wheel-row:2.5rem]"
    >
      {/*
        The selection band: one restrained strip, behind both columns.

        `items-end` puts every column's three-row box on the wrapper's baseline,
        so the middle row is always exactly one row up from the bottom however
        tall the labels above it become. That is why this is positioned from the
        bottom rather than centred — the labels are not part of the wheel.
      */}
      <div
        aria-hidden="true"
        data-slot="time-wheel-band"
        className="bg-accent/50 border-border pointer-events-none absolute inset-x-0 bottom-[var(--wheel-row)] h-[var(--wheel-row)] rounded-lg border"
      />

      <WheelColumn
        label="Hour"
        value={value.hour}
        min={0}
        max={23}
        onChange={(hour) => onChange({ ...value, hour })}
      />

      <span
        aria-hidden="true"
        className="numeric text-muted-foreground flex h-[calc(var(--wheel-row)*3)] shrink-0 items-center text-base"
      >
        :
      </span>

      <WheelColumn
        label="Minute"
        value={value.minute}
        min={0}
        max={59}
        onChange={(minute) => onChange({ ...value, minute })}
      />
    </div>
  );
}

/**
 * The typed fallback's parse. Deliberately NOT a clamp.
 *
 * `25:70` returns `null` and stays on screen as `25:70`, because a picker that
 * quietly turns it into `23:59` has invented a timestamp the reader never
 * chose. One or two digits either side are accepted — `9:05` means the same
 * thing as `09:05` and refusing it would be pedantry, not safety.
 */
export function parseTypedTime(raw: string): TimeWheelValue | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(raw.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** `{ hour: 14, minute: 32 }` -> `14:32`, the committed shape. */
export function formatWheelTime(value: TimeWheelValue): string {
  return `${pad2(value.hour)}:${pad2(value.minute)}`;
}

/** `14:32` -> `{ hour: 14, minute: 32 }`, falling back to 09:00 as the picker always has. */
export function parseWheelTime(raw: string | undefined): TimeWheelValue {
  return parseTypedTime(raw ?? '') ?? { hour: 9, minute: 0 };
}
