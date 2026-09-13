'use client';

import { X } from 'lucide-react';
import { animate, motion, useMotionValue, type PanInfo } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { LAYOUT_SPRING } from '@/lib/motion';
import { CONFIDENCE_STEPS, confidenceLevelKey, type ConfidenceStep } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

type PillRect = { left: number; width: number };

/**
 * The knob's diameter, and the one number the slider's geometry needs.
 *
 * It is a constant rather than a measurement because the knob is a fixed
 * affordance, not a box that resizes with the track — and because the drag
 * mathematics never reads it. `nearestIndexFromClientX` maps a pointer against
 * the TRACK's rect, so the knob can be any size without moving where a step
 * begins.
 */
const KNOB_SIZE = 20;

/**
 * The track's width in LAYOUT pixels — the same pixels the knob's `left` is
 * rendered in.
 *
 * `getBoundingClientRect` includes every ancestor transform. The adaptive
 * overlay's dialog opens from `scale(0.95)`, so a control mounting inside it
 * with a step already committed read a rail 95% of its real width, placed the
 * knob from that, and kept it there: a transform resizes nothing, so the
 * ResizeObserver below never fires to correct it. The computed width is the
 * element's own used width and ignores transforms. jsdom has no layout and
 * returns no number, so it falls back to the bounding width there.
 *
 * Only placement reads this. Mapping a pointer to a step still reads the
 * bounding rect, because pointer coordinates are in the same transformed
 * viewport space.
 */
function layoutWidth(element: HTMLElement): number {
  const computed = Number.parseFloat(getComputedStyle(element).width);
  return Number.isFinite(computed) ? computed : element.getBoundingClientRect().width;
}

/**
 * Shared by the fill's two renderings — the static one before the track has
 * been measured or under reduced motion, and the animated one after. One
 * string so the two can never drift into looking like different elements.
 */
const FILL_CLASS_NAME =
  'bg-primary/70 pointer-events-none absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full';

function clampIndex(index: number): number {
  return Math.min(CONFIDENCE_STEPS.length - 1, Math.max(0, index));
}

export function TradeConfidenceControl({
  id,
  label,
  value,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  /**
   * The sentence under the control. Defaults to the At Entry wording. After
   * Trade passes a longer one that adds the hindsight warning — the same
   * control, said differently, rather than a second control that could drift.
   */
  hint?: string | undefined;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations('trades');
  const groupName = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const radioRefs = useRef<Partial<Record<ConfidenceStep, HTMLInputElement | null>>>({});
  const trackRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragOffsetX = useMotionValue(0);
  const gestureCancelled = useRef(false);

  const [isDragging, setIsDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pillRect, setPillRect] = useState<PillRect | null>(null);
  // The track's measured width, so the fill can be expressed in the same
  // pixels the knob is — see the fill below for why it cannot stay a CSS
  // percentage.
  const [trackWidth, setTrackWidth] = useState<number | null>(null);

  const activeIndex = value === null ? null : CONFIDENCE_STEPS.indexOf(value as ConfidenceStep);
  const displayIndex = isDragging && previewIndex !== null ? previewIndex : activeIndex;
  // `pillRect` only ever holds a measurement for a real, selected segment;
  // deriving `null` here (rather than resetting the state itself) means
  // clearing the value hides the pill immediately without waiting on an
  // effect, and leaves the last-known geometry harmlessly stale in state.
  const renderedPillRect = activeIndex === null ? null : pillRect;

  // The fill's end, in the knob's pixels rather than the rail's percentage —
  // see the fill in the markup below. `displayIndex` (not `activeIndex`) so a
  // drag still previews the step under the finger, exactly as before.
  const isFillMeasured = displayIndex !== null && trackWidth !== null;
  const fillWidth =
    isFillMeasured && trackWidth !== null && displayIndex !== null
      ? (displayIndex / (CONFIDENCE_STEPS.length - 1)) * (trackWidth - KNOB_SIZE) + KNOB_SIZE / 2
      : 0;

  /**
   * The knob's drag bounds, as pixel offsets on `x` rather than a ref to the
   * track — and the difference is the whole point of this expression.
   *
   * `dragConstraints={trackRef}` looked like the obvious way to say "stay
   * inside the rail", but handing Motion a ref makes it OWN this element's
   * position: it attaches a `window.resize` listener plus ResizeObservers on
   * both the knob and the track, and each one calls
   * `scalePositionWithinConstraints`, which rewrites `x` to keep the element
   * proportionally placed inside the re-measured box. `x` here is
   * `dragOffsetX`, a value this component also uses, and nothing outside a
   * drag ever put it back to zero. So a resize left a drag offset behind
   * permanently — up to 471px on a phone rotated to landscape, which drew the
   * knob clean off the end of its own track.
   *
   * Motion's own guards read `isRefObject(dragConstraints)`:
   * `scalePositionWithinConstraints` returns immediately when it is false, and
   * the resize observers are never attached at all. Passing numbers therefore
   * removes the writer instead of cleaning up after it, which is why this is
   * not a reset-on-resize effect — there is nothing left to reset, and no
   * ordering to get right between two observers racing over one value.
   *
   * The numbers say the same thing the ref did. `left`/`right` are relative to
   * the element's own layout box, and for an axis driven by an external motion
   * value Motion rebases them to exactly these values, so `x` is clamped to
   * `[-left edge, travel - left edge]` — the knob may reach either end of the
   * rail and no further. Both terms come from the same measurement pass as the
   * knob's own position, so they cannot disagree with it.
   */
  const knobTravel = trackWidth === null ? 0 : Math.max(0, trackWidth - KNOB_SIZE);
  const dragBounds =
    renderedPillRect === null
      ? { left: 0, right: 0 }
      : { left: -renderedPillRect.left, right: knobTravel - renderedPillRect.left };

  /**
   * Where the knob sits for a given step, in pixels from the track's left edge.
   *
   * Slider geometry, not segment geometry: step 0 puts the knob flush left and
   * step 4 flush right, so the knob's travel spans the whole rail and lines up
   * with the tick beneath it. Measuring the segment instead would park the
   * first knob a tenth of the way in and the last a tenth from the end, which
   * is right for a segmented control and wrong for a slider.
   *
   * This is presentation. It does not participate in deciding which step a
   * drag lands on — that is `nearestIndexFromClientX`, which reads the track
   * and nothing else.
   */
  function measureKnob(index: number): PillRect | null {
    const track = trackRef.current;
    if (!track) return null;
    // No zero-width guard: a track that has not been laid out yet (jsdom, or
    // the first paint) still has to produce a rect, because returning null
    // here would mean no knob renders at all rather than one at the origin.
    const width = layoutWidth(track);
    const travel = Math.max(0, width - KNOB_SIZE);
    const ratio = CONFIDENCE_STEPS.length <= 1 ? 0 : index / (CONFIDENCE_STEPS.length - 1);
    return { left: ratio * travel, width: KNOB_SIZE };
  }

  // Pixel-measured (not percentage) so the pill aligns exactly with each
  // segment's flex-rendered box, gap included — recomputed on selection
  // change and on container resize (responsive breakpoints). This
  // synchronizes React with real DOM layout, which cannot be known during
  // render, so the setState-in-effect here is the canonical DOM-measurement
  // exception, not state-syncing-state.
  useEffect(() => {
    if (activeIndex === null) return;
    const measure = () => {
      setPillRect(measureKnob(activeIndex));
      setTrackWidth(trackRef.current ? layoutWidth(trackRef.current) : null);
    };
    // Still the DOM-measurement exception described above, and still a
    // set-state-in-effect: `react-hooks/set-state-in-effect` simply stops
    // seeing it once the writes sit behind a function the observer also calls.
    // The disable directive it used to need was removed because it was dead,
    // not because the rule stopped applying.
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeIndex]);

  function levelLabel(step: ConfidenceStep): string {
    return t(`create.confidence.level.${confidenceLevelKey(step)}`);
  }

  function selectStep(step: ConfidenceStep) {
    onChange(step);
    radioRefs.current[step]?.focus();
  }

  function moveBySteps(delta: 1 | -1) {
    const currentIndex = value === null ? null : CONFIDENCE_STEPS.indexOf(value as ConfidenceStep);
    const nextIndex =
      currentIndex === null
        ? delta > 0
          ? 0
          : CONFIDENCE_STEPS.length - 1
        : Math.min(CONFIDENCE_STEPS.length - 1, Math.max(0, currentIndex + delta));
    const nextStep = CONFIDENCE_STEPS[nextIndex];
    if (nextStep !== undefined) selectStep(nextStep);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === 'Home') {
      event.preventDefault();
      selectStep(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectStep(100);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveBySteps(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveBySteps(-1);
    }
  }

  /** Pointer viewport X -> nearest of the five discrete step indices. */
  function nearestIndexFromClientX(clientX: number): number {
    const track = trackRef.current;
    const fallback = activeIndex ?? 0;
    if (!track) return fallback;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return fallback;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clampIndex(Math.round(ratio * (CONFIDENCE_STEPS.length - 1)));
  }

  function handleDragStart() {
    gestureCancelled.current = false;
    setIsDragging(true);
    setPreviewIndex(activeIndex);
  }

  function handleDrag(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    setPreviewIndex(nearestIndexFromClientX(info.point.x));
  }

  /**
   * A drag commits at its END, not during it, so cancelling has to suppress
   * that end — tearing down the preview is not enough. Both conditions below
   * are load-bearing and neither is redundant, because a cancelled gesture
   * reaches this handler by two different routes:
   *
   *  - `gestureCancelled`, set by `handlePointerCancel` below. A synthetic or
   *    non-primary `pointercancel` is filtered out by Motion's own window
   *    listener (`isPrimaryPointer`, motion-dom), so its pan session survives
   *    the cancel and ends later on the trailing `pointerup` — arriving here
   *    with `_event.type === 'pointerup'`, indistinguishable from a real
   *    release except for this flag.
   *  - `_event.type === 'pointercancel'`, for the cancel Motion does accept.
   *    Motion never calls `setPointerCapture`, so a real cancel is delivered
   *    to whatever element is under the pointer — which, once the pill has
   *    been dragged out from under it, need not be the pill at all. When that
   *    happens React's `onPointerCancel` never fires and the flag is never
   *    set, and this event type is the only remaining evidence.
   *
   * Deleting either check re-opens the defect for one of the two routes.
   */
  function handleDragEnd(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const cancelled = gestureCancelled.current || _event.type === 'pointercancel';
    gestureCancelled.current = false;
    setIsDragging(false);
    setPreviewIndex(null);
    // The drag offset is purely visual; the pill's true position is always
    // driven by committed state (`pillRect`, from `activeIndex`). Resetting
    // it to zero — animated, or instant under reduced motion — is what makes
    // the release look like a snap rather than a jump.
    animate(dragOffsetX, 0, prefersReducedMotion ? { duration: 0 } : LAYOUT_SPRING);
    // A cancelled gesture leaves the committed value exactly where the trader
    // last put it, and does not move focus either.
    if (cancelled) return;
    const finalIndex = nearestIndexFromClientX(info.point.x);
    const finalStep = CONFIDENCE_STEPS[finalIndex];
    if (finalStep !== undefined && finalStep !== value) {
      selectStep(finalStep);
    } else {
      radioRefs.current[finalStep as ConfidenceStep]?.focus();
    }
  }

  function handlePointerCancel() {
    // A cancelled gesture (e.g. touch interrupted by a system gesture) tears
    // down the preview here, and records that the gesture died so the drag
    // end that follows it cannot commit. See `handleDragEnd` above for why
    // the flag alone is not sufficient.
    gestureCancelled.current = true;
    setIsDragging(false);
    setPreviewIndex(null);
    animate(dragOffsetX, 0, prefersReducedMotion ? { duration: 0 } : LAYOUT_SPRING);
  }

  const previewStep = previewIndex === null ? undefined : CONFIDENCE_STEPS[previewIndex];
  const displayValue = isDragging && previewStep !== undefined ? previewStep : value;
  const valueText =
    displayValue === null
      ? t('common.notSet')
      : `${displayValue}% · ${levelLabel(displayValue as ConfidenceStep)}`;

  return (
    <div className="flex flex-col gap-2">
      <Label>
        {label} <span className="text-muted-foreground font-normal">{t('common.optional')}</span>
      </Label>

      <fieldset id={id} onKeyDown={handleKeyDown} className="min-w-0">
        <legend className="sr-only">{label}</legend>

        {/*
          THE VALUE, NEXT TO THE THING THAT SETS IT.

          It used to sit small and grey in the far corner of a header row, so
          the number a trader had just chosen was the least prominent text in
          the block, and "Not set" read as a status message about the form
          rather than the state of this control.

          It stays ONE text node — "25% · Low", not a number and a word in two
          spans. The exact string is what the drag coverage in
          e2e/trades.spec.ts and this component's own tests assert on, and a
          reader using a screen reader gets the same single phrase.
        */}
        <div className="mb-2 flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'text-xl leading-none font-semibold tabular-nums',
              displayValue === null && 'text-muted-foreground text-base font-medium',
            )}
          >
            {valueText}
          </span>
          {value === null ? null : (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t('create.confidence.clear')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              <X aria-hidden="true" size={14} />
            </button>
          )}
        </div>

        {/*
          A RAIL AND A KNOB, BECAUSE IT IS DRAGGABLE.

          This was five boxes in a bordered strip, which reads as a segmented
          control or a tab bar — neither of which you drag. It always was a
          slider; it just did not look like one, so nobody tried.

          The track keeps its full width and its `data-slot`: the drag
          mathematics maps a pointer's X against THIS element's rect, so its
          box is a contract, not a style choice. The five step targets still
          fill it edge to edge, each 44px tall, and are still what a click
          selects.
        */}
        {/*
          THE FOCUS RING BELONGS TO THE WHOLE CONTROL.

          It used to sit on each step's `<label>` via `peer-focus-visible`, which
          was right when those labels were five visible boxes in a bordered
          strip: the ring outlined the box you had arrowed onto. Once the strip
          became a rail the labels went transparent, and the ring was left
          drawing a rounded rectangle around one invisible fifth of the track —
          measured at exactly 20% of its width, attached to nothing a trader can
          see, and never around the knob.

          It moves here rather than onto the knob for two reasons. The knob is
          `aria-hidden` and not focusable, so ringing it would point at the one
          element that cannot receive focus; and until a step is chosen there is
          no knob at all, which would leave the unset control with no visible
          focus indicator whatsoever. The rail is what the arrow keys operate on,
          so the rail is what the ring should describe.

          `has-[:focus-visible]` keeps this pure CSS: no focus state to track, no
          handler, nothing near the gesture code. `ring` is a box-shadow and
          `rounded-lg` a radius, so neither touches this element's rect — which
          the drag mathematics reads and which stays a contract.
        */}
        <div
          ref={trackRef}
          data-slot="confidence-track"
          className="has-[:focus-visible]:ring-ring/50 relative flex w-full min-w-0 touch-none items-center rounded-lg has-[:focus-visible]:ring-[3px]"
        >
          {/*
            THE RAIL HAS TO LOOK LIKE SOMETHING YOU CAN USE.

            It was `bg-muted` with a `border-border` hairline: #262626 on a
            #0d0d0d background in dark, and #e9edf7 on #f8fafd in light. Both
            are a shade away from the surface behind them, so with no value
            chosen the whole control rendered as a single faint line and read as
            a divider rather than an input.

            `bg-muted-foreground/30` is a translucent FOREGROUND colour, so it
            resolves against whatever surface the control sits on and stays
            visible in both themes without being loud. The border is gone
            because it was only ever compensating for a fill that could not be
            seen.
          */}
          <span
            aria-hidden="true"
            className="bg-muted-foreground/30 pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          />

          {/*
            THE GHOST KNOB — a spec correction, not a defect repair.

            The original brief for this control said: with no value chosen, hide
            the knob and show "Not set". That was followed exactly, and it was
            the wrong instruction. It was harmless while the unset control was
            still a bordered strip with five readable labels; once the strip
            became a rail, hiding the knob left nothing but a line, and a line
            is not an affordance.

            So the knob is outlined rather than absent: same size, same travel,
            no fill, parked at the midpoint of its own travel — which is the 50%
            step, `calc(50% - KNOB/2)`, the identical expression the real knob
            resolves to at that step. Pure CSS, so it needs no measurement and
            is correct on the first paint.

            It is `aria-hidden` and `pointer-events-none`: it says "this is a
            slider and it has no value yet" to the eye only. Nothing about it is
            announced, nothing about it is clickable, and "Not set" remains the
            statement of record above the control.
          */}
          {activeIndex === null ? (
            <span
              aria-hidden="true"
              data-slot="confidence-ghost-knob"
              className="border-muted-foreground/60 pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 rounded-full border-2 bg-transparent"
              style={{
                left: `calc(50% - ${KNOB_SIZE / 2}px)`,
                width: KNOB_SIZE,
                height: KNOB_SIZE,
              }}
            />
          ) : null}
          {/*
            THE FILL RUNS ON THE KNOB'S ANIMATION, NOT ITS OWN.

            It ends under the knob's CENTRE, and it gets there on the knob's
            spring. Both of those were separately wrong.

            Where: the knob travels `width - KNOB_SIZE` and is centred on
            itself, so a step sits at `ratio x (width - KNOB) + KNOB/2`. Filling
            to `ratio x width` put the fill on the rail's coordinate system
            while the knob and the ticks were on the knob's — two systems that
            meet only at 50% and are half a knob apart at the ends.

            When: this used to be `transition-[width] duration-150` against the
            knob's `LAYOUT_SPRING`, so the two moved on different curves and
            disagreed for the whole of every transition, not just at the ends.
            Measured 127ms after an ArrowRight to 100%: fill at 99.22% of the
            track, knob at 88.98%, and the scale already bold at 100% — which is
            what a trader reported as "the thumb is in the wrong place". The
            fill was simply finishing first, every time.

            Same spring, same start, and the delta is identical (the fill's
            width is the knob's `left` plus half a knob), so the two trajectories
            are the same trajectory rather than two curves tuned to look alike.
            That is why this is a measured pixel width and not a CSS
            percentage: a spring cannot be expressed as a CSS transition, and a
            duration picked to "feel about the same" is the bug this replaces.

            The knob's own animation is deliberately untouched. It is what
            `dragOffsetX` springs against when a drag is released, and giving
            the two properties different curves would make the release wobble.

            The scale stays instant. A label changing weight is not a claim
            about position, so it has nothing to be out of step with.
          */}
          {!isFillMeasured || prefersReducedMotion ? (
            <span
              aria-hidden="true"
              data-slot="confidence-fill"
              className={FILL_CLASS_NAME}
              style={{ width: fillWidth }}
            />
          ) : (
            <motion.span
              aria-hidden="true"
              data-slot="confidence-fill"
              className={FILL_CLASS_NAME}
              // As on the knob: this element first appears already measured, so
              // it must not sweep out from zero on the frame the measurement
              // arrives.
              initial={false}
              animate={{ width: fillWidth }}
              transition={LAYOUT_SPRING}
            />
          )}

          {CONFIDENCE_STEPS.map((step, index) => {
            const checked = value === step;
            const inputId = `${groupName}-${step}`;

            return (
              <div
                key={step}
                ref={(el) => {
                  segmentRefs.current[index] = el;
                }}
                className="relative z-10 min-w-0 flex-1"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() =>
                  setHoveredIndex((current) => (current === index ? null : current))
                }
              >
                <input
                  ref={(el) => {
                    radioRefs.current[step] = el;
                  }}
                  type="radio"
                  id={inputId}
                  name={groupName}
                  value={step}
                  checked={checked}
                  onChange={() => selectStep(step)}
                  aria-label={`${step}% · ${levelLabel(step)}`}
                  className="peer sr-only"
                />
                {/*
                  The click target, unchanged in role and size: the full width
                  of its fifth of the track and 44px tall, which is the touch
                  minimum. It is transparent now that the rail draws the
                  control, but it is still the thing a tap lands on.
                */}
                <label
                  htmlFor={inputId}
                  data-slot="confidence-option"
                  data-step={step}
                  className="flex min-h-11 w-full cursor-pointer rounded-lg transition-colors duration-150 select-none"
                />
              </div>
            );
          })}

          {renderedPillRect && displayIndex !== null ? (
            prefersReducedMotion ? (
              <span
                aria-hidden="true"
                data-slot="confidence-pill"
                className="bg-primary border-background shadow-control pointer-events-auto absolute top-1/2 z-20 -translate-y-1/2 rounded-full border-2"
                style={{
                  left: renderedPillRect.left,
                  width: renderedPillRect.width,
                  height: renderedPillRect.width,
                }}
              />
            ) : (
              <motion.span
                aria-hidden="true"
                data-slot="confidence-pill"
                drag="x"
                dragConstraints={dragBounds}
                dragElastic={0}
                dragMomentum={false}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                onPointerCancel={handlePointerCancel}
                whileDrag={{ scale: 1.15 }}
                /*
                  NO MOUNT ANIMATION.  makes the knob appear
                  already at its step instead of sliding there from the left
                  edge on first paint.

                  It is not a taste decision. The knob is 20px where the old
                  full-width pill was ~200px, and a pointer press aimed at a
                  box read mid-flight used to land on the pill anyway — with a
                  knob it lands beside it, no drag starts, and the press
                  becomes a plain click on whichever step is under the finger.
                  Measured: with the mount animation, the cancelled-gesture
                  e2e test failed 5 times out of 5, and instrumentation showed
                  no dragStart at all. The gesture code is not involved and was
                  not touched; this is the geometry it is handed.
                */
                initial={false}
                animate={{ left: renderedPillRect.left }}
                transition={LAYOUT_SPRING}
                style={{
                  x: dragOffsetX,
                  touchAction: 'none',
                  width: renderedPillRect.width,
                  height: renderedPillRect.width,
                }}
                className={cn(
                  'bg-primary border-background shadow-control absolute top-1/2 z-20 -translate-y-1/2 rounded-full border-2',
                  isDragging ? 'cursor-grabbing' : 'cursor-grab',
                )}
              />
            )
          ) : null}
        </div>

        {/*
          The scale, under the rail where a slider's scale goes. Decorative and
          `aria-hidden`: every step's accessible name is on its own radio
          above, so a screen reader hears "50% · Neutral", not a bare number
          twice.
        */}
        <div aria-hidden="true" className="relative mt-1 h-4 min-w-0">
          {CONFIDENCE_STEPS.map((step, index) => {
            const ratio = index / (CONFIDENCE_STEPS.length - 1);
            return (
              <span
                key={step}
                className={cn(
                  'absolute -translate-x-1/2 text-xs tabular-nums transition-colors duration-150',
                  displayIndex === index
                    ? 'text-foreground font-semibold'
                    : hoveredIndex === index
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                )}
                /*
                  Each tick sits under its knob position, not under its fifth of
                  the row. The knob travels `width - KNOB_SIZE` and is centred on
                  itself, so its centre is `ratio x (width - KNOB) + KNOB/2` —
                  which this says in CSS without measuring anything. Evenly
                  spaced columns would put 0% and 100% a tenth of the way in
                  from each end while the knob reaches the ends, and the scale
                  would disagree with the thing it labels.
                */
                style={{ left: `calc(${ratio * 100}% + ${KNOB_SIZE / 2 - ratio * KNOB_SIZE}px)` }}
              >
                {step}%
              </span>
            );
          })}
        </div>
      </fieldset>

      <p className="text-muted-foreground text-xs">{hint ?? t('create.confidence.hint')}</p>
    </div>
  );
}
