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

  const activeIndex = value === null ? null : CONFIDENCE_STEPS.indexOf(value as ConfidenceStep);
  const displayIndex = isDragging && previewIndex !== null ? previewIndex : activeIndex;
  // `pillRect` only ever holds a measurement for a real, selected segment;
  // deriving `null` here (rather than resetting the state itself) means
  // clearing the value hides the pill immediately without waiting on an
  // effect, and leaves the last-known geometry harmlessly stale in state.
  const renderedPillRect = activeIndex === null ? null : pillRect;

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
    const width = track.getBoundingClientRect().width;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPillRect(measureKnob(activeIndex));
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setPillRect(measureKnob(activeIndex));
    });
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
        <div
          ref={trackRef}
          data-slot="confidence-track"
          className="relative flex w-full min-w-0 touch-none items-center"
        >
          {/* The rail itself: 4px of line, purely decorative, never in the way. */}
          <span
            aria-hidden="true"
            className="bg-muted border-border pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full border"
          />
          <span
            aria-hidden="true"
            className="bg-primary/70 pointer-events-none absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full transition-[width] duration-150 motion-reduce:transition-none"
            style={{
              width:
                displayIndex === null
                  ? 0
                  : `${(displayIndex / (CONFIDENCE_STEPS.length - 1)) * 100}%`,
            }}
          />

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
                  className="peer-focus-visible:ring-ring flex min-h-11 w-full cursor-pointer rounded-lg transition-colors duration-150 select-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1"
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
                dragConstraints={trackRef}
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
