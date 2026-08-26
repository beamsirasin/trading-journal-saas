import type { ElementType, HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Render as a different element, e.g. `section`. Defaults to `div`. */
  as?: ElementType;
  /**
   * `canvas` for the Dashboard, `wide` for other analytics surfaces, `prose`
   * for reading. Default `default`.
   */
  width?: 'default' | 'wide' | 'canvas' | 'prose';
}

/**
 * `canvas` (120rem) exists because `wide` (100rem) leaves a 1728/1920-class
 * desktop with ~128px of dead margin on each side of the workspace, which
 * reads as a tablet layout centred in a monitor. At 1920 the workspace after
 * the rail is 1856px, so a 1920px ceiling means the gutter — not the ceiling
 * — decides the width there, and the cap only starts doing work on a genuine
 * ultrawide. It is deliberately Dashboard-only: widening every analytics
 * surface is a separate, separately verified decision.
 */
const WIDTHS = {
  default: 'max-w-6xl',
  wide: 'max-w-[100rem]',
  canvas: 'max-w-[120rem]',
  prose: 'max-w-3xl',
} as const;

/**
 * The single source of horizontal rhythm.
 *
 * Every page uses this rather than ad-hoc padding, which is what keeps
 * content aligned across routes and guarantees the gutter never collapses on
 * small screens.
 */
export function Container({
  as: Component = 'div',
  width = 'default',
  className,
  ...props
}: ContainerProps) {
  return (
    <Component
      className={cn('mx-auto w-full px-4 sm:px-6 lg:px-8', WIDTHS[width], className)}
      {...props}
    />
  );
}
