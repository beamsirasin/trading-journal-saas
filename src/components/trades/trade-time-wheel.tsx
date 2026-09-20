'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A 24-HOUR WHEEL FOR ONE WALL-CLOCK TIME.
 *
 * WHY A WHEEL AND NOT `<input type="time">`. The native control is a keyboard
 * field on a desktop and a platform wheel on a phone, so the same question
 * looked like two different controls and neither matched the surface it sat
 * in. This is one control at every width, inside the sheet the rest of the
 * entry timestamp already lives in — no nested overlay, and no platform popup
 * over a modal.
 *
 * WHAT IS UNDER THE BAND IS THE VALUE. That is the whole contract of a wheel,
 * and it is what keeps this honest: nothing is stored until the trader moves
 * or presses something, and the moment they do, BOTH columns commit from where
 * they are actually resting. The alternative — storing an hour while the
 * minute stays unset — cannot be represented (a time is `HH:mm`), and storing
 * a minute the trader never saw would be worse. So until first contact the
 * columns are muted, the band is an outline rather than a fill, and the row
 * above still reads "Not recorded".
 *
 * FOUR WAYS TO MOVE IT, because it has to work on a phone and on a desktop:
 * touch drag and trackpad/wheel come free from a snapping scroll container;
 * mouse drag is added for pointers that have no momentum; and each column is a
 * listbox, so arrows, Page keys and Home/End work and a screen reader
 * announces the active option. Tapping a visible number selects it outright.
 */
const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const TRACK_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const EDGE_PADDING = (TRACK_HEIGHT - ITEM_HEIGHT) / 2;
/** How long after the last scroll event the resting position is taken as an answer. */
const SETTLE_MS = 110;
/** Movement below this is a press on a number, not a drag of the column. */
const DRAG_THRESHOLD = 3;

const pad = (value: number) => String(value).padStart(2, '0');

export interface TradeTimeWheelLabels {
  readonly hour: string;
  readonly minute: string;
}

/** Splits `HH:mm` into numbers, or null when no time is recorded. */
function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hour = Number.parseInt(match[1] as string, 10);
  const minute = Number.parseInt(match[2] as string, 10);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function TradeTimeWheel({
  id,
  value,
  onChange,
  labels,
  disabled = false,
}: {
  id: string;
  /** `HH:mm`, or empty when no time is recorded. */
  value: string;
  onChange: (value: string) => void;
  labels: TradeTimeWheelLabels;
  disabled?: boolean;
}) {
  const parsed = parseTime(value);
  const unset = parsed === null;
  /*
    WHERE AN UNANSWERED WHEEL RESTS. Zero, not "now" and not the middle: a
    wheel parked on the current time is the one position a trader might not
    notice they never chose. Muted and unfilled, 00 reads as a starting point.
  */
  const hour = parsed?.hour ?? 0;
  const minute = parsed?.minute ?? 0;

  const commit = (nextHour: number, nextMinute: number) => {
    if (disabled) return;
    onChange(`${pad(nextHour)}:${pad(nextMinute)}`);
  };

  return (
    <div
      data-time-wheel={id}
      data-time-wheel-state={unset ? 'unset' : 'set'}
      className={cn(
        'relative flex min-w-0 justify-center gap-2 select-none',
        disabled && 'pointer-events-none opacity-50',
      )}
      style={{ height: `${TRACK_HEIGHT}px` }}
    >
      {/*
        THE SELECTION BAND, DRAWN ONCE BEHIND BOTH COLUMNS so the two numbers
        read as one time rather than two independent dials. A quiet fill, not
        an outline: it marks where the answer lands at every moment, and
        whether there IS an answer yet is said by the rows and by the row
        above, not by taking the band away.
      */}
      <div
        aria-hidden="true"
        className="bg-muted/60 pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg"
        style={{ height: `${ITEM_HEIGHT}px` }}
      />
      <WheelColumn
        id={`${id}-hour`}
        label={labels.hour}
        count={24}
        value={hour}
        unset={unset}
        disabled={disabled}
        pageStep={6}
        onSelect={(next) => commit(next, minute)}
      />
      <span
        aria-hidden="true"
        className={cn(
          'self-center text-lg font-semibold tabular-nums',
          unset ? 'text-subtle-foreground' : 'text-foreground',
        )}
      >
        :
      </span>
      <WheelColumn
        id={`${id}-minute`}
        label={labels.minute}
        count={60}
        value={minute}
        unset={unset}
        disabled={disabled}
        pageStep={10}
        onSelect={(next) => commit(hour, next)}
      />
    </div>
  );
}

function WheelColumn({
  id,
  label,
  count,
  value,
  unset,
  disabled,
  pageStep,
  onSelect,
}: {
  id: string;
  label: string;
  count: number;
  value: number;
  /** Nothing is recorded yet: the column shows a resting position, not an answer. */
  unset: boolean;
  disabled: boolean;
  pageStep: number;
  onSelect: (value: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const settle = useRef<number | null>(null);
  /** A scroll this component started, which must not be read back as an answer. */
  const programmatic = useRef(false);
  /** Where a mouse press started, and where it was last seen. Null between drags. */
  const origin = useRef<number | null>(null);
  const lastY = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  /*
    KEEP THE TRACK UNDER THE VALUE. Whenever the answer changes from outside —
    a recovered draft, a keypress, a tap on a number — the track is moved to
    match. A scroll this starts is flagged, so the settle handler below never
    reads it back and re-commits the value it was given.
  */
  function cancelSettle() {
    if (settle.current === null) return;
    window.clearTimeout(settle.current);
    settle.current = null;
  }

  useEffect(() => {
    const element = track.current;
    /*
      AN UNANSWERED COLUMN HAS NO VALUE TO BE KEPT UNDER. `value` is a resting
      position then, not an answer, and treating it as one made releasing a
      drag yank the column straight back to 00 and cancel the commit that was
      about to land — a mouse drag moved the wheel and recorded nothing. While
      nothing is recorded the position belongs to whoever is scrolling it.
    */
    if (element === null || dragging || unset) return;
    const target = value * ITEM_HEIGHT;
    if (Math.abs(element.scrollTop - target) < 1) return;
    /*
      A SYNC OUTRANKS A SETTLE THAT HAS NOT LANDED YET. Tapping a number the
      track has to scroll to — which is what a pointer driver does, and what
      any tap on a partly visible cell does — produces scroll events BEFORE
      the click. Those schedule a settle that would then read the position the
      track was passing through and overwrite the number actually chosen. So
      the pending settle is dropped here, and the one below re-checks this
      flag when it fires rather than only when it was scheduled.
    */
    cancelSettle();
    programmatic.current = true;
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: target, behavior: 'auto' });
    } else {
      element.scrollTop = target;
    }
    const clear = window.setTimeout(() => {
      programmatic.current = false;
    }, SETTLE_MS + 40);
    return () => window.clearTimeout(clear);
  }, [value, dragging, unset]);

  /** The number resting under the band once scrolling stops. */
  function onScroll() {
    const element = track.current;
    if (element === null || programmatic.current) return;
    cancelSettle();
    settle.current = window.setTimeout(() => {
      settle.current = null;
      // A sync started while this was waiting: that answer is the newer one.
      if (programmatic.current) return;
      const index = Math.round(element.scrollTop / ITEM_HEIGHT);
      const next = Math.min(Math.max(index, 0), count - 1);
      if (next !== value || unset) onSelect(next);
    }, SETTLE_MS);
  }

  function step(delta: number) {
    if (disabled) return;
    // From an unanswered wheel the first press answers where it is resting.
    const next = unset ? value : value + delta;
    onSelect(Math.min(Math.max(next, 0), count - 1));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const handled: Record<string, () => void> = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      PageDown: () => step(pageStep),
      PageUp: () => step(-pageStep),
      Home: () => onSelect(0),
      End: () => onSelect(count - 1),
    };
    const action = handled[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  }

  /*
    MOUSE DRAG — AND ONLY ONCE IT IS ONE.

    Touch drags the scroller natively, with momentum this cannot reproduce, and
    a trackpad or wheel scrolls it natively too. So Pointer Events carry the
    one gesture that has no native behaviour here: press and drag with a mouse.

    TWO THINGS THIS HAS TO GET RIGHT, and the first draft got both wrong.

    It must not capture on `pointerdown`: capturing there routes every later
    pointer event to the column, which makes the COLUMN the click target
    instead of the number under the cursor, so tapping a visible number did
    nothing at all while dragging still looked fine.

    And the threshold must measure the distance travelled since the press, not
    `movementY`, which is the delta since the previous move event. A slow drag
    arrives as a stream of one- and two-pixel deltas that never individually
    reach the threshold, so the drag never started — the exact gesture a
    careful person makes on a desktop was the one that did not work. Deltas are
    taken from `clientY` for the same reason: `movementY` is also subject to
    pointer acceleration and display scaling.
  */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.pointerType !== 'mouse') return;
    origin.current = event.clientY;
    lastY.current = event.clientY;
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (origin.current === null) return;
    const element = track.current;
    if (element === null) return;
    const delta = event.clientY - (lastY.current ?? event.clientY);
    lastY.current = event.clientY;
    if (!dragging) {
      if (Math.abs(event.clientY - origin.current) < DRAG_THRESHOLD) return;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    element.scrollTop -= delta;
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    origin.current = null;
    lastY.current = null;
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onScroll();
  }

  return (
    <div
      ref={track}
      id={id}
      role="listbox"
      aria-label={label}
      aria-activedescendant={unset ? undefined : `${id}-${pad(value)}`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-wheel-column={id}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'focus-visible:ring-ring relative w-16 min-w-0 overflow-y-auto rounded-lg outline-none focus-visible:ring-2',
        /*
          SNAP IS OFF WHILE A MOUSE IS DRAGGING IT. Mandatory snapping pulls the
          scroller back to the nearest snap point after every programmatic
          write, so a drag delivered as a stream of two-pixel nudges lands back
          where it started each time and the column never moves — the wheel and
          trackpad paths were unaffected because the browser scrolls those
          itself. Releasing restores snapping, which settles the column on the
          nearest number, and the commit below agrees with it by rounding the
          same way.
        */
        dragging ? 'snap-none' : 'snap-y snap-mandatory',
        // The scrollbar is noise on a control whose whole job is the band.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        'touch-pan-y',
      )}
      style={{ height: `${TRACK_HEIGHT}px` }}
    >
      <div aria-hidden="true" style={{ height: `${EDGE_PADDING}px` }} />
      {Array.from({ length: count }, (_, index) => {
        const selected = !unset && index === value;
        const distance = Math.min(Math.abs(index - value), 2);
        return (
          <div
            key={index}
            id={`${id}-${pad(index)}`}
            role="option"
            aria-selected={selected}
            data-wheel-value={pad(index)}
            onClick={() => (disabled ? undefined : onSelect(index))}
            /*
              THE BAND IS THE FOCUS, AND DISTANCE IS THE CUE. The centred row
              is the strongest thing in the column and each step away is
              quieter, so the eye lands on the answer rather than on a list.
              While nothing is recorded the whole column is one step down and
              no row is marked selected: the wheel is resting, not answering.
            */
            className={cn(
              'flex snap-center items-center justify-center tabular-nums transition-colors motion-reduce:transition-none',
              distance === 0
                ? cn('text-xl', unset ? 'text-muted-foreground' : 'text-foreground font-semibold')
                : distance === 1
                  ? 'text-subtle-foreground text-lg'
                  : 'text-subtle-foreground/55 text-base',
            )}
            style={{ height: `${ITEM_HEIGHT}px` }}
          >
            {pad(index)}
          </div>
        );
      })}
      <div aria-hidden="true" style={{ height: `${EDGE_PADDING}px` }} />
    </div>
  );
}
