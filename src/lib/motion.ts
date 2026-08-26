/**
 * Motion conventions.
 *
 * Durations and easings live here so that "how long does a thing take" is one
 * decision, not fifty. Animation must aid comprehension — showing where a
 * panel came from, or which item is now selected. Decorative motion is not
 * added, and nothing that moves while being read is acceptable.
 *
 * CSS motion uses semantic tokens in globals.css. Motion components call
 * `usePrefersReducedMotion()` so springs and decorative motion can resolve to
 * a calm static state while ordinary colour/opacity feedback remains intact.
 */

/** Seconds, matching Motion's unit. */
export const DURATION = {
  /** Hover and press feedback. Fast enough to feel direct. */
  instant: 0.12,
  /** Small state changes: active indicators, icon swaps. */
  fast: 0.18,
  /** Panels, drawers, dialogs. */
  base: 0.24,
  /** Larger surfaces entering for the first time. */
  slow: 0.36,
} as const;

/**
 * Cubic-bezier control points.
 *
 * `standard` decelerates: fast out of the gate, gentle on arrival, which is
 * what makes an element look like it settled rather than stopped.
 */
export const EASING = {
  standard: [0.16, 1, 0.3, 1],
  entrance: [0.22, 1, 0.36, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/** Shared spring for layout transitions such as the active-nav indicator. */
export const LAYOUT_SPRING = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.6,
} as const;

/** Short, non-spatial feedback for reduced-motion Motion call sites. */
export const REDUCED_TRANSITION = {
  duration: 0.1,
  ease: EASING.standard,
} as const;

/**
 * Returns transition props, replacing normal motion with a short, non-spring
 * feedback tween when the user has asked for reduced motion.
 */
export function transition(reduced: boolean | null, duration: number = DURATION.base) {
  if (reduced === true) {
    return REDUCED_TRANSITION;
  }
  return { duration, ease: EASING.standard };
}
