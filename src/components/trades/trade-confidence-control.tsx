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

function clampIndex(index: number): number {
  return Math.min(CONFIDENCE_STEPS.length - 1, Math.max(0, index));
}

export function TradeConfidenceControl({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
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

  function measureSegment(index: number): PillRect | null {
    const track = trackRef.current;
    const segment = segmentRefs.current[index];
    if (!track || !segment) return null;
    const trackRect = track.getBoundingClientRect();
    const segmentRect = segment.getBoundingClientRect();
    return { left: segmentRect.left - trackRect.left, width: segmentRect.width };
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
    setPillRect(measureSegment(activeIndex));
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setPillRect(measureSegment(activeIndex));
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>
          {label} <span className="text-muted-foreground font-normal">{t('common.optional')}</span>
        </Label>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-sm font-semibold',
              displayValue === null && 'text-muted-foreground font-medium',
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
      </div>

      <fieldset id={id} onKeyDown={handleKeyDown} className="min-w-0">
        <legend className="sr-only">{label}</legend>
        <div
          ref={trackRef}
          data-slot="confidence-track"
          className="bg-muted border-border relative flex w-full gap-1 rounded-xl border p-1 shadow-inner"
        >
          {CONFIDENCE_STEPS.map((step, index) => {
            const checked = value === step;
            const inputId = `${groupName}-${step}`;

            return (
              <div
                key={step}
                ref={(el) => {
                  segmentRefs.current[index] = el;
                }}
                className="relative min-w-0 flex-1"
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
                className="bg-primary shadow-control absolute top-1 bottom-1 rounded-lg"
                style={{ left: renderedPillRect.left, width: renderedPillRect.width }}
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
                whileDrag={{ scale: 1.03 }}
                animate={{ left: renderedPillRect.left, width: renderedPillRect.width }}
                transition={LAYOUT_SPRING}
                style={{ x: dragOffsetX, touchAction: 'none' }}
                className={cn(
                  'bg-primary shadow-control absolute top-1 bottom-1 rounded-lg',
                  isDragging ? 'cursor-grabbing' : 'cursor-grab',
                )}
              />
            )
          ) : null}

          {/* Visual step labels — a `pointer-events-none` overlay on top of
              both the click targets and the pill, so it never intercepts a
              click or a drag gesture. The accessible name for each option
              comes from the input's own `aria-label` above, not from this
              text. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-1 flex gap-1">
            {CONFIDENCE_STEPS.map((step, index) => {
              const highlighted = displayIndex === index;
              return (
                <span
                  key={step}
                  className={cn(
                    'flex min-w-0 flex-1 items-center justify-center text-sm font-medium transition-colors duration-150',
                    highlighted
                      ? 'text-primary-foreground font-semibold'
                      : hoveredIndex === index
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  {step}%
                </span>
              );
            })}
          </div>
        </div>
      </fieldset>

      <p className="text-muted-foreground text-xs">{t('create.confidence.hint')}</p>
    </div>
  );
}
