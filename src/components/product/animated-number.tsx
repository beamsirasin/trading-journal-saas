'use client';

import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';

import { DURATION, EASING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

/**
 * Counts a KPI up to its value when the figure changes.
 *
 * Why this is safe despite the ban on floating-point money (CLAUDE.md §5):
 * the input is a string that has ALREADY been rounded for display, and the
 * animation only ever drives the intermediate frames. The settled text is
 * `target.toFixed(decimals)` where `decimals` is read from the source string,
 * so the final rendered characters are identical to the string that was
 * passed in. No value is computed here and nothing is stored.
 *
 * State lives in a MotionValue rather than React state: a `setState` per
 * frame would re-render the whole card sixty times a second, and the React
 * Compiler flags `set-state-in-effect` besides.
 *
 * Under reduced motion the value renders immediately, with no animation
 * scheduled at all — the number is information, and it must never be
 * temporarily wrong for someone who asked for less movement.
 */
export function AnimatedNumber({
  value,
  className,
}: {
  /** An already-rounded decimal string, e.g. `"37.8"` or `"-0.42"`. */
  value: string;
  className?: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const decimals = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  const target = Number(value);

  const progress = useMotionValue(0);
  const text = useTransform(progress, (current) => current.toFixed(decimals));

  useEffect(() => {
    if (prefersReducedMotion || !Number.isFinite(target)) {
      progress.set(target);
      return;
    }

    const controls = animate(progress, target, {
      duration: DURATION.slow,
      ease: EASING.standard,
    });

    return () => {
      controls.stop();
    };
  }, [progress, target, prefersReducedMotion]);

  // A non-numeric string (e.g. an em-dash for "not computable") is passed
  // through untouched rather than animated to NaN.
  if (!Number.isFinite(target)) {
    return <span className={className}>{value}</span>;
  }

  return (
    <>
      {/*
        The animated text is hidden from assistive tech because a counting
        number is announced repeatedly and reads as noise. The settled value
        is exposed once, statically, alongside it.
      */}
      <motion.span aria-hidden="true" className={cn('tabular-nums', className)}>
        {text}
      </motion.span>
      <span className="sr-only">{value}</span>
    </>
  );
}
