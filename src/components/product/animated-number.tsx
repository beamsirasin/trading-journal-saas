'use client';

import { motion } from 'motion/react';

import { DURATION, EASING } from '@/lib/motion';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

/**
 * Gives a settled KPI value subtle visual feedback when it changes.
 *
 * The displayed characters are always exactly the already-rounded input.
 * Animating through intermediate numbers temporarily states false financial
 * information and delays access to the selected range, so only opacity is
 * animated. Opacity never affects layout and never changes what the value is.
 *
 * Under reduced motion the same value renders with no animation scheduled.
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

  if (prefersReducedMotion) {
    return (
      <span data-animated-number={value} className={className}>
        {value}
      </span>
    );
  }

  return (
    <motion.span
      key={value}
      data-animated-number={value}
      className={className}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.fast, ease: EASING.standard }}
    >
      {value}
    </motion.span>
  );
}
